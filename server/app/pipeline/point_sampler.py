# ─────────────────────────────────────────────────────────────────────────────
# Point Sampler — mesh surface → labeled point cloud
# ─────────────────────────────────────────────────────────────────────────────


import numpy as np
import trimesh


def normalize_positions(positions: np.ndarray) -> tuple[np.ndarray, dict[str, list[float]]]:
    """Center at origin and scale to fit within [-1, 1] bounding box.

    Args:
        positions: Point cloud of shape (N, 3).

    Returns:
        Tuple of (normalized_positions, bounding_box_dict).
    """
    centroid = positions.mean(axis=0)
    centered = positions - centroid

    max_extent = np.abs(centered).max()
    if max_extent > 0:
        centered /= max_extent

    bbox = {
        "min": centered.min(axis=0).tolist(),
        "max": centered.max(axis=0).tolist(),
    }
    return centered, bbox


def sample_from_part_meshes(
    part_meshes: list[trimesh.Trimesh],
    total_points: int = 2048,
) -> tuple[np.ndarray, np.ndarray]:
    """Sample points from PartCrafter output (pre-separated meshes).

    Points are allocated proportionally by surface area — larger parts
    get more points. Each point's part_id corresponds to the index of
    the mesh it was sampled from.

    Args:
        part_meshes: List of trimesh meshes, one per semantic part.
        total_points: Total number of points to sample across all parts.

    Returns:
        Tuple of (positions [N, 3], part_ids [N]) where N = total_points.
    """
    if not part_meshes:
        raise ValueError("part_meshes must not be empty")

    # Compute surface areas for proportional allocation
    areas = np.array([mesh.area for mesh in part_meshes], dtype=np.float64)
    total_area = areas.sum()

    if total_area <= 0:
        # Degenerate meshes — distribute points equally
        points_per_part = [total_points // len(part_meshes)] * len(part_meshes)
        points_per_part[-1] += total_points - sum(points_per_part)
    else:
        # Proportional allocation with at least 1 point per part
        fractions = areas / total_area
        points_per_part = np.maximum((fractions * total_points).astype(int), 1).tolist()

        # Adjust to hit exact total (rounding may over/under-count)
        diff = total_points - sum(points_per_part)
        if diff > 0:
            # Add remaining points to the largest part
            largest_idx = int(np.argmax(areas))
            points_per_part[largest_idx] += diff
        elif diff < 0:
            # Remove excess from the largest part
            largest_idx = int(np.argmax(areas))
            points_per_part[largest_idx] = max(1, points_per_part[largest_idx] + diff)

    # Sample from each mesh
    all_positions = []
    all_part_ids = []

    for part_id, (mesh, n_points) in enumerate(zip(part_meshes, points_per_part)):
        if n_points <= 0:
            continue
        points, _ = trimesh.sample.sample_surface(mesh, n_points)
        all_positions.append(points)
        all_part_ids.append(np.full(len(points), part_id, dtype=np.uint8))

    positions = np.concatenate(all_positions, axis=0).astype(np.float32)
    part_ids = np.concatenate(all_part_ids, axis=0)

    # Normalize to [-1, 1]
    positions, _ = normalize_positions(positions)

    return positions, part_ids


def sample_from_labeled_mesh(
    mesh: trimesh.Trimesh,
    face_labels: np.ndarray,
    total_points: int = 2048,
) -> tuple[np.ndarray, np.ndarray]:
    """Sample points from a monolithic mesh with per-face labels.

    Used in the fallback pipeline (Hunyuan3D + Grounded SAM).
    Each sampled point inherits the label of the face it was sampled from.

    Args:
        mesh: A single trimesh mesh.
        face_labels: Array of shape (num_faces,) with integer labels per face.
        total_points: Number of points to sample.

    Returns:
        Tuple of (positions [N, 3], part_ids [N]).
    """
    if len(face_labels) != len(mesh.faces):
        raise ValueError(
            f"face_labels length ({len(face_labels)}) doesn't match mesh faces ({len(mesh.faces)})"
        )

    points, face_indices = trimesh.sample.sample_surface(mesh, total_points)
    positions = points.astype(np.float32)

    # Guard against degenerate triangles: sample_surface may return fewer
    # points than requested if the mesh has zero-area faces.
    if len(positions) < total_points:
        deficit = total_points - len(positions)
        if len(positions) > 0:
            # Pad by repeating existing samples
            pad_indices = np.random.choice(len(positions), size=deficit, replace=True)
            positions = np.concatenate([positions, positions[pad_indices]], axis=0)
            face_indices = np.concatenate([face_indices, face_indices[pad_indices]])
        else:
            # Completely degenerate mesh — return zeros
            positions = np.zeros((total_points, 3), dtype=np.float32)
            face_indices = np.zeros(total_points, dtype=np.int64)

    part_ids = face_labels[face_indices].astype(np.uint8)

    # Normalize to [-1, 1]
    positions, _ = normalize_positions(positions)

    return positions, part_ids
