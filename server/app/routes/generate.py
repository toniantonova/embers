# ─────────────────────────────────────────────────────────────────────────────
# POST /generate — point cloud generation endpoint (THIN)
# ─────────────────────────────────────────────────────────────────────────────


from fastapi import APIRouter, Depends, Request

from app.dependencies import get_pipeline_orchestrator
from app.rate_limit import limiter
from app.schemas import GenerateRequest, GenerateResponse
from app.services.pipeline import PipelineOrchestrator

router = APIRouter()


@router.post("/generate", response_model=GenerateResponse)
# Speech app: ~20-60 req/min/user x 5 concurrent users.
# GPU cost is protected by the inner generation_rate_limit_per_minute gate.
@limiter.limit("300/minute")
async def generate(
    request: Request,
    body: GenerateRequest,
    orchestrator: PipelineOrchestrator = Depends(get_pipeline_orchestrator),
) -> GenerateResponse:
    """Generate a part-labeled point cloud from a text concept.

    Rate-limited to 300 requests/minute per IP at the HTTP layer.
    GPU cost is protected by the inner generation_rate_limit_per_minute gate.
    Validation is Pydantic. Errors are exceptions. Logic is in the orchestrator.
    This endpoint is just wiring.
    """
    return await orchestrator.generate(body)
