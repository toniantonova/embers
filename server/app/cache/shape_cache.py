# Async two-tier cache: memory LRU (cachetools) + Cloud Storage persistence.
# Storage I/O wrapped in executor to avoid blocking event loop.
# self._in_flight prevents thundering herd via request coalescing.

from __future__ import annotations

import asyncio
import hashlib
import re
import threading
import time
from typing import Any

import structlog
from cachetools import LRUCache  # type: ignore[import-untyped]

from app.schemas import GenerateResponse

logger = structlog.get_logger(__name__)

# ── NLP setup for cache key normalization ────────────────────────────────────
import nltk  # type: ignore[import-untyped]  # noqa: E402
from nltk.stem import WordNetLemmatizer  # type: ignore[import-untyped]  # noqa: E402

# Ensure wordnet corpus is available (no-op if already downloaded)
try:
    nltk.data.find("corpora/wordnet")
except LookupError:
    nltk.download("wordnet", quiet=True)
try:
    nltk.data.find("corpora/omw-1.4")
except LookupError:
    nltk.download("omw-1.4", quiet=True)

_lemmatizer = WordNetLemmatizer()

# ── Stop words stripped during key normalization ─────────────────────────────
_ARTICLES = frozenset({"a", "an", "the"})


class ShapeCache:
    """Two-tier cache: in-memory LRU + Cloud Storage persistence."""

    def __init__(self, bucket_name: str = "", memory_capacity: int = 200) -> None:
        self._bucket_name = bucket_name
        self._memory: LRUCache[str, GenerateResponse] = LRUCache(maxsize=memory_capacity)
        self._lock = threading.Lock()
        self._client: Any = None
        self._bucket: Any = None

        self._memory_hits = 0
        self._storage_hits = 0
        self._misses = 0
        self._memory_retrieval_total_ms = 0.0
        self._memory_retrieval_count = 0
        self._storage_retrieval_total_ms = 0.0
        self._storage_retrieval_count = 0

        # Request coalescing: prevents thundering herd on storage reads
        self._in_flight: dict[str, asyncio.Event] = {}
        self._in_flight_lock = asyncio.Lock()

        # Collision tracking: maps hash → normalized text (capped at 10k)
        self._key_origins: dict[str, str] = {}
        self._key_origins_max = 10_000

    async def connect(self) -> None:
        """Initialize Cloud Storage client. Async wrapper around sync SDK."""
        if self._bucket_name:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._connect_sync)
        else:
            logger.info("cache_memory_only", reason="no CACHE_BUCKET set")

    def _connect_sync(self) -> None:
        """Synchronous Cloud Storage connection."""
        try:
            from google.cloud import storage

            self._client = storage.Client()
            self._bucket = self._client.bucket(self._bucket_name)
            logger.info("cache_connected", bucket=f"gs://{self._bucket_name}")
        except Exception as e:
            logger.warning("cache_storage_unavailable", error=str(e))

    async def disconnect(self) -> None:
        """Close Cloud Storage client."""
        if self._client:
            self._client.close()

    @property
    def is_connected(self) -> bool:
        """Whether the cache backend is operational (memory always counts)."""
        return self._bucket is not None or not self._bucket_name


    @staticmethod
    def normalize_key(text: str) -> str:
        """Normalize text: lowercase, strip punctuation, remove articles, lemmatize nouns."""
        text = text.lower().strip()
        text = re.sub(r"[^\w\s]", "", text)
        words = [w for w in text.split() if w not in _ARTICLES]
        words = [_lemmatizer.lemmatize(w) for w in words]
        return " ".join(words) if words else text

    @staticmethod
    def _hash_key(normalized: str) -> str:
        """SHA-256 hash of normalized text, first 16 hex chars."""
        return hashlib.sha256(normalized.encode()).hexdigest()[:16]

    def _track_collision(self, key: str, normalized: str) -> None:
        """Log if two different normalized texts produce the same hash."""
        if key in self._key_origins:
            existing = self._key_origins[key]
            if existing != normalized:
                logger.warning(
                    "cache_key_collision",
                    existing_text=existing,
                    new_text=normalized,
                    hash=key,
                )
        else:
            if len(self._key_origins) < self._key_origins_max:
                self._key_origins[key] = normalized

    # ── Get ──────────────────────────────────────────────────────────────

    async def get(self, text: str) -> GenerateResponse | None:
        """Look up cached shape. Coalesces concurrent storage reads."""
        normalized = self.normalize_key(text)
        key = self._hash_key(normalized)

        t0 = time.perf_counter()
        with self._lock:
            if key in self._memory:
                elapsed_ms = (time.perf_counter() - t0) * 1000
                self._memory_hits += 1
                self._memory_retrieval_total_ms += elapsed_ms
                self._memory_retrieval_count += 1
                logger.debug("cache_hit", tier="memory", text=text, key=key)
                return self._memory[key]  # type: ignore[no-any-return]
        if self._bucket:
            new_event: asyncio.Event | None = None
            event: asyncio.Event | None = None

            async with self._in_flight_lock:
                if key in self._in_flight:
                    event = self._in_flight[key]
                else:
                    new_event = asyncio.Event()
                    self._in_flight[key] = new_event

            if event is not None:
                logger.debug("cache_coalescing", text=text, key=key)
                await event.wait()
                with self._lock:
                    if key in self._memory:
                        self._memory_hits += 1
                        return self._memory[key]  # type: ignore[no-any-return]
                self._misses += 1
                return None
            try:
                t0_storage = time.perf_counter()
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(None, self._get_from_storage, key)
                elapsed_ms = (time.perf_counter() - t0_storage) * 1000

                if result is not None:
                    self._storage_hits += 1
                    self._storage_retrieval_total_ms += elapsed_ms
                    self._storage_retrieval_count += 1
                    with self._lock:
                        self._memory[key] = result  # Promote to memory
                    logger.debug(
                        "cache_hit",
                        tier="storage",
                        text=text,
                        key=key,
                        retrieval_ms=round(elapsed_ms, 1),
                    )
                    return result
            finally:
                if new_event is not None:
                    new_event.set()  # Wake any waiting coroutines
                    async with self._in_flight_lock:
                        self._in_flight.pop(key, None)

        self._misses += 1
        logger.debug("cache_miss", text=text, key=key)
        return None

    def _get_from_storage(self, key: str) -> GenerateResponse | None:
        """Synchronous Cloud Storage read. Runs in executor."""
        try:
            blob = self._bucket.blob(f"shapes/{key}.json")
            if blob.exists():
                return GenerateResponse.model_validate_json(blob.download_as_text())
        except Exception as e:
            logger.warning("cache_read_failed", key=key, error=str(e))
        return None

    async def set(self, text: str, response: GenerateResponse) -> None:
        """Cache shape in memory and Cloud Storage."""
        normalized = self.normalize_key(text)
        key = self._hash_key(normalized)

        self._track_collision(key, normalized)

        with self._lock:
            self._memory[key] = response
        if self._bucket:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._set_in_storage, key, response)

    def _set_in_storage(self, key: str, response: GenerateResponse) -> None:
        """Synchronous Cloud Storage write. Runs in executor."""
        try:
            blob = self._bucket.blob(f"shapes/{key}.json")
            blob.upload_from_string(
                response.model_dump_json(),
                content_type="application/json",
            )
        except Exception as e:
            logger.warning("cache_write_failed", key=key, error=str(e))

    async def preload_to_memory(self, concept: str) -> bool:
        """Load single concept from Cloud Storage into memory."""
        normalized = self.normalize_key(concept)
        key = self._hash_key(normalized)

        with self._lock:
            if key in self._memory:
                return True  # Already in memory

        if not self._bucket:
            return False

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._get_from_storage, key)
        if result is not None:
            with self._lock:
                self._memory[key] = result
            return True
        return False

    async def load_all_cached(self) -> int:
        """Load all shapes from Cloud Storage into memory at startup."""
        if not self._bucket:
            return 0

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._load_all_sync)

    def _load_all_sync(self) -> int:
        """Synchronous bulk load from Cloud Storage. Runs in executor."""
        loaded = 0
        try:
            # TODO: Replace with counter blob if cache exceeds ~500 entries.
            # At that point, list_blobs becomes an expensive paginated call.
            blobs = self._bucket.list_blobs(prefix="shapes/")
            for blob in blobs:
                try:
                    data = blob.download_as_text()
                    response = GenerateResponse.model_validate_json(data)
                    key = blob.name.removeprefix("shapes/").removesuffix(".json")
                    with self._lock:
                        self._memory[key] = response
                    loaded += 1
                except Exception as e:
                    logger.warning(
                        "cache_warmup_entry_failed",
                        blob=blob.name,
                        error=str(e),
                    )
        except Exception as e:
            logger.warning("cache_warmup_failed", error=str(e))
        return loaded

    async def count_stored_shapes(self) -> int:
        """Count shapes in Cloud Storage. TODO: Use counter blob at scale > 500."""
        if not self._bucket:
            return 0

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._count_sync)

    def _count_sync(self) -> int:
        """Synchronous blob count. Runs in executor."""
        try:
            blobs = list(self._bucket.list_blobs(prefix="shapes/"))
            return len(blobs)
        except Exception as e:
            logger.warning("cache_count_failed", error=str(e))
            return 0

    async def stats(self) -> dict[str, Any]:
        """Return cache hit/miss statistics."""
        total = self._memory_hits + self._storage_hits + self._misses

        storage_count = await self.count_stored_shapes()

        avg_mem_ms = (
            round(self._memory_retrieval_total_ms / self._memory_retrieval_count, 2)
            if self._memory_retrieval_count > 0
            else 0.0
        )
        avg_stor_ms = (
            round(self._storage_retrieval_total_ms / self._storage_retrieval_count, 1)
            if self._storage_retrieval_count > 0
            else 0.0
        )

        return {
            "memory_cache_size": len(self._memory),
            "storage_cache_size": storage_count,
            "memory_hits": self._memory_hits,
            "storage_hits": self._storage_hits,
            "misses": self._misses,
            "hit_rate": round((self._memory_hits + self._storage_hits) / max(total, 1), 3),
            "avg_memory_retrieval_ms": avg_mem_ms,
            "avg_storage_retrieval_ms": avg_stor_ms,
        }

    def clear_memory(self) -> None:
        """Clear in-memory cache (does not affect Cloud Storage)."""
        with self._lock:
            self._memory.clear()
        logger.info("cache_cleared")
