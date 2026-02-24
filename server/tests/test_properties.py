# ─────────────────────────────────────────────────────────────────────────────
# Property-Based Tests — Hypothesis
# ─────────────────────────────────────────────────────────────────────────────
# Demonstrates: hypothesis for invariant testing on pure functions.
# These tests generate thousands of random inputs and verify that
# mathematical invariants always hold — far more rigorous than a
# handful of hand-picked examples.
# ─────────────────────────────────────────────────────────────────────────────

import numpy as np
from hypothesis import assume, given, settings
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from app.cache.shape_cache import ShapeCache
from app.pipeline.point_sampler import normalize_positions

# ─── Strategies (reusable random data generators) ────────────────────────────

# Random 3D point clouds: shape (N, 3), reasonable float range.
point_clouds = arrays(
    dtype=np.float32,
    shape=st.tuples(st.integers(min_value=2, max_value=500), st.just(3)),
    elements=st.floats(min_value=-100.0, max_value=100.0, allow_nan=False, allow_infinity=False),
)

# Random text with at least one alpha character.
text_with_alpha = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N")),
    min_size=1,
    max_size=200,
).filter(lambda t: any(c.isalpha() for c in t))

# Strictly ASCII alpha text for case-insensitivity tests.
# Avoids Unicode case-folding edge cases (e.g., Turkish ı/İ, ŉ/Ŋ)
# which are expected divergences, not bugs.
ascii_text = st.from_regex(r"[a-zA-Z]{1,50}", fullmatch=True)


class TestNormalizePositionsProperties:
    """Property-based tests for normalize_positions.

    normalize_positions centers at origin and scales to [-1, 1].
    These verify mathematical invariants that must hold for ANY valid input.
    """

    @given(points=point_clouds)
    @settings(max_examples=200)
    def test_output_bounded(self, points: np.ndarray):
        """Normalized positions must be in [-1, 1]³."""
        # Skip when max_extent is 0 (all points identical)
        assume(np.abs(points - points.mean(axis=0)).max() > 1e-7)

        normalized, _ = normalize_positions(points)
        assert np.all(np.isfinite(normalized))
        assert normalized.min() >= -1.0 - 1e-4
        assert normalized.max() <= 1.0 + 1e-4

    @given(points=point_clouds)
    @settings(max_examples=200)
    def test_bounding_box_is_valid(self, points: np.ndarray):
        """Bounding box min should be <= max on all axes."""
        _, bbox = normalize_positions(points)
        for i in range(3):
            assert bbox["min"][i] <= bbox["max"][i]

    @given(points=point_clouds)
    @settings(max_examples=200)
    def test_shape_preserved(self, points: np.ndarray):
        """Output shape must match input shape."""
        normalized, _ = normalize_positions(points)
        assert normalized.shape == points.shape

    @given(points=point_clouds)
    @settings(max_examples=200)
    def test_dtype_float32(self, points: np.ndarray):
        """Output dtype must be float32."""
        normalized, _ = normalize_positions(points)
        assert normalized.dtype == np.float32


class TestCacheKeyNormalizationProperties:
    """Property-based tests for cache key normalization."""

    @given(text=text_with_alpha)
    @settings(max_examples=200)
    def test_deterministic(self, text: str):
        """Same input must always produce the same key."""
        assert ShapeCache.normalize_key(text) == ShapeCache.normalize_key(text)

    @given(text=text_with_alpha)
    @settings(max_examples=200)
    def test_returns_nonempty(self, text: str):
        """Normalized key should be non-empty for alphanumeric input."""
        assert len(ShapeCache.normalize_key(text)) > 0

    @given(text=ascii_text)
    @settings(max_examples=200)
    def test_case_insensitive_for_ascii(self, text: str):
        """Keys should be case-insensitive for ASCII text."""
        assert ShapeCache.normalize_key(text.lower()) == ShapeCache.normalize_key(text.upper())

    @given(text=text_with_alpha)
    @settings(max_examples=200)
    def test_strips_whitespace(self, text: str):
        """Leading/trailing whitespace should not affect the key."""
        assert ShapeCache.normalize_key(text.strip()) == ShapeCache.normalize_key(f"  {text}  ")

    @given(text=text_with_alpha)
    @settings(max_examples=200)
    def test_hash_is_hex(self, text: str):
        """Hashed keys should be valid hex strings of fixed length."""
        normalized = ShapeCache.normalize_key(text)
        hashed = ShapeCache._hash_key(normalized)
        assert len(hashed) == 16
        int(hashed, 16)  # Raises ValueError if not valid hex
