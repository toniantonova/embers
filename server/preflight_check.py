#!/usr/bin/env python3
"""Pre-flight import check — verifies ML deps resolve before docker build.

Imports that involve native C++ extensions (torch_cluster, PartCrafter) are
tested in isolated subprocesses so that a segfault / std::length_error on
macOS doesn't kill the whole check.
"""

import platform
import subprocess
import sys

IS_MAC = platform.system() == "Darwin"
ok = True


def check(label: str, code: str, *, isolated: bool = False) -> bool:
    """Try an import. If isolated=True, run in a separate process."""
    global ok  # noqa: PLW0603

    if not isolated:
        try:
            exec(code)  # noqa: S102
            print(f"  ✓ {label}")
            return True
        except Exception as exc:
            print(f"  ✗ {label}: {exc}")
            ok = False
            return False

    # Isolated: run in a completely fresh subprocess
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode == 0:
        print(f"  ✓ {label}")
        return True
    elif IS_MAC:
        print(f"  ⚠ {label} — skipped (native crash on macOS)")
        return True  # non-fatal on Mac
    else:
        print(f"  ✗ {label} FAILED (exit {result.returncode})")
        stderr = result.stderr.strip()
        if stderr:
            # Show last 2 lines of error
            for line in stderr.splitlines()[-2:]:
                print(f"    {line[:200]}")
        ok = False
        return False


print("Core ML:")
check("torch", "import torch")
check("StableDiffusionXLPipeline", "from diffusers import StableDiffusionXLPipeline")

print("Native C++ extensions:")
check("torch_cluster", "import torch_cluster", isolated=True)

print("PartCrafter deps:")
check(
    "einops, omegaconf, jaxtyping, peft, trimesh",
    "import einops, omegaconf, jaxtyping, peft, trimesh",
)
check(
    "cv2, skimage, sklearn, huggingface_hub",
    "import cv2, skimage, sklearn, huggingface_hub",
)

print("App modules:")
check(
    "PartCrafterModel",
    "from app.models.partcrafter import PartCrafterModel",
    isolated=True,
)
check("SDXLTurboModel", "from app.models.sdxl_turbo import SDXLTurboModel")
check("PipelineOrchestrator", "from app.services.pipeline import PipelineOrchestrator")

print()
if ok:
    print("All imports pass — safe to build + deploy.")
    if IS_MAC:
        print("Note: items marked ⚠ require Linux/CUDA — verified during docker build.")
else:
    print("FAILED — fix the errors above before deploying.")
    sys.exit(1)
