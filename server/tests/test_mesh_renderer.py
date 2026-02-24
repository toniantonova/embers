# ─────────────────────────────────────────────────────────────────────────────
# Tests for mesh renderer — face-ID encoding/decoding
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from app.pipeline.mesh_renderer import _decode_face_id, _encode_face_id


class TestFaceIdEncoding:
    """Verify RGB encoding/decoding round-trips correctly."""

    def test_roundtrip_small(self) -> None:
        for i in range(256):
            r, g, b = _encode_face_id(i)
            assert _decode_face_id(r, g, b) == i

    def test_roundtrip_large(self) -> None:
        for i in [1000, 50000, 100000, 16777215]:
            r, g, b = _encode_face_id(i)
            assert _decode_face_id(r, g, b) == i

    def test_zero(self) -> None:
        r, g, b = _encode_face_id(0)
        assert (r, g, b) == (0, 0, 0)

    def test_max_24bit(self) -> None:
        """16777215 = 0xFFFFFF = max face index in 24-bit encoding."""
        r, g, b = _encode_face_id(16777215)
        assert (r, g, b) == (255, 255, 255)
