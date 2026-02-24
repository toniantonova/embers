# ─────────────────────────────────────────────────────────────────────────────
# Inline Snapshot Tests — inline-snapshot
# ─────────────────────────────────────────────────────────────────────────────
# Demonstrates: inline-snapshot for capturing expected values directly
# in the test source code.
#
# Usage:
#   pytest --inline-snapshot=create    → fills in snapshot() values
#   pytest --inline-snapshot=update    → updates changed snapshots
#   pytest                             → compares against stored snapshots
#
# Unlike traditional .ambr snapshot files, the expected values live
# right next to the assertions, making diffs easier to review.
# ─────────────────────────────────────────────────────────────────────────────

from inline_snapshot import snapshot

from app.pipeline.prompt_templates import get_canonical_prompt
from app.pipeline.template_matcher import get_template


class TestTemplateSnapshots:
    """Snapshot the full prompt output for key nouns.

    These act as regression guards — if prompt templates change,
    the inline snapshots will fail and you can review the diff
    right in the source file.

    To create/refresh snapshots:
        pytest tests/test_snapshots.py --inline-snapshot=create
    """

    def test_horse_prompt(self):
        template = get_template("horse")
        prompt = get_canonical_prompt("horse", template.template_type)
        assert prompt == snapshot(
            "3D render of a horse, side view, white background, centered,"
            " full body visible, studio lighting, standing pose, four legs visible"
        )

    def test_person_prompt(self):
        template = get_template("person")
        prompt = get_canonical_prompt("person", template.template_type)
        assert prompt == snapshot(
            "3D render of a person, side view, white background, centered,"
            " full body visible, studio lighting, T-pose, symmetrical, arms extended"
        )

    def test_eagle_prompt(self):
        template = get_template("eagle")
        prompt = get_canonical_prompt("eagle", template.template_type)
        assert prompt == snapshot(
            "3D render of a eagle, side view, white background, centered,"
            " full body visible, studio lighting, wings slightly spread, perched"
        )

    def test_car_prompt(self):
        template = get_template("car")
        prompt = get_canonical_prompt("car", template.template_type)
        assert prompt == snapshot(
            "3D render of a car, side view, white background, centered,"
            " full body visible, studio lighting, three-quarter view, all wheels visible"
        )

    def test_unknown_prompt(self):
        """Unknown nouns get the base prompt with no type-specific suffix."""
        template = get_template("zygomorphic")
        prompt = get_canonical_prompt("zygomorphic", template.template_type)
        assert prompt == snapshot(
            "3D render of a zygomorphic, side view, white background,"
            " centered, full body visible, studio lighting"
        )


class TestTemplateMatcherSnapshots:
    """Snapshot template metadata for key lookups."""

    def test_horse_template(self):
        template = get_template("horse")
        assert template.template_type == snapshot("quadruped")
        assert template.num_parts == snapshot(6)
        assert template.part_names == snapshot(
            ["head", "body", "front_legs", "back_legs", "tail", "neck"]
        )

    def test_chair_template(self):
        template = get_template("chair")
        assert template.template_type == snapshot("furniture")
        assert template.num_parts == snapshot(3)
        assert template.part_names == snapshot(["seat", "backrest", "legs"])

    def test_unknown_gets_default(self):
        template = get_template("flibbertigibbet")
        assert template.template_type == snapshot("default")
        assert template.num_parts == snapshot(1)
