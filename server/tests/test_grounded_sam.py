# ─────────────────────────────────────────────────────────────────────────────
# Tests for Grounded SAM 2 prompt engineering
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from app.models.grounded_sam import _part_name_to_prompt


class TestPromptTransform:
    """Verify programmer-facing part names are transformed to natural language."""

    def test_underscore_to_space(self) -> None:
        assert _part_name_to_prompt("front_left_leg") == "the front left leg"

    def test_simple_name(self) -> None:
        assert _part_name_to_prompt("body") == "the body"

    def test_already_has_article(self) -> None:
        assert _part_name_to_prompt("the head") == "the head"

    def test_an_article(self) -> None:
        assert _part_name_to_prompt("an ear") == "an ear"

    def test_whitespace(self) -> None:
        assert _part_name_to_prompt("  head  ") == "the head"

    def test_multiple_underscores(self) -> None:
        assert _part_name_to_prompt("rear_right_leg") == "the rear right leg"
