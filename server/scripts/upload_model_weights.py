#!/usr/bin/env python3
"""Upload HuggingFace model weights to a GCS bucket for fast cold starts.

One-time setup script. Downloads model weights from HuggingFace Hub into a
temporary directory, then uploads the entire HF cache layout to a GCS bucket.
Subsequent Cloud Run cold starts sync from this bucket (~8-15s) instead of
re-downloading from HuggingFace Hub (~90-180s).

Usage:
    # Upload all models to the bucket:
    uv run python scripts/upload_model_weights.py \
        --bucket lumen-model-weights-<project-id>

    # Dry run (download only, don't upload):
    uv run python scripts/upload_model_weights.py \
        --bucket lumen-model-weights-<project-id> --dry-run

    # Upload with a custom HF token (for gated models):
    HF_TOKEN=hf_xxx uv run python scripts/upload_model_weights.py \
        --bucket lumen-model-weights-<project-id>

Idempotent: skips blobs that already exist in the bucket with matching size.

Requirements:
    pip install google-cloud-storage huggingface-hub diffusers transformers
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ── Models to upload ─────────────────────────────────────────────────────────
# These must match what the server downloads in:
#   - app/models/sdxl_turbo.py  (stabilityai/sdxl-turbo)
#   - app/models/partcrafter.py (wgsxm/PartCrafter, briaai/RMBG-1.4)

SNAPSHOT_MODELS = [
    "wgsxm/PartCrafter",
    "briaai/RMBG-1.4",
]

# SDXL Turbo uses diffusers' from_pretrained which has a different cache
# layout than snapshot_download. We download it via diffusers to match
# the exact cache structure the server expects.
DIFFUSERS_MODELS = [
    ("stabilityai/sdxl-turbo", {"variant": "fp16"}),
]

_MAX_UPLOAD_WORKERS = 16


def download_models(cache_dir: str) -> None:
    """Download all model weights into the given cache directory."""
    from huggingface_hub import snapshot_download

    print(f"\n{'='*60}")
    print("Downloading model weights from HuggingFace Hub")
    print(f"Cache directory: {cache_dir}")
    print(f"{'='*60}\n")

    # Snapshot models (PartCrafter, RMBG)
    for repo_id in SNAPSHOT_MODELS:
        print(f"  Downloading {repo_id}...")
        t0 = time.perf_counter()
        snapshot_download(repo_id=repo_id, cache_dir=cache_dir)
        elapsed = time.perf_counter() - t0
        print(f"  Done: {repo_id} ({elapsed:.1f}s)")

    # Diffusers models (SDXL Turbo) — uses diffusers' cache layout
    for repo_id, kwargs in DIFFUSERS_MODELS:
        print(f"  Downloading {repo_id} (diffusers pipeline)...")
        t0 = time.perf_counter()

        # Set HF_HOME so diffusers caches into our target directory
        old_hf_home = os.environ.get("HF_HOME")
        os.environ["HF_HOME"] = cache_dir

        try:
            import torch
            from diffusers import StableDiffusionXLPipeline

            StableDiffusionXLPipeline.from_pretrained(
                repo_id,
                torch_dtype=torch.float16,
                **kwargs,
            )
        finally:
            if old_hf_home is not None:
                os.environ["HF_HOME"] = old_hf_home
            else:
                os.environ.pop("HF_HOME", None)

        elapsed = time.perf_counter() - t0
        print(f"  Done: {repo_id} ({elapsed:.1f}s)")

    # Summary
    total_size = sum(f.stat().st_size for f in Path(cache_dir).rglob("*") if f.is_file())
    file_count = sum(1 for f in Path(cache_dir).rglob("*") if f.is_file())
    print(f"\n  Total: {file_count} files, {total_size / 1e9:.2f} GB")


def upload_to_gcs(cache_dir: str, bucket_name: str, *, dry_run: bool = False) -> None:
    """Upload the local cache directory to a GCS bucket."""
    from google.cloud import storage

    print(f"\n{'='*60}")
    print(f"Uploading to gs://{bucket_name}")
    if dry_run:
        print("  (DRY RUN — no uploads will occur)")
    print(f"{'='*60}\n")

    client = storage.Client()
    bucket = client.bucket(bucket_name)

    # Collect all local files
    cache_path = Path(cache_dir)
    local_files = [f for f in cache_path.rglob("*") if f.is_file()]
    total_size = sum(f.stat().st_size for f in local_files)

    print(f"  Files to upload: {len(local_files)}")
    print(f"  Total size: {total_size / 1e9:.2f} GB")

    if dry_run:
        print("\n  Dry run complete. No files uploaded.")
        return

    # Check which files already exist in the bucket
    existing_blobs = {blob.name: blob.size for blob in bucket.list_blobs()}
    print(f"  Existing blobs in bucket: {len(existing_blobs)}")

    to_upload = []
    skipped = 0
    for local_file in local_files:
        blob_name = str(local_file.relative_to(cache_path))
        local_size = local_file.stat().st_size
        if blob_name in existing_blobs and existing_blobs[blob_name] == local_size:
            skipped += 1
            continue
        to_upload.append((local_file, blob_name))

    if not to_upload:
        print(f"\n  All {skipped} files already in bucket. Nothing to upload.")
        return

    upload_size = sum(f.stat().st_size for f, _ in to_upload)
    print(f"  Files to upload: {len(to_upload)} ({upload_size / 1e9:.2f} GB)")
    print(f"  Skipped (already exist): {skipped}")

    # Upload in parallel
    t0 = time.perf_counter()
    uploaded = 0
    errors = 0

    def _upload(local_file: Path, blob_name: str) -> bool:
        try:
            blob = bucket.blob(blob_name)
            blob.upload_from_filename(str(local_file))
            return True
        except Exception as e:
            print(f"  ERROR uploading {blob_name}: {e}", file=sys.stderr)
            return False

    with ThreadPoolExecutor(max_workers=_MAX_UPLOAD_WORKERS) as pool:
        futures = {
            pool.submit(_upload, local_file, blob_name): blob_name
            for local_file, blob_name in to_upload
        }
        for future in as_completed(futures):
            if future.result():
                uploaded += 1
                if uploaded % 50 == 0:
                    print(f"  Uploaded {uploaded}/{len(to_upload)} files...")
            else:
                errors += 1

    elapsed = time.perf_counter() - t0
    print("\n  Upload complete:")
    print(f"    Uploaded: {uploaded}")
    print(f"    Skipped:  {skipped}")
    print(f"    Errors:   {errors}")
    print(f"    Time:     {elapsed:.1f}s")
    print(f"    Throughput: {upload_size / 1e9 / elapsed:.2f} GB/s")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Upload HuggingFace model weights to GCS for fast Cloud Run cold starts.",
    )
    parser.add_argument(
        "--bucket",
        required=True,
        help="GCS bucket name (e.g. lumen-model-weights-lumen-pipeline)",
    )
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Local directory for downloading weights (default: temp directory)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download weights but don't upload to GCS",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip download step (use existing --cache-dir contents)",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete temp directory after upload (ignored if --cache-dir is set)",
    )
    args = parser.parse_args()

    if args.skip_download and not args.cache_dir:
        parser.error("--skip-download requires --cache-dir")

    # Use temp directory if no cache dir specified
    using_tempdir = False
    if args.cache_dir:
        cache_dir = args.cache_dir
        os.makedirs(cache_dir, exist_ok=True)
    else:
        tmp = tempfile.mkdtemp(prefix="lumen-models-")
        cache_dir = tmp
        using_tempdir = True
        print(f"Using temp directory: {cache_dir}")

    t0 = time.perf_counter()

    if not args.skip_download:
        download_models(cache_dir)

    upload_to_gcs(cache_dir, args.bucket, dry_run=args.dry_run)

    total_elapsed = time.perf_counter() - t0
    print(f"\nTotal time: {total_elapsed:.1f}s")

    # Clean up temp directory if requested
    if using_tempdir:
        if args.cleanup:
            import shutil

            print(f"\nCleaning up temp directory: {cache_dir}")
            shutil.rmtree(cache_dir, ignore_errors=True)
        else:
            print(f"\nNote: ~{_estimate_dir_size_gb(cache_dir):.1f} GB of model weights remain at:")
            print(f"  {cache_dir}")
            print("  Run with --cleanup to auto-delete, or remove manually.")


def _estimate_dir_size_gb(path: str) -> float:
    """Estimate total size of a directory in GB."""
    total = sum(f.stat().st_size for f in Path(path).rglob("*") if f.is_file())
    return total / 1e9


if __name__ == "__main__":
    main()
