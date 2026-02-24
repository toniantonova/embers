# ─────────────────────────────────────────────────────────────────────────────
# Tests for mask-to-face mapping
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import numpy as np

from app.pipeline.mask_to_faces import (
    _find_symmetric_pair,
    map_masks_to_faces,
)


def _make_face_id_map(face_indices: list[int], h: int = 4, w: int = 4) -> np.ndarray:
    """Create a simple face-ID map from a flat list of face indices."""
    arr = np.full((h, w), -1, dtype=np.int32)
    for i, fidx in enumerate(face_indices):
        row, col = divmod(i, w)
        if row < h:
            arr[row, col] = fidx
    return arr


class TestBasicLabeling:
    def test_single_mask_labels_faces(self) -> None:
        """A mask covering some pixels labels the faces visible there."""
        face_id_map = _make_face_id_map([0, 1, 2, 3, 4, 5, 6, 7, -1, -1, -1, -1, -1, -1, -1, -1])
        mask = np.zeros((4, 4), dtype=bool)
        mask[0, :] = True  # Top row → faces 0, 1, 2, 3

        centroids = np.random.randn(8, 3).astype(np.float32)
        views = [({" head": mask}, face_id_map)]

        labels = map_masks_to_faces(views, centroids)
        assert labels[0] == labels[1] == labels[2] == labels[3]
        # Face indices 0-3 should be labeled

    def test_multiple_parts(self) -> None:
        """Two non-overlapping masks label different faces."""
        face_id_map = np.array(
            [[0, 1, 2, 3], [4, 5, 6, 7], [-1, -1, -1, -1], [-1, -1, -1, -1]],
            dtype=np.int32,
        )
        mask_head = np.zeros((4, 4), dtype=bool)
        mask_head[0, :2] = True  # Faces 0, 1 = head

        mask_body = np.zeros((4, 4), dtype=bool)
        mask_body[0, 2:] = True  # Faces 2, 3 = body

        centroids = np.random.randn(8, 3).astype(np.float32)
        views = [({"head": mask_head, "body": mask_body}, face_id_map)]

        labels = map_masks_to_faces(views, centroids)
        assert labels[0] == labels[1]  # head
        assert labels[2] == labels[3]  # body
        assert labels[0] != labels[2]  # different parts


class TestOverlappingMasks:
    def test_smallest_area_wins(self) -> None:
        """When masks overlap, the smallest-area mask wins."""
        face_id_map = np.array(
            [[0, 1, 2, 3], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
            dtype=np.int32,
        )
        # Large mask covers all 4 faces
        mask_body = np.zeros((4, 4), dtype=bool)
        mask_body[0, :] = True

        # Small mask covers only face 0
        mask_head = np.zeros((4, 4), dtype=bool)
        mask_head[0, 0] = True

        centroids = np.random.randn(4, 3).astype(np.float32)
        views = [({"body": mask_body, "head": mask_head}, face_id_map)]

        labels = map_masks_to_faces(views, centroids)
        _ = 1 if labels[0] != labels[1] else 0
        # Face 0 should be labeled as head (smaller mask)
        assert labels[0] != labels[1]


class TestUnlabeledFaces:
    def test_nearest_neighbor_fill(self) -> None:
        """Unlabeled faces get filled via KDTree nearest-neighbor."""
        face_id_map = np.array(
            [[0, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
            dtype=np.int32,
        )
        mask = np.zeros((4, 4), dtype=bool)
        mask[0, 0] = True  # Only face 0 is masked

        # Face 0 at origin, face 1 nearby, face 2 far away
        centroids = np.array([[0, 0, 0], [0.1, 0, 0], [10, 10, 10]], dtype=np.float32)
        views = [({"body": mask}, face_id_map)]

        labels = map_masks_to_faces(views, centroids)
        # All faces should be labeled (NN fill)
        assert (labels >= 0).all()

    def test_no_masks_fallback_to_part_0(self) -> None:
        """If no masks match any faces, all get assigned to part 0."""
        _face_id_map = np.array(
            [[0, 1, 2, 3], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
            dtype=np.int32,
        )
        centroids = np.random.randn(4, 3).astype(np.float32)
        views = []  # No masks at all

        labels = map_masks_to_faces(views, centroids)
        assert (labels == 0).all()


class TestMultiView:
    def test_merge_across_views(self) -> None:
        """Faces labeled in different views should both be labeled."""
        # View 1: faces 0-3 visible
        fid_map_1 = np.array(
            [[0, 1, -1, -1], [2, 3, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
            dtype=np.int32,
        )
        mask_1 = np.zeros((4, 4), dtype=bool)
        mask_1[0, :2] = True  # Covers faces 0, 1

        # View 2: faces 4-7 visible
        fid_map_2 = np.array(
            [[4, 5, -1, -1], [6, 7, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
            dtype=np.int32,
        )
        mask_2 = np.zeros((4, 4), dtype=bool)
        mask_2[0, :2] = True  # Covers faces 4, 5

        centroids = np.random.randn(8, 3).astype(np.float32)
        views = [
            ({"head": mask_1}, fid_map_1),
            ({"head": mask_2}, fid_map_2),
        ]

        labels = map_masks_to_faces(views, centroids)
        # Faces 0, 1, 4, 5 should all be labeled as "head"
        assert labels[0] == labels[1] == labels[4] == labels[5]


class TestSymmetricPairs:
    def test_find_symmetric_pair(self) -> None:
        names = ["front_left_leg", "front_right_leg", "head"]
        assert _find_symmetric_pair("front_left_leg", names) == "front_right_leg"
        assert _find_symmetric_pair("front_right_leg", names) == "front_left_leg"
        assert _find_symmetric_pair("head", names) is None
