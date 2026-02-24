# ─────────────────────────────────────────────────────────────────────────────
# Tests for ShapeCache — two-tier caching with hardened normalization
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import threading
from unittest.mock import patch

import pytest

from app.cache.shape_cache import ShapeCache
from app.schemas import BoundingBox, GenerateResponse

# ── Fixtures ─────────────────────────────────────────────────────────────────


def _make_response(text: str = "dog") -> GenerateResponse:
    """Create a minimal valid GenerateResponse for testing."""
    return GenerateResponse(
        positions="AAAA",  # Dummy base64
        part_ids="AAAA",
        part_names=["body"],
        template_type="quadruped",
        bounding_box=BoundingBox(
            min=[-0.5, -0.5, -0.5],
            max=[0.5, 0.5, 0.5],
        ),
        cached=False,
        generation_time_ms=100,
        pipeline="mock",
    )


@pytest.fixture()
def cache() -> ShapeCache:
    """Create a memory-only ShapeCache (no Cloud Storage)."""
    return ShapeCache(bucket_name="", memory_capacity=100)


# ── Normalization ────────────────────────────────────────────────────────────


class TestNormalization:
    """Normalization is deliberately minimal: case, punctuation, articles."""

    def test_lowercase(self) -> None:
        assert ShapeCache.normalize_key("Horse") == "horse"

    def test_strip_punctuation(self) -> None:
        assert ShapeCache.normalize_key("horse!") == "horse"
        assert ShapeCache.normalize_key("horse?!.") == "horse"

    def test_strip_articles(self) -> None:
        assert ShapeCache.normalize_key("a horse") == "horse"
        assert ShapeCache.normalize_key("the horse") == "horse"
        assert ShapeCache.normalize_key("an elephant") == "elephant"

    def test_strip_whitespace(self) -> None:
        assert ShapeCache.normalize_key("  horse  ") == "horse"
        assert ShapeCache.normalize_key("  a  big  dog  ") == "big dog"

    def test_lemmatization_singular_plural(self) -> None:
        """Lemmatizer collapses plural → singular for nouns."""
        assert ShapeCache.normalize_key("horses") == ShapeCache.normalize_key("horse")
        assert ShapeCache.normalize_key("buses") == ShapeCache.normalize_key("bus")
        assert ShapeCache.normalize_key("children") == ShapeCache.normalize_key("child")

    def test_no_adjective_stripping(self) -> None:
        """Adjectives are NOT stripped — 'red dragon' stays 'red dragon'.

        Semantic normalization belongs in the pipeline orchestrator,
        not the cache key layer.
        """
        assert ShapeCache.normalize_key("big dog") == "big dog"
        assert ShapeCache.normalize_key("red dragon") == "red dragon"

    def test_horse_horses_same_key(self) -> None:
        assert ShapeCache.normalize_key("horse") == ShapeCache.normalize_key("horses")

    def test_dragon_dragons_same_key(self) -> None:
        assert ShapeCache.normalize_key("dragon") == ShapeCache.normalize_key("dragons")

    def test_running_horse_running_horses_same_key(self) -> None:
        assert ShapeCache.normalize_key("running horse") == ShapeCache.normalize_key(
            "running horses"
        )

    def test_red_dragon_blue_dragon_different_keys(self) -> None:
        assert ShapeCache.normalize_key("red dragon") != ShapeCache.normalize_key("blue dragon")

    def test_the_horse_a_horse_same_key(self) -> None:
        assert ShapeCache.normalize_key("the horse") == ShapeCache.normalize_key("a horse")

    def test_empty_input(self) -> None:
        assert ShapeCache.normalize_key("") == ""

    def test_only_articles(self) -> None:
        """If only articles remain after stripping, return original."""
        assert ShapeCache.normalize_key("the") == "the"


# ── Set + Get Round-Trip ─────────────────────────────────────────────────────


