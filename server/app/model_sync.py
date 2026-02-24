# ─────────────────────────────────────────────────────────────────────────────
# Model Weight Sync — GCS → Local Filesystem
# ─────────────────────────────────────────────────────────────────────────────
# Syncs pre-downloaded HuggingFace model weights from a same-region GCS bucket
# to the container's local filesystem before model loading begins.
#
# Why: Cloud Run containers have ephemeral filesystems. Without this, every
# cold start re-downloads ~10GB from HuggingFace Hub (90-180s). Same-region
# GCS transfer runs at ~1-2 GB/s, cutting the download to ~8-15 seconds.
#
# The sync is idempotent: files that already exist locally with matching size
# are skipped. If the bucket is empty or unreachable, the sync logs a warning
# and returns — model loading falls back to HuggingFace Hub downloads.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import contextlib
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)

# Max parallel blob downloads. GCS client handles per-blob parallelism
# internally; this controls how many blobs we download concurrently.
_MAX_WORKERS = 8


def sync_model_weights(bucket_name: str, local_dir: str) -> None:
    """Download model weights from GCS to the local filesystem.

    Args:
        bucket_name: GCS bucket containing pre-downloaded HF model weights.
        local_dir: Local directory to sync weights into (typically HF_HOME).

    Raises:
        Nothing — errors are logged and suppressed so model loading can
        fall back to HuggingFace Hub if the sync fails.
    """
    if not bucket_name:
        logger.debug("model_sync_skipped", reason="no bucket configured")
        return

    try:
        from google.cloud import storage
    except ImportError:
        logger.warning("model_sync_skipped", reason="google-cloud-storage not installed")
        return

    t0 = time.perf_counter()
    logger.info("model_sync_start", bucket=bucket_name, local_dir=local_dir)

    try:
        client = storage.Client()
        bucket = client.bucket(bucket_name)

        # List all blobs in the bucket
        blobs = list(bucket.list_blobs())
        if not blobs:
            logger.warning("model_sync_empty_bucket", bucket=bucket_name)
            return

        total_bytes = sum(b.size or 0 for b in blobs)
        logger.info(
            "model_sync_inventory",
            blob_count=len(blobs),
            total_gb=round(total_bytes / 1e9, 2),
        )

        # Filter to blobs that need downloading (don't exist or wrong size)
        to_download = []
        skipped = 0
        for blob in blobs:
            local_path = Path(local_dir) / blob.name
            if local_path.exists() and local_path.stat().st_size == (blob.size or 0):
                skipped += 1
                continue
            to_download.append(blob)

        if not to_download:
            elapsed = time.perf_counter() - t0
            logger.info(
                "model_sync_complete",
                downloaded=0,
                skipped=skipped,
                elapsed_s=round(elapsed, 2),
                reason="all files already present",
            )
            return

        download_bytes = sum(b.size or 0 for b in to_download)
        logger.info(
            "model_sync_downloading",
            files=len(to_download),
            download_gb=round(download_bytes / 1e9, 2),
            skipped=skipped,
        )

        # Download in parallel.
        # _MAX_WORKERS is intentionally lower than the upload script's 16
        # because Cloud Run instances share a single vNIC — too many
        # concurrent downloads saturate it and slow everything down.
        downloaded = 0
        errors = 0
        failed_blobs: list[str] = []

        def _download_blob(blob: storage.Blob) -> bool:
            """Download a single blob to the local filesystem."""
            local_path = Path(local_dir) / blob.name
            local_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                blob.download_to_filename(str(local_path))
                return True
            except Exception:
                # Clean up partial file so HuggingFace doesn't see a
                # truncated/corrupt file and mistake it for a valid cache hit.
                with contextlib.suppress(OSError):
                    local_path.unlink(missing_ok=True)
                logger.warning(
                    "model_sync_blob_failed",
                    blob=blob.name,
                    exc_info=True,
                )
                return False

        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            futures = {pool.submit(_download_blob, blob): blob for blob in to_download}
            for future in as_completed(futures):
                blob = futures[future]
                if future.result():
                    downloaded += 1
                else:
                    errors += 1
                    failed_blobs.append(blob.name)

        elapsed = time.perf_counter() - t0
        throughput_gbps = (download_bytes / 1e9) / elapsed if elapsed > 0 else 0

        logger.info(
            "model_sync_complete",
            downloaded=downloaded,
            skipped=skipped,
            errors=errors,
            elapsed_s=round(elapsed, 2),
            throughput_gbps=round(throughput_gbps, 2),
        )

        if errors > 0:
            logger.warning(
                "model_sync_partial_failure",
                errors=errors,
                failed_blobs=failed_blobs,
                hint="Failed files cleaned up — HuggingFace will re-download them",
            )

    except Exception:
        elapsed = time.perf_counter() - t0
        logger.exception(
            "model_sync_failed",
            bucket=bucket_name,
            elapsed_s=round(elapsed, 2),
            hint="Falling back to HuggingFace Hub download",
        )
