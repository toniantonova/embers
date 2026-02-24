# ─────────────────────────────────────────────────────────────────────────────
# Encoding Utilities — base64 encode/decode, bounding box computation
# ─────────────────────────────────────────────────────────────────────────────


import base64

import numpy as np


def encode_float32(arr: np.ndarray) -> str:
    """Encode a float32 numpy array to base64 string."""
    return base64.b64encode(arr.astype(np.float32).tobytes()).decode("ascii")


def encode_uint8(arr: np.ndarray) -> str:
    """Encode a uint8 numpy array to base64 string."""
    return base64.b64encode(arr.astype(np.uint8).tobytes()).decode("ascii")


def decode_float32(data: str, shape: tuple[int, ...] = (-1, 3)) -> np.ndarray:
    """Decode a base64 string to a float32 numpy array."""
    raw = base64.b64decode(data)
    return np.frombuffer(raw, dtype=np.float32).reshape(shape)


def decode_uint8(data: str) -> np.ndarray:
    """Decode a base64 string to a uint8 numpy array."""
    raw = base64.b64decode(data)
    return np.frombuffer(raw, dtype=np.uint8)


def compute_bbox(positions: np.ndarray) -> dict[str, list[float]]:
    """Compute axis-aligned bounding box from a point cloud.

    Args:
        positions: Array of shape (N, 3).

    Returns:
        Dict with 'min' and 'max' keys, each a list of 3 floats.
    """
    return {
        "min": positions.min(axis=0).tolist(),
        "max": positions.max(axis=0).tolist(),
    }
