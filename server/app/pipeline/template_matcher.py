# ─────────────────────────────────────────────────────────────────────────────
# Template Matcher — maps nouns to part template types
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TemplateInfo:
    """Result of matching a noun to a part template."""

    template_type: str
    part_names: list[str]

    @property
    def num_parts(self) -> int:
        return len(self.part_names)


# ── Template definitions ─────────────────────────────────────────────────────
# Each entry maps a template type to its part names and the nouns that match.

TEMPLATES: dict[str, dict[str, Any]] = {
    "quadruped": {
        "part_names": ["head", "body", "front_legs", "back_legs", "tail", "neck"],
        "nouns": [
            "horse",
            "dog",
            "cat",
            "cow",
            "lion",
            "tiger",
            "deer",
            "wolf",
            "bear",
            "elephant",
            "giraffe",
            "zebra",
            "fox",
            "rabbit",
            "pony",
            "stallion",
            "mare",
            "mustang",
            "puppy",
            "kitten",
            "leopard",
            "cheetah",
            "panther",
            "moose",
            "rhino",
            "hippo",
            "camel",
        ],
    },
    "biped": {
        "part_names": ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"],
        "nouns": [
            "person",
            "human",
            "man",
            "woman",
            "child",
            "robot",
            "soldier",
            "dancer",
            "astronaut",
            "knight",
            "warrior",
            "zombie",
            "skeleton",
            "angel",
            "devil",
            "ninja",
            "samurai",
            "pirate",
        ],
    },
    "bird": {
        "part_names": ["head", "body", "left_wing", "right_wing", "tail", "legs"],
        "nouns": [
            "bird",
            "eagle",
            "hawk",
            "owl",
            "parrot",
            "penguin",
            "flamingo",
            "crow",
            "raven",
            "dove",
            "sparrow",
            "hummingbird",
            "swan",
            "pelican",
            "toucan",
            "falcon",
            "vulture",
        ],
    },
    "fish": {
        "part_names": ["head", "body", "tail_fin", "dorsal_fin", "pectoral_fins"],
        "nouns": [
            "fish",
            "shark",
            "whale",
            "dolphin",
            "goldfish",
            "tuna",
            "swordfish",
            "ray",
            "seahorse",
            "octopus",
            "squid",
            "jellyfish",
        ],
    },
    "vehicle": {
        "part_names": ["body", "wheels", "windshield", "roof"],
        "nouns": [
            "car",
            "truck",
            "bus",
            "motorcycle",
            "van",
            "jeep",
            "taxi",
            "ambulance",
            "firetruck",
            "tractor",
        ],
    },
    "aircraft": {
        "part_names": ["fuselage", "left_wing", "right_wing", "tail", "engines"],
        "nouns": [
            "airplane",
            "jet",
            "helicopter",
            "plane",
            "biplane",
            "glider",
            "drone",
        ],
    },
    "furniture": {
        "part_names": ["seat", "backrest", "legs"],
        "nouns": [
            "chair",
            "stool",
            "bench",
            "throne",
            "couch",
            "sofa",
            "armchair",
            "recliner",
        ],
    },
    "plant": {
        "part_names": ["trunk", "canopy", "roots"],
        "nouns": [
            "tree",
            "palm",
            "oak",
            "pine",
            "willow",
            "birch",
            "maple",
            "cactus",
            "bamboo",
            "bonsai",
        ],
    },
    "building": {
        "part_names": ["walls", "roof", "windows", "door", "foundation"],
        "nouns": [
            "house",
            "building",
            "castle",
            "church",
            "cabin",
            "temple",
            "tower",
            "lighthouse",
            "barn",
            "mosque",
            "cathedral",
        ],
    },
    "insect": {
        "part_names": ["head", "thorax", "abdomen", "wings", "legs"],
        "nouns": [
            "butterfly",
            "bee",
            "dragonfly",
            "beetle",
            "ant",
            "spider",
            "moth",
            "wasp",
            "grasshopper",
            "ladybug",
            "scorpion",
        ],
    },
    "default": {
        "part_names": ["body"],
        "nouns": [],  # Fallback for unrecognized concepts
    },
}

# ── Pre-build reverse lookup: noun → template_type ───────────────────────────
_NOUN_TO_TYPE: dict[str, str] = {}
for _type, _data in TEMPLATES.items():
    for _noun in _data["nouns"]:
        _NOUN_TO_TYPE[_noun.lower()] = _type


def get_template(noun: str) -> TemplateInfo:
    """Resolve a noun to its part template.

    Performs case-insensitive lookup. Returns the 'default' template
    (single 'body' part) for unrecognized nouns.

    Args:
        noun: The concept to look up (e.g., "horse", "airplane").

    Returns:
        TemplateInfo with template_type and part_names.
    """
    normalized = noun.strip().lower()
    template_type = _NOUN_TO_TYPE.get(normalized, "default")
    template_data = TEMPLATES[template_type]
    return TemplateInfo(
        template_type=template_type,
        part_names=template_data["part_names"],
    )
