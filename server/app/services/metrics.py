# ─────────────────────────────────────────────────────────────────────────────
# Pipeline Metrics — thread-safe performance tracking
# ─────────────────────────────────────────────────────────────────────────────
# Tracks per-pipeline request counts, latency percentiles, cache hit rate,
# and peak GPU memory. Exposed via GET /metrics.
#
# Thread-safe: the orchestrator runs GPU work in a thread pool, so all
# mutations use a threading.Lock.
#
# Bounded: latency history uses deque(maxlen=1000), auto-evicts oldest.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PipelineMetrics:
    """Thread-safe pipeline performance metrics."""

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    requests_total: int = 0
    cache_hits: int = 0
    partcrafter_successes: int = 0
    partcrafter_failures: int = 0
    fallback_successes: int = 0
    fallback_failures: int = 0
    mock_fallbacks: int = 0
    errors_total: int = 0

    # Bounded -- only keeps last 1000 latencies, oldest auto-evicted
    _latency_history: deque[float] = field(default_factory=lambda: deque(maxlen=1000), repr=False)

    # Track GPU generation timestamps for rate-limit enforcement
    _generation_timestamps: deque[float] = field(
        default_factory=lambda: deque(maxlen=500),
        repr=False,
    )

    _gpu_memory_peak_gb: float = 0.0
    _start_time: float = field(default_factory=time.time, repr=False)

    def record_request(
        self,
        pipeline: str,
        latency_ms: float,
        cached: bool,
        success: bool = True,
    ) -> None:
        """Record a completed request."""
        with self._lock:
            self.requests_total += 1
            self._latency_history.append(latency_ms)

            if cached:
                self.cache_hits += 1
            elif success and pipeline == "partcrafter":
                self.partcrafter_successes += 1
            elif success and pipeline == "hunyuan3d_grounded_sam":
                self.fallback_successes += 1
            elif success and pipeline == "mock":
                self.mock_fallbacks += 1
            elif not success and pipeline == "partcrafter":
                self.partcrafter_failures += 1
            elif not success:
                self.fallback_failures += 1

            if not success:
                self.errors_total += 1

            # Track GPU generation timestamps (non-cached only)
            if not cached and success:
                self._generation_timestamps.append(time.time())

    def recent_generations_per_minute(self) -> int:
        """Count GPU generations in the last 60 seconds."""
        with self._lock:
            cutoff = time.time() - 60
            count = 0
            for ts in reversed(self._generation_timestamps):
                if ts >= cutoff:
                    count += 1
                else:
                    break
            return count

    def oldest_generation_retry_after(self) -> float:
        """Seconds until the oldest generation in the window expires.

        Returns a precise Retry-After value for HTTP 429 responses.
        If empty, returns a conservative default of 5 seconds.
        """
        with self._lock:
            if not self._generation_timestamps:
                return 5.0
            cutoff = time.time() - 60
            # Find the oldest timestamp still in the 60s window
            for ts in self._generation_timestamps:
                if ts >= cutoff:
                    return max(1.0, 60.0 - (time.time() - ts))
            return 5.0

    def record_gpu_memory(self, gb: float) -> None:
        """Track peak GPU memory usage."""
        with self._lock:
            self._gpu_memory_peak_gb = max(self._gpu_memory_peak_gb, gb)

    def to_dict(self) -> dict[str, Any]:
        """Serialize metrics for the /metrics endpoint."""
        with self._lock:
            latencies = sorted(self._latency_history)
            n = len(latencies)
            return {
                "requests_total": self.requests_total,
                "cache_hits": self.cache_hits,
                "cache_hit_rate": round(self.cache_hits / max(self.requests_total, 1), 3),
                "partcrafter_successes": self.partcrafter_successes,
                "partcrafter_failures": self.partcrafter_failures,
                "fallback_successes": self.fallback_successes,
                "fallback_failures": self.fallback_failures,
                "mock_fallbacks": self.mock_fallbacks,
                "errors_total": self.errors_total,
                "latency_p50_ms": round(latencies[n // 2], 1) if n else 0,
                "latency_p95_ms": round(latencies[int(n * 0.95)], 1) if n else 0,
                "latency_mean_ms": round(sum(latencies) / n, 1) if n else 0,
                "gpu_memory_peak_gb": self._gpu_memory_peak_gb,
                "uptime_seconds": int(time.time() - self._start_time),
            }
