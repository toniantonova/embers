#!/usr/bin/env python3
"""Verify requirements-heavy.txt pins match uv.lock.

Catches version drift between the Docker layer split file
(requirements-heavy.txt) and the lockfile (uv.lock). Run in CI
or as a pre-commit hook:

    uv run python scripts/check_heavy_pins.py

Exit code 0 = all match, 1 = mismatch found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # server/
HEAVY_FILE = REPO_ROOT / "requirements-heavy.txt"
LOCK_FILE = REPO_ROOT / "uv.lock"


def parse_heavy_pins(path: Path) -> dict[str, str]:
    """Parse exact pins from requirements-heavy.txt (e.g. 'torch==2.7.1')."""
    pins: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([a-zA-Z0-9_-]+)==(.+)$", line)
        if match:
            pins[match.group(1).lower()] = match.group(2)
        else:
            print(f"WARNING: unparseable line in {path.name}: {line}", file=sys.stderr)
    return pins


def parse_lock_versions(path: Path, packages: set[str]) -> dict[str, str]:
    """Extract versions for specific packages from uv.lock."""
    versions: dict[str, str] = {}
    lines = path.read_text().splitlines()
    for i, line in enumerate(lines):
        if line.startswith("name = "):
            name = line.split('"')[1].lower()
            if name in packages and i + 1 < len(lines):
                ver_line = lines[i + 1]
                if ver_line.startswith("version = "):
                    versions[name] = ver_line.split('"')[1]
    return versions


def main() -> int:
    if not HEAVY_FILE.exists():
        print(f"ERROR: {HEAVY_FILE} not found", file=sys.stderr)
        return 1
    if not LOCK_FILE.exists():
        print(f"ERROR: {LOCK_FILE} not found", file=sys.stderr)
        return 1

    heavy_pins = parse_heavy_pins(HEAVY_FILE)
    if not heavy_pins:
        print(f"ERROR: no pins found in {HEAVY_FILE.name}", file=sys.stderr)
        return 1

    lock_versions = parse_lock_versions(LOCK_FILE, set(heavy_pins.keys()))

    mismatches = 0
    for pkg, heavy_ver in sorted(heavy_pins.items()):
        lock_ver = lock_versions.get(pkg)
        if lock_ver is None:
            print(f"  MISSING  {pkg}=={heavy_ver}  (not found in uv.lock)")
            mismatches += 1
        elif lock_ver != heavy_ver:
            print(f"  MISMATCH {pkg}: requirements-heavy.txt={heavy_ver}  uv.lock={lock_ver}")
            mismatches += 1
        else:
            print(f"  OK       {pkg}=={heavy_ver}")

    if mismatches:
        print(f"\n{mismatches} mismatch(es). Update requirements-heavy.txt to match uv.lock.")
        return 1

    print("\nAll heavy dependency pins match uv.lock. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
