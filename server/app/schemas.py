# ─────────────────────────────────────────────────────────────────────────────
# Pydantic v2 Request / Response Schemas
# ─────────────────────────────────────────────────────────────────────────────


from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class QualityLevel(StrEnum):
    """Generation quality mode."""

    fast = "fast"  # Primary pipeline only (PartCrafter)
    standard = "standard"  # With fallback (Hunyuan3D + Grounded SAM)


class GenerateRequest(BaseModel):
    """Incoming request to generate a 3D point cloud."""

    text: str = Field(..., min_length=1, max_length=200, description="Noun/concept to generate")
    verb: str | None = Field(None, max_length=100, description="Optional verb for animation")
    num_parts: int | None = Field(None, ge=1, le=16, description="Part count hint")
    quality: QualityLevel = QualityLevel.standard

    @field_validator("text")
    @classmethod
    def text_must_contain_alpha(cls, v: str) -> str:
        if not any(c.isalpha() for c in v):
            raise ValueError("Text must contain at least one alphabetic character")
        return v.strip()


class BoundingBox(BaseModel):
    """Axis-aligned bounding box with exactly 3 floats per side."""

    min: list[float] = Field(..., min_length=3, max_length=3)
    max: list[float] = Field(..., min_length=3, max_length=3)


class GenerateResponse(BaseModel):
    """Point cloud generation result."""

    positions: str = Field(..., description="Base64-encoded Float32Array (2048 × 3 floats)")
    part_ids: str = Field(..., description="Base64-encoded Uint8Array (2048 bytes)")
    part_names: list[str] = Field(..., description="Part labels")
    template_type: str = Field(..., description="e.g. 'quadruped', 'biped'")
    bounding_box: BoundingBox
    cached: bool
    generation_time_ms: int = Field(..., ge=0)
    pipeline: str = Field(..., description="'partcrafter', 'hunyuan3d_grounded_sam', or 'mock'")


class LivenessResponse(BaseModel):
    """Liveness probe — minimal, near-zero cost."""

    status: str = "ok"


class ReadinessResponse(BaseModel):
    """Readiness / startup probe — can the instance serve traffic?"""

    status: str  # "ready" or "not_ready"
    models_loaded: list[str]
    cache_connected: bool


class HealthDetailResponse(BaseModel):
    """Full diagnostics — GPU, memory, cache, uptime. For humans only."""

    status: str
    models_loaded: list[str]
    gpu_available: bool
    gpu_name: str | None = None
    gpu_memory_used_gb: float = 0
    cache_connected: bool = False
    cache_stats: dict[str, Any] = Field(default_factory=dict)
    uptime_seconds: int = 0
