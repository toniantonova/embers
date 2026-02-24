# ─────────────────────────────────────────────────────────────────────────────
# Schema Factory Tests — polyfactory
# ─────────────────────────────────────────────────────────────────────────────
# Demonstrates: polyfactory for auto-generating valid Pydantic model
# instances that respect all field constraints (min_length, ge, le, etc).
# ─────────────────────────────────────────────────────────────────────────────

from dirty_equals import IsInstance, IsNonNegative, IsStr
from polyfactory.factories.pydantic_factory import ModelFactory

from app.schemas import (
    BoundingBox,
    GenerateRequest,
    GenerateResponse,
    HealthDetailResponse,
    QualityLevel,
)

# ─── Factories ───────────────────────────────────────────────────────────────
# Define once, generate unlimited valid instances. polyfactory reads the
# Pydantic model's field constraints and generates data that passes validation.
#
# For GenerateRequest, we override the `text` field to always include alpha
# characters, since our custom field_validator requires at least one.


class GenerateRequestFactory(ModelFactory):
    __model__ = GenerateRequest

    @classmethod
    def text(cls) -> str:
        """Always include alpha chars to satisfy field_validator."""
        import random
        import string

        alpha = "".join(random.choices(string.ascii_lowercase, k=5))
        digits = "".join(random.choices(string.digits, k=3))
        return f"{alpha}{digits}"


class GenerateResponseFactory(ModelFactory):
    __model__ = GenerateResponse


class BoundingBoxFactory(ModelFactory):
    __model__ = BoundingBox


class HealthDetailFactory(ModelFactory):
    __model__ = HealthDetailResponse


# ─── Tests ───────────────────────────────────────────────────────────────────


class TestGenerateRequestFactory:
    """Verify that polyfactory generates valid GenerateRequest instances."""

    def test_factory_creates_valid_instance(self):
        """Factory output should pass Pydantic validation."""
        request = GenerateRequestFactory.build()
        assert isinstance(request, GenerateRequest)
        assert len(request.text) >= 1
        assert len(request.text) <= 200

    def test_factory_batch(self):
        """Generate 50 instances — all should be valid."""
        requests = GenerateRequestFactory.batch(50)
        assert len(requests) == 50
        for req in requests:
            assert isinstance(req, GenerateRequest)
            assert any(c.isalpha() for c in req.text)  # field_validator

    def test_factory_with_overrides(self):
        """Override specific fields while auto-generating the rest."""
        request = GenerateRequestFactory.build(text="dragon", quality=QualityLevel.fast)
        assert request.text == "dragon"
        assert request.quality == QualityLevel.fast
        # verb and num_parts are auto-generated
        assert isinstance(request, GenerateRequest)

    def test_factory_respects_constraints(self):
        """num_parts should be within [1, 16] when generated."""
        for _ in range(100):
            request = GenerateRequestFactory.build()
            if request.num_parts is not None:
                assert 1 <= request.num_parts <= 16


class TestGenerateResponseFactory:
    """Verify GenerateResponse factory + dirty-equals assertions."""

    def test_response_shape_with_dirty_equals(self):
        """Use dirty-equals for declarative shape assertions."""
        response = GenerateResponseFactory.build()
        data = response.model_dump()

        assert data == {
            "positions": IsStr,
            "part_ids": IsStr,
            "part_names": IsInstance(list),
            "template_type": IsStr,
            "bounding_box": IsInstance(dict),
            "cached": IsInstance(bool),
            "generation_time_ms": IsNonNegative,
            "pipeline": IsStr,
        }

    def test_batch_all_valid(self):
        """Generate 20 responses — verify they all serialize cleanly."""
        responses = GenerateResponseFactory.batch(20)
        for resp in responses:
            data = resp.model_dump()
            assert data["generation_time_ms"] >= 0
            assert len(data["part_names"]) >= 0


class TestBoundingBoxFactory:
    """Verify BoundingBox factory generates valid 3D bounds."""

    def test_has_three_components(self):
        bbox = BoundingBoxFactory.build()
        assert len(bbox.min) == 3
        assert len(bbox.max) == 3

    def test_batch(self):
        boxes = BoundingBoxFactory.batch(30)
        assert all(len(b.min) == 3 and len(b.max) == 3 for b in boxes)
