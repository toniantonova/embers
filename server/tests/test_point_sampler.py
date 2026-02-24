# ─────────────────────────────────────────────────────────────────────────────
# Tests — Point Sampler
# ─────────────────────────────────────────────────────────────────────────────

import numpy as np
import pytest
import trimesh

from app.pipeline.point_sampler import (
    normalize_positions,
    sample_from_labeled_mesh,
    sample_from_part_meshes,
)


def _make_box(center: tuple = (0, 0, 0), size: float = 1.0) -> trimesh.Trimesh:
    """Create a simple box mesh for testing."""
    box = trimesh.primitives.Box(extents=[size, size, size])
    box.apply_translation(center)
    return box


class TestNormalizePositions:
    """Tests for normalize_positions()."""

    def test_output_in_unit_range(self):
        points = np.random.randn(100, 3).astype(np.float32) * 10
        normalized, bbox = normalize_positions(points)
        assert normalized.max() <= 1.0 + 1e-6
        assert normalized.min() >= -1.0 - 1e-6

    def test_centered_at_origin(self):
        points = np.array([[5, 5, 5], [7, 7, 7]], dtype=np.float32)
        normalized, _ = normalize_positions(points)
        centroid = normalized.mean(axis=0)
        np.testing.assert_allclose(centroid, [0, 0, 0], atol=1e-6)

    def test_returns_bounding_box(self):
        points = np.random.randn(50, 3).astype(np.float32)
        _, bbox = normalize_positions(points)
        assert "min" in bbox
        assert "max" in bbox
        assert len(bbox["min"]) == 3
        assert len(bbox["max"]) == 3

    def test_single_point(self):
        points = np.array([[5.0, 3.0, 1.0]], dtype=np.float32)
        normalized, _ = normalize_positions(points)
        # Single point should be at origin
        np.testing.assert_allclose(normalized, [[0, 0, 0]], atol=1e-6)


class TestSampleFromPartMeshes:
    """Tests for sample_from_part_meshes()."""

    def test_correct_total_point_count(self):
        meshes = [_make_box((0, 0, 0)), _make_box((3, 0, 0))]
        positions, part_ids = sample_from_part_meshes(meshes, total_points=2048)
        assert positions.shape == (2048, 3)
        assert part_ids.shape == (2048,)

    def test_positions_normalized(self):
        meshes = [_make_box((0, 0, 0), size=5.0)]
        positions, _ = sample_from_part_meshes(meshes, total_points=512)
        assert positions.max() <= 1.0 + 1e-6
        assert positions.min() >= -1.0 - 1e-6

    def test_part_ids_match_mesh_indices(self):
        meshes = [_make_box((0, 0, 0)), _make_box((3, 0, 0)), _make_box((6, 0, 0))]
        _, part_ids = sample_from_part_meshes(meshes, total_points=300)
        unique_ids = set(part_ids.tolist())
        assert unique_ids == {0, 1, 2}

    def test_single_mesh(self):
        meshes = [_make_box()]
        positions, part_ids = sample_from_part_meshes(meshes, total_points=100)
        assert positions.shape == (100, 3)
        assert all(pid == 0 for pid in part_ids)

    def test_proportional_allocation(self):
        # One big box (8x surface area) and one small box
        big = _make_box((0, 0, 0), size=2.0)
        small = _make_box((5, 0, 0), size=1.0)
        _, part_ids = sample_from_part_meshes([big, small], total_points=1000)
        big_count = (part_ids == 0).sum()
        small_count = (part_ids == 1).sum()
        # Big box should get significantly more points
        assert big_count > small_count

    def test_dtypes(self):
        meshes = [_make_box()]
        positions, part_ids = sample_from_part_meshes(meshes, total_points=100)
        assert positions.dtype == np.float32
        assert part_ids.dtype == np.uint8

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            sample_from_part_meshes([], total_points=100)


