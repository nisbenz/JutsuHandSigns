"""PvP smoke test with the REAL YOLOX detector (no camera needed).

Builds one 1280x720 frame with hand-sign photo A in the raw RIGHT half
(= player 1, on the left of the mirrored screen) and photo B in the raw LEFT
half (= player 2), runs a real PvpMatch over it, and checks that each player
detected their own sign and landed a hit. Also reports process_frame timing.

Run:  .venv/bin/python tools/pvp_smoke.py [--p1 Tiger] [--p2 Snake]
"""
import argparse
import os
import statistics
import sys
import time

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from game.pvp import COUNTDOWN, MAX_HP, PvpMatch  # noqa: E402
from game.sign_progress import SignProgress  # noqa: E402

SIGNS_DIR = os.path.join(ROOT, "web", "public", "hand-signs")
DT = 0.08  # the browser streams a frame every 80 ms


def sign_photo(name, size):
    img = cv2.imread(os.path.join(SIGNS_DIR, name.lower() + ".jpg"))
    if img is None:
        sys.exit(f"no reference photo for sign {name!r}")
    return cv2.resize(img, (size, size))


def build_frame(p1_sign, p2_sign, w=1280, h=720):
    frame = np.full((h, w, 3), 40, dtype=np.uint8)
    size = 400
    y = (h - size) // 2
    left_x = (w // 2 - size) // 2
    frame[y:y + size, left_x:left_x + size] = sign_photo(p2_sign, size)
    frame[y:y + size, w // 2 + left_x:w // 2 + left_x + size] = sign_photo(p1_sign, size)
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--p1", default="Tiger")
    ap.add_argument("--p2", default="Snake")
    args = ap.parse_args()

    t = [1000.0]
    clock = lambda: t[0]  # noqa: E731
    match = PvpMatch([{"character": "p1", "skills": ["Smoke"]},
                      {"character": "p2", "skills": ["Smoke"]}], clock=clock)
    for player, sign in zip(match.players, (args.p1, args.p2)):
        player.progress = SignProgress([sign, "Rat", "Ox"], clock())

    frame = build_frame(args.p1, args.p2)
    timings, detected, hits = [], [set(), set()], []
    for _ in range(int((COUNTDOWN + 1.5) / DT)):
        t[0] += DT
        start = time.perf_counter()
        _canvas, state = match.process_frame(frame)
        if state["stage"] == "fight":
            timings.append((time.perf_counter() - start) * 1000)
        for i, p in enumerate(state["players"]):
            if p["detected_sign"]:
                detected[i].add(p["detected_sign"])
        hits += [e for e in state["events"] if e["type"] == "hit"]

    hp = [p.hp for p in match.players]
    print(f"P1 target {args.p1}: detected {sorted(detected[0])}")
    print(f"P2 target {args.p2}: detected {sorted(detected[1])}")
    print(f"HP after: {hp}  hits: {[(e['attacker'], e['kind']) for e in hits]}")
    print(f"process_frame: median {statistics.median(timings):.1f} ms, "
          f"p95 {sorted(timings)[int(len(timings) * 0.95)]:.1f} ms over {len(timings)} frames")

    ok = (detected[0] == {args.p1} and detected[1] == {args.p2}
          and hp[0] < MAX_HP and hp[1] < MAX_HP
          and {e["attacker"] for e in hits} == {0, 1})
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
