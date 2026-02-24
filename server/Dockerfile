# ============================================================
# Lumen Server — Application Image (fast builds)
# ============================================================
# Uses the pre-built base image which contains all system packages,
# Python, uv, dependencies, and PartCrafter already installed.
# This Dockerfile ONLY copies app code — builds take 1-2 minutes
# instead of 15-30 minutes.
#
# If the base image doesn't exist yet, build it first:
#   gcloud builds submit --config infrastructure/cloudbuild-base.yaml \
#     --project=lumen-pipeline --region=us-central1 server/
#
# Fallback: set BUILD_ARG BASE_IMAGE=nvidia/cuda:12.8.0-runtime-ubuntu24.04
# to do a full build (slow but works without the base image).
# ============================================================

ARG BASE_IMAGE=us-central1-docker.pkg.dev/lumen-pipeline/lumen-pipeline-docker/lumen-base:latest

FROM ${BASE_IMAGE}

# ---- Refresh dependencies if pyproject.toml/uv.lock changed ----
# --inexact: do NOT remove packages absent from uv.lock. This preserves
# fallback packages (hy3dgen, groundingdino, SAM-2) and torch-cluster
# that the base image installed via pip outside the lockfile.
COPY --chown=appuser pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --inexact

# ---- Copy application code (the only thing that changes per deploy) ----
COPY --chown=appuser app/ app/

EXPOSE 8080
# Default PORT for local dev; Cloud Run overrides via environment.
ENV PORT=8080
# --no-sync: all deps are baked into the base image; skip the implicit
# sync so `uv run` doesn't overwrite the pre-built PyG torch-cluster wheel
# with the broken PyPI sdist.
# Shell form (not exec form) enables $PORT expansion at runtime.
# `exec` replaces the shell process with uvicorn so it receives
# SIGTERM directly from Cloud Run (needed for graceful shutdown).
CMD exec uv run --no-sync uvicorn app.main:create_app --factory --host 0.0.0.0 --port $PORT
