# ─────────────────────────────────────────────────────────────────────────────
# Prompt Templates — canonical SDXL prompts for mesh generation
# ─────────────────────────────────────────────────────────────────────────────


# ── Category-specific prompt suffixes ────────────────────────────────────────
# Appended after the base prompt to improve mesh quality for each category.

_CATEGORY_SUFFIXES: dict[str, str] = {
    "quadruped": ", standing pose, four legs visible",
    "biped": ", T-pose, symmetrical, arms extended",
    "bird": ", wings slightly spread, perched",
    "fish": ", swimming pose, fins visible",
    "vehicle": ", three-quarter view, all wheels visible",
    "aircraft": ", slight bank angle, both wings visible",
    "furniture": ", three-quarter view, all legs visible",
    "plant": ", full tree visible, roots to canopy",
    "building": ", front-facing, full structure visible",
    "insect": ", top-down slight angle, wings spread",
}


def get_canonical_prompt(noun: str, template_type: str) -> str:
    """Generate an SDXL Turbo prompt optimized for 3D mesh generation.

    The prompt wraps the user's input in a standardized template that
    produces consistent, well-composed images for downstream mesh
    generation (SDXL → PartCrafter / Hunyuan3D).

    For single nouns: "3D render of a horse, side view, ..."
    For full phrases: "a dragon blows fire, 3D render, side view, ..."
    This prevents grammatically broken prompts when the input is a sentence.

    Args:
        noun: The concept to generate — a single word ("horse") or a
              full phrase ("a dragon blows fire").
        template_type: The template category (e.g., "quadruped").

    Returns:
        A complete prompt string ready for SDXL Turbo.
    """
    stripped = noun.strip()

    if " " in stripped:
        # Full phrase — use directly with quality/lighting modifiers.
        # "side view" kept for image consistency across both branches.
        base = (
            f"{stripped}, 3D render, side view, white background, "
            f"centered, full body visible, studio lighting"
        )
    else:
        # Single noun — structured template
        base = (
            f"3D render of a {stripped}, side view, white background, "
            f"centered, full body visible, studio lighting"
        )

    suffix = _CATEGORY_SUFFIXES.get(template_type, "")
    return f"{base}{suffix}"
