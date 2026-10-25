"""Maps any skill name (from the frontend's skills.js roster) to:
  - a hand-sign sequence drawn from the REAL 12 canonical two-handed seals
    (Rat, Ox, Tiger, Hare, Dragon, Snake, Horse, Ram, Monkey, Bird, Dog,
    Boar) detected by the vendored YOLOX model — canon sequences for a few
    jutsu are pulled straight from the vendored jutsu.csv; everything else
    gets a deterministic (same skill -> same sequence, always) generated one.

The cast visual effects live in the frontend (web/src/fx/catalog.js).
"""
import csv
import hashlib
import os

from .sign_detector import CANONICAL_SIGNS, LABELS

_HERE = os.path.dirname(os.path.abspath(__file__))
JUTSU_CSV_PATH = os.path.join(_HERE, "data", "jutsu.csv")

_JP_TO_EN = {label["jp"]: label["en"] for label in LABELS}


def _load_canon_jutsus():
    """{lowercased english jutsu name: [English sign names]} from jutsu.csv."""
    canon = {}
    with open(JUTSU_CSV_PATH, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            en_name = row[3].strip()
            if not en_name:
                continue
            jp_signs = [c for c in row[4:] if c]
            en_signs = [_JP_TO_EN.get(jp) for jp in jp_signs]
            if any(s is None for s in en_signs):
                continue  # skip rows using the rare extras we don't train on
            key = en_name.lower()
            if key not in canon or len(en_signs) < len(canon[key]):
                canon[key] = en_signs
    return canon


CANON_JUTSUS = _load_canon_jutsus()
MAX_CANON_LENGTH = 6  # longer canon sequences (e.g. Water Dragon's 44) aren't practical to play


def _find_canon_sequence(skill_name):
    key = skill_name.strip().lower()
    for jutsu_key, signs in CANON_JUTSUS.items():
        if len(signs) > MAX_CANON_LENGTH:
            continue
        if jutsu_key in key or key in jutsu_key:
            return signs
    return None


def sequence_for(skill_name, length=4):
    canon = _find_canon_sequence(skill_name)
    if canon:
        return canon
    # Deterministic pseudo-random sequence from the skill name, so the same
    # skill always gets the same sequence across sessions.
    digest = hashlib.sha256(skill_name.strip().lower().encode("utf-8")).digest()
    return [CANONICAL_SIGNS[b % len(CANONICAL_SIGNS)] for b in digest[:length]]
