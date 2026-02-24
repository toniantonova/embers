# ─────────────────────────────────────────────────────────────────────────────
# Tests — PipelineOrchestrator
# ─────────────────────────────────────────────────────────────────────────────


from unittest.mock import AsyncMock, MagicMock

import pytest

from app.cache.shape_cache import ShapeCache
from app.config import Settings
from app.models.registry import ModelRegistry
from app.schemas import BoundingBox, GenerateRequest, GenerateResponse, QualityLevel
from app.services.pipeline import PipelineOrchestrator


@pytest.fixture
def orchestrator_settings() -> Settings:
    return Settings(
        cache_bucket="",
        skip_model_load=True,
        generation_timeout_seconds=5,
        max_points=256,  # Small for fast tests
    )


@pytest.fixture
def orchestrator_cache() -> ShapeCache:
    cache = MagicMock(spec=ShapeCache)
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()
    return cache


@pytest.fixture
def orchestrator_registry(orchestrator_settings: Settings) -> ModelRegistry:
    return ModelRegistry(orchestrator_settings)


@pytest.fixture
def orchestrator(
    orchestrator_registry: ModelRegistry,
    orchestrator_cache: ShapeCache,
    orchestrator_settings: Settings,
) -> PipelineOrchestrator:
    return PipelineOrchestrator(orchestrator_registry, orchestrator_cache, orchestrator_settings)


class TestPipelineOrchestrator:
    """Tests for the PipelineOrchestrator with mocked models."""

    @pytest.mark.asyncio
    async def test_generate_returns_response(self, orchestrator: PipelineOrchestrator):
        request = GenerateRequest(text="horse")
        result = await orchestrator.generate(request)

        assert isinstance(result, GenerateResponse)
        assert result.pipeline == "mock"
        assert result.cached is False
        assert result.generation_time_ms >= 0

    @pytest.mark.asyncio
    async def test_generate_has_correct_template(self, orchestrator: PipelineOrchestrator):
        request = GenerateRequest(text="horse")
        result = await orchestrator.generate(request)

        assert result.template_type == "quadruped"
        assert "head" in result.part_names
        assert "body" in result.part_names

    @pytest.mark.asyncio
    async def test_generate_unknown_noun_gets_default(self, orchestrator: PipelineOrchestrator):
        request = GenerateRequest(text="xylophone")
        result = await orchestrator.generate(request)

        assert result.template_type == "default"
        assert result.part_names == ["body"]

    @pytest.mark.asyncio
    async def test_generate_has_valid_bounding_box(self, orchestrator: PipelineOrchestrator):
        request = GenerateRequest(text="car")
        result = await orchestrator.generate(request)

        assert isinstance(result.bounding_box, BoundingBox)
        assert len(result.bounding_box.min) == 3
        assert len(result.bounding_box.max) == 3

    @pytest.mark.asyncio
    async def test_generate_caches_result(
        self,
        orchestrator: PipelineOrchestrator,
        orchestrator_cache: ShapeCache,
    ):
        request = GenerateRequest(text="dog")
        await orchestrator.generate(request)

        # Cache write is fire-and-forget (asyncio.create_task), so yield
        # to the event loop to let the background task complete.
        import asyncio

        await asyncio.sleep(0)

        orchestrator_cache.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_cache_hit_returns_cached(
        self,
        orchestrator_registry: ModelRegistry,
        orchestrator_settings: Settings,
    ):
        cached_response = GenerateResponse(
            positions="AAAA",
            part_ids="AA==",
            part_names=["body"],
            template_type="default",
            bounding_box=BoundingBox(min=[-1, -1, -1], max=[1, 1, 1]),
            cached=False,
            generation_time_ms=50,
            pipeline="mock",
        )

        cache = MagicMock(spec=ShapeCache)
        cache.get = AsyncMock(return_value=cached_response)
        cache.set = AsyncMock()

        orchestrator = PipelineOrchestrator(orchestrator_registry, cache, orchestrator_settings)
        request = GenerateRequest(text="ball")
        result = await orchestrator.generate(request)

        assert result.cached is True
        cache.set.assert_not_called()

    @pytest.mark.asyncio
    async def test_deterministic_output(self, orchestrator: PipelineOrchestrator):
        """Same noun should produce the same mock shape."""
        request = GenerateRequest(text="cat")
        result1 = await orchestrator.generate(request)
        result2 = await orchestrator.generate(request)

        # Positions should be identical (deterministic RNG seeded by text hash)
        # Note: cache mock returns None, so both go through generation
        assert result1.positions == result2.positions

    @pytest.mark.asyncio
    async def test_quality_parameter_accepted(self, orchestrator: PipelineOrchestrator):
        request = GenerateRequest(text="eagle", quality=QualityLevel.fast)
        result = await orchestrator.generate(request)
        assert isinstance(result, GenerateResponse)