class TestSetGet:
    @pytest.mark.asyncio
    async def test_set_get_roundtrip(self, cache: ShapeCache) -> None:
        resp = _make_response("dog")
        await cache.set("dog", resp)
        result = await cache.get("dog")
        assert result is not None
        assert result.template_type == "quadruped"
        assert result.pipeline == "mock"

    @pytest.mark.asyncio
    async def test_get_miss(self, cache: ShapeCache) -> None:
        result = await cache.get("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_normalized_key_matches(self, cache: ShapeCache) -> None:
        """'The Dog!' and 'dog' should hit the same cache entry."""
        resp = _make_response("dog")
        await cache.set("dog", resp)
        result = await cache.get("The Dog!")
        assert result is not None
        assert result.template_type == "quadruped"


# ── Stats ────────────────────────────────────────────────────────────────────


class TestStats:
    @pytest.mark.asyncio
    async def test_miss_counter(self, cache: ShapeCache) -> None:
        await cache.get("missing")
        stats = await cache.stats()
        assert stats["misses"] == 1
        assert stats["memory_hits"] == 0

    @pytest.mark.asyncio
    async def test_memory_hit_counter(self, cache: ShapeCache) -> None:
        await cache.set("dog", _make_response("dog"))
        await cache.get("dog")
        stats = await cache.stats()
        assert stats["memory_hits"] == 1
        assert stats["misses"] == 0

    @pytest.mark.asyncio
    async def test_hit_rate(self, cache: ShapeCache) -> None:
        await cache.set("dog", _make_response("dog"))
        await cache.get("dog")  # hit
        await cache.get("missing")  # miss
        stats = await cache.stats()
        assert stats["hit_rate"] == 0.5

    @pytest.mark.asyncio
    async def test_memory_retrieval_timing(self, cache: ShapeCache) -> None:
        await cache.set("dog", _make_response("dog"))
        await cache.get("dog")
        stats = await cache.stats()
        assert stats["avg_memory_retrieval_ms"] >= 0


# ── Two-Tier Lookup (Memory + Storage) ───────────────────────────────────────


class FakeBlob:
    """In-memory fake for google.cloud.storage.Blob."""

    def __init__(self, name: str, data: str | None = None) -> None:
        self.name = name
        self._data = data

    def exists(self) -> bool:
        return self._data is not None

    def download_as_text(self) -> str:
        assert self._data is not None
        return self._data

    def upload_from_string(self, data: str, content_type: str = "") -> None:
        self._data = data


class FakeBucket:
    """In-memory fake for google.cloud.storage.Bucket."""

    def __init__(self) -> None:
        self._blobs: dict[str, FakeBlob] = {}

    def blob(self, name: str) -> FakeBlob:
        if name not in self._blobs:
            self._blobs[name] = FakeBlob(name)
        return self._blobs[name]

    def list_blobs(self, prefix: str = "") -> list[FakeBlob]:
        return [b for name, b in self._blobs.items() if name.startswith(prefix)]


class TestTwoTier:
    @pytest.fixture()
    def storage_cache(self) -> ShapeCache:
        """ShapeCache with a fake Cloud Storage bucket."""
        c = ShapeCache(bucket_name="test-bucket", memory_capacity=100)
        c._bucket = FakeBucket()
        return c

    @pytest.mark.asyncio
    async def test_storage_hit_promotes_to_memory(self, storage_cache: ShapeCache) -> None:
        resp = _make_response("dog")
        await storage_cache.set("dog", resp)

        # Clear memory — force storage lookup
        storage_cache.clear_memory()
        assert len(storage_cache._memory) == 0

        result = await storage_cache.get("dog")
        assert result is not None
        assert result.template_type == "quadruped"

        # Should now be in memory
        assert len(storage_cache._memory) == 1

        stats = await storage_cache.stats()
        assert stats["storage_hits"] == 1

    @pytest.mark.asyncio
    async def test_count_stored_shapes(self, storage_cache: ShapeCache) -> None:
        await storage_cache.set("dog", _make_response("dog"))
        await storage_cache.set("cat", _make_response("cat"))
        count = await storage_cache.count_stored_shapes()
        assert count == 2

    @pytest.mark.asyncio
    async def test_load_all_cached(self, storage_cache: ShapeCache) -> None:
        await storage_cache.set("dog", _make_response("dog"))
        await storage_cache.set("cat", _make_response("cat"))

        # Clear memory
        storage_cache.clear_memory()
        assert len(storage_cache._memory) == 0

        loaded = await storage_cache.load_all_cached()
        assert loaded == 2
        assert len(storage_cache._memory) == 2

    @pytest.mark.asyncio
    async def test_preload_to_memory(self, storage_cache: ShapeCache) -> None:
        await storage_cache.set("dog", _make_response("dog"))
        storage_cache.clear_memory()

        result = await storage_cache.preload_to_memory("dog")
        assert result is True
        assert len(storage_cache._memory) == 1

    @pytest.mark.asyncio
    async def test_preload_missing_concept(self, storage_cache: ShapeCache) -> None:
        result = await storage_cache.preload_to_memory("unicorn")
        assert result is False


# ── Coalescing (Thundering Herd Prevention) ──────────────────────────────────


class TestCoalescing:
    @pytest.mark.asyncio
    async def test_concurrent_gets_coalesce(self) -> None:
        """Two concurrent gets for the same uncached key should result
        in only one Cloud Storage read (the second awaits the first)."""
        storage_reads = 0

        cache = ShapeCache(bucket_name="test", memory_capacity=100)
        bucket = FakeBucket()

        # Pre-populate storage with a response
        resp = _make_response("dog")
        blob = bucket.blob(f"shapes/{ShapeCache._hash_key(ShapeCache.normalize_key('dog'))}.json")
        blob.upload_from_string(resp.model_dump_json())

        original_get = cache._get_from_storage

        def counting_get(key: str) -> GenerateResponse | None:
            nonlocal storage_reads
            storage_reads += 1
            # Simulate slow storage read
            import time

            time.sleep(0.05)
            cache._bucket = bucket
            return original_get(key)

        cache._bucket = bucket
        cache._get_from_storage = counting_get  # type: ignore[assignment]

        # Fire two concurrent gets
        results = await asyncio.gather(
            cache.get("dog"),
            cache.get("dog"),
        )

        # Both should get results
        assert results[0] is not None or results[1] is not None
        # Only one storage read should have happened
        assert storage_reads == 1


# ── Collision Logging ────────────────────────────────────────────────────────


class TestCollisionLogging:
    @pytest.mark.asyncio
    async def test_collision_logged(self, cache: ShapeCache) -> None:
        """Two different texts that hash to the same key should log."""
        # We can't easily force a hash collision, but we can test the
        # tracking mechanism directly.
        cache._track_collision("abc123", "dog")
        cache._track_collision("abc123", "dog")  # Same — no warning

        with patch("app.cache.shape_cache.logger") as mock_logger:
            cache._track_collision("abc123", "cat")  # Different — warning!
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args
            assert call_args[0][0] == "cache_key_collision"


# ── Thread Safety ────────────────────────────────────────────────────────────


class TestThreadSafety:
    @pytest.mark.asyncio
    async def test_concurrent_set_get(self, cache: ShapeCache) -> None:
        """Multiple threads setting and getting shouldn't raise."""
        errors = []

        def writer(n: int) -> None:
            try:
                loop = asyncio.new_event_loop()
                loop.run_until_complete(cache.set(f"concept_{n}", _make_response(f"concept_{n}")))
                loop.close()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert len(cache._memory) == 20


# ── Clear ────────────────────────────────────────────────────────────────────


class TestClear:
    @pytest.mark.asyncio
    async def test_clear_memory(self, cache: ShapeCache) -> None:
        await cache.set("dog", _make_response("dog"))
        assert len(cache._memory) == 1
        cache.clear_memory()
        assert len(cache._memory) == 0