class TestSampleFromLabeledMesh:
    """Tests for sample_from_labeled_mesh()."""

    def test_correct_point_count(self):
        mesh = _make_box()
        labels = np.zeros(len(mesh.faces), dtype=np.uint8)
        positions, part_ids = sample_from_labeled_mesh(mesh, labels, total_points=512)
        assert positions.shape == (512, 3)
        assert part_ids.shape == (512,)

    def test_labels_inherited_from_faces(self):
        mesh = _make_box()
        n_faces = len(mesh.faces)
        # Half the faces labeled 0, half labeled 1
        labels = np.array([0 if i < n_faces // 2 else 1 for i in range(n_faces)], dtype=np.uint8)
        _, part_ids = sample_from_labeled_mesh(mesh, labels, total_points=500)
        unique = set(part_ids.tolist())
        assert 0 in unique
        assert 1 in unique

    def test_mismatched_labels_raises(self):
        mesh = _make_box()
        wrong_labels = np.zeros(5, dtype=np.uint8)  # Wrong size
        with pytest.raises(ValueError):
            sample_from_labeled_mesh(mesh, wrong_labels, total_points=100)

    def test_positions_normalized(self):
        mesh = _make_box(center=(10, 10, 10), size=5.0)
        labels = np.zeros(len(mesh.faces), dtype=np.uint8)
        positions, _ = sample_from_labeled_mesh(mesh, labels, total_points=200)
        assert positions.max() <= 1.0 + 1e-6
        assert positions.min() >= -1.0 - 1e-6


# ── Edge-Case Tests for sample_from_labeled_mesh (S10b) ──────────────────────


class TestLabeledMeshEdgeCases:
    """Edge-case hardening for the fallback pipeline's labeled mesh sampler."""

    def test_unlabeled_faces_get_part_id_zero(self):
        """Faces with label 0 (unlabeled) should produce points with part_id=0."""
        mesh = _make_box()
        labels = np.zeros(len(mesh.faces), dtype=np.uint8)  # All unlabeled
        _, part_ids = sample_from_labeled_mesh(mesh, labels, total_points=512)
        assert np.all(part_ids == 0)

    def test_uniform_label(self):
        """All faces with the same label → all points get that label."""
        mesh = _make_box()
        labels = np.full(len(mesh.faces), 5, dtype=np.uint8)
        _, part_ids = sample_from_labeled_mesh(mesh, labels, total_points=256)
        assert np.all(part_ids == 5)

    def test_degenerate_triangles_no_crash(self):
        """Mesh with zero-area faces should not crash."""
        # Create a mesh with some degenerate (zero-area) triangles
        vertices = np.array(
            [
                [0, 0, 0],
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1],
                # Degenerate: three identical vertices
                [0.5, 0.5, 0.5],
                [0.5, 0.5, 0.5],
                [0.5, 0.5, 0.5],
            ],
            dtype=np.float64,
        )
        faces = np.array(
            [
                [0, 1, 2],  # Valid face
                [0, 1, 3],  # Valid face
                [4, 5, 6],  # Degenerate face (zero area)
            ]
        )
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        labels = np.array([1, 2, 0], dtype=np.uint8)

        # Should not crash
        positions, part_ids = sample_from_labeled_mesh(mesh, labels, total_points=100)
        assert positions.shape[0] == 100
        assert part_ids.shape[0] == 100

    def test_output_normalized_to_unit_box(self):
        """Output positions must be within [-1, 1] bounding box."""
        mesh = _make_box(center=(100, 200, 300), size=50.0)
        labels = np.ones(len(mesh.faces), dtype=np.uint8)
        positions, _ = sample_from_labeled_mesh(mesh, labels, total_points=512)
        assert positions.max() <= 1.0 + 1e-6
        assert positions.min() >= -1.0 - 1e-6

    def test_exact_point_count(self):
        """Output must have exactly total_points points."""
        mesh = _make_box()
        labels = np.zeros(len(mesh.faces), dtype=np.uint8)
        for count in [100, 512, 2048]:
            positions, part_ids = sample_from_labeled_mesh(mesh, labels, total_points=count)
            assert positions.shape == (count, 3)
            assert part_ids.shape == (count,)
