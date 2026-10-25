"""Character matching.

The character trait vectors were measured on anime artwork (MediaPipe can't
detect drawn faces), while the user's traits come from MediaPipe on a real
webcam photo. The two live on different scales — a real face measures
faceRatio ~0.8 / eyeSpacing ~0.46, a drawn one ~1.08 / ~0.34 — so comparing
raw numbers made whichever character sat closest to "human" win every time.

Instead, each geometric trait is turned into a z-score within its own domain
(user vs. typical webcam faces, character vs. the other characters): a face
wider than the average person matches a character wider than the average
character. Hair colour is compared directly; skin is compared by relative
brightness plus hue, since webcam lighting shifts absolute values a lot.
"""
import json
import math
import os

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "character_traits.json")

with open(DATA_PATH, "r", encoding="utf-8") as f:
    CHARACTERS = json.load(f)

GEOMETRY = ("faceRatio", "eyeSpacingRatio", "eyeSizeRatio")

# Typical MediaPipe measurements for a frontal webcam face (mean, spread).
HUMAN_STATS = {
    "faceRatio": (0.80, 0.05),
    "eyeSpacingRatio": (0.46, 0.025),
    "eyeSizeRatio": (0.195, 0.015),
    "skinLuma": (120.0, 30.0),
}


def _luma(c):
    return 0.299 * c["r"] + 0.587 * c["g"] + 0.114 * c["b"]


def _chroma(c):
    total = c["r"] + c["g"] + c["b"] or 1.0
    return c["r"] / total, c["g"] / total


def _stats(values):
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)) or 1.0
    return mean, sd


# Characters whose traits were hand-filled (masked faces) carry no real
# geometry, so they don't contribute to the character-domain statistics.
_measured = [c["traits"] for c in CHARACTERS if not c["traits"].get("manual")]
CHARACTER_STATS = {k: _stats([t[k] for t in _measured]) for k in GEOMETRY}
CHARACTER_STATS["skinLuma"] = _stats([_luma(t["skin"]) for t in _measured])


def _z(value, stats):
    mean, sd = stats
    return (value - mean) / sd


def _color_dist(a, b):
    return math.sqrt(
        (a["r"] - b["r"]) ** 2 + (a["g"] - b["g"]) ** 2 + (a["b"] - b["b"]) ** 2
    ) / 441.67  # sqrt(3 * 255^2)


def trait_distance(user, char):
    # Geometry: z-score gap per trait, scaled so ~1 means "very different".
    if char.get("manual"):
        geo = 0.5  # unknown geometry: neutral, neither close nor far
    else:
        geo = sum(
            min(abs(_z(user[k], HUMAN_STATS[k]) - _z(char[k], CHARACTER_STATS[k])), 3.0)
            for k in GEOMETRY
        ) / (len(GEOMETRY) * 3.0)

    skin_luma = min(
        abs(_z(_luma(user["skin"]), HUMAN_STATS["skinLuma"])
            - _z(_luma(char["skin"]), CHARACTER_STATS["skinLuma"])),
        3.0,
    ) / 3.0
    ur, ug = _chroma(user["skin"])
    cr, cg = _chroma(char["skin"])
    skin_hue = min(math.hypot(ur - cr, ug - cg) / 0.1, 1.0)
    skin = (skin_luma + skin_hue) / 2

    hair = _color_dist(user["hair"], char["hair"])

    return 0.4 * geo + 0.2 * skin + 0.4 * hair


def best_match(user_traits):
    char, dist = min(
        ((c, trait_distance(user_traits, c["traits"])) for c in CHARACTERS),
        key=lambda pair: pair[1],
    )
    return {
        "id": char["id"],
        "name": char["name"],
        "file": char["file"],
        "distance": dist,
    }
