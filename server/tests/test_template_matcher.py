# ─────────────────────────────────────────────────────────────────────────────
# Tests — Template Matcher
# ─────────────────────────────────────────────────────────────────────────────

from app.pipeline.template_matcher import TEMPLATES, TemplateInfo, get_template


class TestGetTemplate:
    """Tests for get_template()."""

    # ── Known nouns resolve correctly ────────────────────────────────────────

    def test_horse_is_quadruped(self):
        result = get_template("horse")
        assert result.template_type == "quadruped"
        assert "head" in result.part_names
        assert "body" in result.part_names
        assert "tail" in result.part_names

    def test_person_is_biped(self):
        result = get_template("person")
        assert result.template_type == "biped"
        assert "torso" in result.part_names
        assert "left_arm" in result.part_names

    def test_eagle_is_bird(self):
        result = get_template("eagle")
        assert result.template_type == "bird"
        assert "left_wing" in result.part_names

    def test_shark_is_fish(self):
        result = get_template("shark")
        assert result.template_type == "fish"
        assert "tail_fin" in result.part_names

    def test_car_is_vehicle(self):
        result = get_template("car")
        assert result.template_type == "vehicle"
        assert "wheels" in result.part_names

    def test_airplane_is_aircraft(self):
        result = get_template("airplane")
        assert result.template_type == "aircraft"
        assert "fuselage" in result.part_names

    def test_chair_is_furniture(self):
        result = get_template("chair")
        assert result.template_type == "furniture"
        assert "seat" in result.part_names

    def test_tree_is_plant(self):
        result = get_template("tree")
        assert result.template_type == "plant"
        assert "trunk" in result.part_names

    def test_castle_is_building(self):
        result = get_template("castle")
        assert result.template_type == "building"
        assert "walls" in result.part_names

    def test_butterfly_is_insect(self):
        result = get_template("butterfly")
        assert result.template_type == "insect"
        assert "thorax" in result.part_names

    # ── Case insensitivity ───────────────────────────────────────────────────

    def test_uppercase_works(self):
        result = get_template("HORSE")
        assert result.template_type == "quadruped"

    def test_mixed_case_works(self):
        result = get_template("Horse")
        assert result.template_type == "quadruped"

    def test_whitespace_stripped(self):
        result = get_template("  horse  ")
        assert result.template_type == "quadruped"

    # ── Unknown nouns fall back to default ───────────────────────────────────

    def test_unknown_noun_returns_default(self):
        result = get_template("xylophone")
        assert result.template_type == "default"
        assert result.part_names == ["body"]

    def test_empty_string_returns_default(self):
        result = get_template("")
        assert result.template_type == "default"

    def test_gibberish_returns_default(self):
        result = get_template("asdfghjkl")
        assert result.template_type == "default"

    # ── TemplateInfo properties ──────────────────────────────────────────────

    def test_num_parts_correct(self):
        result = get_template("horse")
        assert result.num_parts == 6

    def test_default_has_one_part(self):
        result = get_template("unknown_thing")
        assert result.num_parts == 1

    def test_returns_template_info(self):
        result = get_template("dog")
        assert isinstance(result, TemplateInfo)

    # ── Template data integrity ──────────────────────────────────────────────

    def test_all_templates_have_part_names(self):
        for type_name, data in TEMPLATES.items():
            assert "part_names" in data, f"{type_name} missing part_names"
            assert len(data["part_names"]) > 0, f"{type_name} has empty part_names"

    def test_all_templates_have_nouns(self):
        for type_name, data in TEMPLATES.items():
            assert "nouns" in data, f"{type_name} missing nouns key"

    def test_no_duplicate_nouns_across_templates(self):
        all_nouns: list[str] = []
        for data in TEMPLATES.values():
            all_nouns.extend(data["nouns"])
        assert len(all_nouns) == len(set(all_nouns)), "Duplicate nouns found across templates"
