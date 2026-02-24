# Multi-view mesh rendering with face-ID pass for segmentation.
# Each view: color image (for Grounded SAM 2) + face_id_map (pixel→face index).

from __future__ import annotations

import math
from typing import Any

import numpy as np
import PIL.Image
import structlog
import trimesh

logger = structlog.get_logger(__name__)

# Camera positions for canonical views (avoids occlusion issues)
_VIEW_CONFIGS = {
    "side": {"eye": (2.5, 0.5, 0.0), "up": (0, 1, 0)},
    "front": {"eye": (0.0, 0.5, 2.5), "up": (0, 1, 0)},
    "three_quarter": {"eye": (1.8, 0.8, 1.8), "up": (0, 1, 0)},
}


def _look_at(
    eye: tuple[float, ...],
    target: tuple[float, ...] = (0, 0, 0),
    up: tuple[float, ...] = (0, 1, 0),
) -> np.ndarray[Any, Any]:
    """Compute a 4x4 camera-to-world transform (look-at matrix)."""
    eye_arr = np.array(eye, dtype=np.float64)
    target_arr = np.array(target, dtype=np.float64)
    up_arr = np.array(up, dtype=np.float64)

    forward = target_arr - eye_arr
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, up_arr)
    right /= np.linalg.norm(right)
    true_up = np.cross(right, forward)

    mat = np.eye(4)
    mat[:3, 0] = right
    mat[:3, 1] = true_up
    mat[:3, 2] = -forward
    mat[:3, 3] = eye_arr
    return mat


def _encode_face_id(face_idx: int) -> tuple[int, int, int]:
    """Encode a face index as an RGB color (24-bit, up to 16M faces)."""
    r = (face_idx >> 16) & 0xFF
    g = (face_idx >> 8) & 0xFF
    b = face_idx & 0xFF
    return (r, g, b)


def _decode_face_id(r: int, g: int, b: int) -> int:
    """Decode an RGB color back to a face index."""
    return (r << 16) | (g << 8) | b


def render_multiview_with_id_pass(
    mesh: trimesh.Trimesh,
    resolution: int = 512,
    views: list[str] | None = None,
) -> list[tuple[PIL.Image.Image, np.ndarray]]:
    """Render mesh from multiple views. Returns [(color_img, face_id_map), ...]."""
    import time

    import pyrender  # type: ignore[import-untyped]

    if views is None:
        views = ["side", "front", "three_quarter"]

    t0 = time.perf_counter()

    # Center and scale mesh to fit in view
    centered_mesh = mesh.copy()
    centered_mesh.vertices -= centered_mesh.centroid
    scale = 1.0 / max(centered_mesh.extents)
    centered_mesh.vertices *= scale

    results: list[tuple[PIL.Image.Image, np.ndarray]] = []

    for view_name in views:
        config = _VIEW_CONFIGS.get(view_name, _VIEW_CONFIGS["side"])
        color_image = _render_color_pass(centered_mesh, config, resolution, pyrender)
        face_id_map = _render_id_pass(centered_mesh, config, resolution, pyrender)

        results.append((color_image, face_id_map))

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    logger.info(
        "mesh_rendered",
        views=len(results),
        resolution=resolution,
        faces=len(mesh.faces),
        time_ms=elapsed_ms,
    )

    return results


def _render_color_pass(
    mesh: trimesh.Trimesh,
    config: dict[str, Any],
    resolution: int,
    pyrender: Any,
) -> PIL.Image.Image:
    """Render a color pass of the mesh from the given viewpoint."""
    scene = pyrender.Scene(bg_color=[0, 0, 0, 0])

    # Add mesh with default material
    py_mesh = pyrender.Mesh.from_trimesh(mesh)
    scene.add(py_mesh)

    # Add camera
    camera = pyrender.PerspectiveCamera(yfov=math.pi / 4.0)
    camera_pose = _look_at(config["eye"], up=config["up"])
    scene.add(camera, pose=camera_pose)

    # Add light
    light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=3.0)
    scene.add(light, pose=camera_pose)

    # Render
    renderer = pyrender.OffscreenRenderer(resolution, resolution)
    color, _ = renderer.render(scene)
    renderer.delete()

    return PIL.Image.fromarray(color)


def _render_id_pass(
    mesh: trimesh.Trimesh,
    config: dict[str, Any],
    resolution: int,
    pyrender: Any,
) -> np.ndarray[Any, Any]:
    """Render face-ID map: each face → unique RGB color (no interpolation)."""
    num_faces = len(mesh.faces)

    face_colors = np.zeros((num_faces, 4), dtype=np.uint8)
    for i in range(num_faces):
        r, g, b = _encode_face_id(i)
        face_colors[i] = [r, g, b, 255]

    id_mesh = mesh.copy()
    id_mesh.visual = trimesh.visual.ColorVisuals(mesh=id_mesh, face_colors=face_colors)

    scene = pyrender.Scene(
        bg_color=[0, 0, 0, 0],
        ambient_light=[1.0, 1.0, 1.0],
    )

    material = pyrender.MetallicRoughnessMaterial(
        metallicFactor=0.0,
        roughnessFactor=1.0,
        alphaMode="OPAQUE",
    )
    py_mesh = pyrender.Mesh.from_trimesh(id_mesh, material=material, smooth=False)
    scene.add(py_mesh)

    camera = pyrender.PerspectiveCamera(yfov=math.pi / 4.0)
    camera_pose = _look_at(config["eye"], up=config["up"])
    scene.add(camera, pose=camera_pose)

    renderer = pyrender.OffscreenRenderer(resolution, resolution)
    color, _ = renderer.render(
        scene,
        flags=pyrender.constants.RenderFlags.FLAT | pyrender.constants.RenderFlags.SKIP_CULL_FACES,
    )
    renderer.delete()

    face_id_map = np.full((resolution, resolution), -1, dtype=np.int32)
    r = color[:, :, 0].astype(np.int32)
    g = color[:, :, 1].astype(np.int32)
    b = color[:, :, 2].astype(np.int32)
    decoded = (r << 16) | (g << 8) | b

    non_background = decoded > 0
    face_id_map[non_background] = decoded[non_background]
    face_id_map[face_id_map >= num_faces] = -1

    return face_id_map
