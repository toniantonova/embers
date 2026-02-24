# ─────────────────────────────────────────────────────────────────────────────
# Tests — Prompt Templates
# ─────────────────────────────────────────────────────────────────────────────

from app.pipeline.prompt_templates import get_canonical_prompt


class TestGetCanonicalPrompt:
    """Tests for get_canonical_prompt()."""

    def test_base_prompt_contains_noun(self):
        result = get_canonical_prompt("horse", "quadruped")
        assert "horse" in result

    def test_base_prompt_has_required_elements(self):
        result = get_canonical_prompt("horse", "quadruped")
        assert "3D render" in result
        assert "side view" in result
        assert "white background" in result
        assert "centered" in result
        assert "studio lighting" in result

    def test_quadruped_suffix(self):
        result = get_canonical_prompt("dog", "quadruped")
        assert "four legs visible" in result
        assert "standing pose" in result

    def test_biped_suffix(self):
        result = get_canonical_prompt("person", "biped")
        assert "T-pose" in result
        assert "symmetrical" in result

    def test_bird_suffix(self):
        result = get_canonical_prompt("eagle", "bird")
        assert "wings slightly spread" in result

    def test_fish_suffix(self):
        result = get_canonical_prompt("shark", "fish")
        assert "swimming pose" in result

    def test_vehicle_suffix(self):
        result = get_canonical_prompt("car", "vehicle")
        assert "three-quarter view" in result

    def test_aircraft_suffix(self):
        result = get_canonical_prompt("airplane", "aircraft")
        assert "both wings visible" in result

    def test_furniture_suffix(self):
        result = get_canonical_prompt("chair", "furniture")
        assert "all legs visible" in result

    def test_plant_suffix(self):
        result = get_canonical_prompt("tree", "plant")
        assert "roots to canopy" in result

    def test_building_suffix(self):
        result = get_canonical_prompt("castle", "building")
        assert "front-facing" in result

    def test_insect_suffix(self):
        result = get_canonical_prompt("butterfly", "insect")
        assert "wings spread" in result

    def test_unknown_type_gets_base_only(self):
        result = get_canonical_prompt("blob", "default")
        assert "3D render of a blob" in result
        # No category-specific suffix
        assert "four legs" not in result
        assert "T-pose" not in result

    def test_different_nouns_produce_different_prompts(self):
        horse = get_canonical_prompt("horse", "quadruped")
        eagle = get_canonical_prompt("eagle", "bird")
        assert horse != eagle


class TestPhraseVsSingleWordBranching:
    """Tests for the conditional prompt path: single words vs full phrases."""

    def test_single_word_uses_structured_template(self):
        """Single nouns get '3D render of a {noun}' template."""
        result = get_canonical_prompt("horse", "quadruped")
        assert result.startswith("3D render of a horse")

    def test_multi_word_uses_phrase_directly(self):
        """Multi-word phrases are used directly (no '3D render of a ...')."""
        result = get_canonical_prompt("a dragon blows fire", "custom")
        assert result.startswith("a dragon blows fire, 3D render")
        # Should NOT contain "3D render of a"
        assert "3D render of a" not in result

    def test_phrase_preserves_side_view(self):
        """Both paths include 'side view' for image consistency."""
        single = get_canonical_prompt("horse", "quadruped")
        phrase = get_canonical_prompt("a horse running fast", "quadruped")
        assert "side view" in single
        assert "side view" in phrase

    def test_phrase_still_gets_category_suffix(self):
        """Category suffixes apply to phrases too."""
        result = get_canonical_prompt("a big fluffy dog", "quadruped")
        assert "four legs visible" in result

    def test_whitespace_stripped(self):
        """Leading/trailing whitespace is stripped before branching."""
        result = get_canonical_prompt("  horse  ", "quadruped")
        assert "3D render of a horse" in result
        assert "  horse  " not in result

    def test_whitespace_phrase_stripped(self):
        """Phrase with whitespace is trimmed."""
        result = get_canonical_prompt("  a dragon blows fire  ", "custom")
        assert result.startswith("a dragon blows fire")

    def test_backward_compatible_with_existing_callers(self):
        """Existing single-noun callers get the exact same output format."""
        result = get_canonical_prompt("car", "vehicle")
        expected_start = "3D render of a car, side view, white background"
        assert result.startswith(expected_start)

    def test_empty_string_does_not_crash(self):
        """Empty string should not raise."""
        result = get_canonical_prompt("", "default")
        assert "3D render" in result

    def test_single_character_treated_as_single_word(self):
        """A single character is still a single word — uses structured template."""
        result = get_canonical_prompt("x", "default")
        assert "3D render of a x" in result

