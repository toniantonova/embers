# ─────────────────────────────────────────────────────────────────────────────
# Cache Routes — monitoring and management
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any

from fastapi import APIRouter, Depends

from app.cache.shape_cache import ShapeCache
from app.dependencies import get_cache

router = APIRouter()


@router.get("/cache/stats")
async def cache_stats(cache: ShapeCache = Depends(get_cache)) -> dict[str, Any]:
    """Return cache hit/miss statistics and health metrics.

    Response schema:
    {
        "memory_cache_size": 23,
        "storage_cache_size": 50,
        "memory_hits": 145,
        "storage_hits": 38,
        "misses": 12,
        "hit_rate": 0.938,
        "avg_memory_retrieval_ms": 0.1,
        "avg_storage_retrieval_ms": 45.0
    }
    """
    return await cache.stats()
