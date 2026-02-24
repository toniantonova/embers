#!/usr/bin/env python3
"""Pre-generate the top 50 shapes and cache them on the server.

Usage:
    # Against a deployed server:
    uv run python scripts/pregenerate_top_50.py --url https://lumen-pipeline-XXX.run.app

    # Against a local server:
    uv run python scripts/pregenerate_top_50.py --url http://localhost:8080

This is a POST-DEPLOY step — requires a live GPU endpoint with models loaded.
The script polls /health/ready before starting, waiting up to 5 minutes for
model loading (cold start).

Idempotent: cached concepts are skipped.
"""

from __future__ import annotations

import argparse
import sys
import time

import httpx

# ── Top 50 concepts ─────────────────────────────────────────────────────────

TOP_50_CONCEPTS = [
    # Animals (most commonly spoken)
    "dog", "cat", "horse", "bird", "fish", "elephant", "lion", "bear",
    "rabbit", "butterfly", "eagle", "shark", "whale", "dolphin",
    # People
    "person", "man", "woman", "child", "dancer", "soldier",
    # Vehicles
    "car", "truck", "airplane", "boat", "bicycle", "motorcycle",
    # Buildings/structures
    "house", "castle", "church", "building", "bridge",
    # Nature
    "tree", "flower", "mountain", "sun", "moon", "star",
    # Furniture/objects
    "chair", "table", "guitar", "piano", "sword", "crown",
    # Fantasy/unusual (common creative words)
    "dragon", "robot", "unicorn", "dinosaur", "spaceship", "alien",
]


def wait_for_server(
    client: httpx.Client, *, timeout_s: int = 300, poll_interval_s: int = 5
) -> bool:
    """Poll /health/ready until it returns 200 or timeout expires."""
    print(f"⏳ Waiting for server to become ready (timeout: {timeout_s}s)...")
    start = time.perf_counter()
    while time.perf_counter() - start < timeout_s:
        try:
            resp = client.get("/health/ready", timeout=5)
            if resp.status_code == 200:
                elapsed = time.perf_counter() - start
                print(f"✅ Server ready in {elapsed:.1f}s")
                return True
            print(f"   Not ready yet (status={resp.status_code}), retrying...")
        except httpx.RequestError as e:
            print(f"   Connection failed ({e}), retrying...")
        time.sleep(poll_interval_s)

    print("❌ Server did not become ready within timeout.")
    return False


def generate_shape(
    client: httpx.Client, concept: str, *, api_key: str = ""
) -> dict | None:
    """Call POST /generate for a single concept. Returns response dict or None."""
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key

    try:
        resp = client.post(
            "/generate",
            json={"text": concept},
            headers=headers,
            timeout=30,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"   ⚠️ HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    except httpx.RequestError as e:
        print(f"   ⚠️ Request failed: {e}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        required=True,
        help="Server base URL (e.g. http://localhost:8080)",
    )
    parser.add_argument("--api-key", default="", help="API key for auth")
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Max seconds to wait for server readiness (default: 300)",
    )
    args = parser.parse_args()

    client = httpx.Client(base_url=args.url)

    if not wait_for_server(client, timeout_s=args.timeout):
        sys.exit(1)

    print(f"\n🚀 Pre-generating {len(TOP_50_CONCEPTS)} shapes...\n")

    successes = 0
    failures: list[str] = []
    cached_count = 0
    total_start = time.perf_counter()

    for i, concept in enumerate(TOP_50_CONCEPTS, 1):
        t0 = time.perf_counter()
        result = generate_shape(client, concept, api_key=args.api_key)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        if result:
            was_cached = result.get("cached", False)
            if was_cached:
                cached_count += 1
                print(
                    f"  [{i:2d}/{len(TOP_50_CONCEPTS)}] {concept:15s} "
                    f"⚡ cached ({elapsed_ms:.0f}ms)"
                )
            else:
                parts = result.get("part_names", [])
                template = result.get("template_type", "?")
                pipeline = result.get("pipeline", "?")
                gen_time = result.get("generation_time_ms", 0)
                print(
                    f"  [{i:2d}/{len(TOP_50_CONCEPTS)}] {concept:15s} "
                    f"✅ {template} · {len(parts)} parts · "
                    f"{pipeline} · {gen_time}ms (total {elapsed_ms:.0f}ms)"
                )
            successes += 1
        else:
            failures.append(concept)
            print(
                f"  [{i:2d}/{len(TOP_50_CONCEPTS)}] {concept:15s} ❌ FAILED"
            )

    total_time = time.perf_counter() - total_start

    # ── Summary ──────────────────────────────────────────────────────────
    print(f"\n{'─' * 60}")
    print(f"  Total time:    {total_time:.1f}s")
    print(f"  Successes:     {successes}/{len(TOP_50_CONCEPTS)}")
    print(f"  Already cached:{cached_count}")
    print(f"  Generated:     {successes - cached_count}")
    print(f"  Failures:      {len(failures)}")
    if failures:
        print(f"  Failed:        {', '.join(failures)}")
    print(f"{'─' * 60}\n")

    client.close()

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
