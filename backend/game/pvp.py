"""1v1 duel on one shared webcam. The browser shows a mirrored selfie view
split down the middle: player 1 on the left of the screen, player 2 on the
right. Each player works through their own hand-sign sequences; every sign
they land hits the opponent, and finishing a whole sequence lands a jutsu."""
import math
import random
import time

import cv2
import numpy as np

from .jutsu_catalog import sequence_for
from .session import draw_detection
from .sign_progress import SignProgress

MAX_HP = 100
SIGN_DAMAGE = 6
JUTSU_DAMAGE = 20
ROUND_TIME = 90.0
COUNTDOWN = 3.0
PVP_SEQUENCE_LENGTH = 3
KO_HOLD = 4.0            # seconds the KO screen stays in stage "ko" before "done"

DIVIDER_COLOR = (255, 255, 255)


class Player:
    def __init__(self, character, skills, now):
        self.character = character
        self.skills = list(skills)
        self.skill_idx = 0
        self.hp = MAX_HP
        self.jutsu_landed = 0
        self.detected = None
        self.bbox = None
        self.progress = SignProgress(sequence_for(self.skill, PVP_SEQUENCE_LENGTH), now)

    @property
    def skill(self):
        return self.skills[self.skill_idx]

    def next_skill(self, now):
        self.skill_idx = (self.skill_idx + 1) % len(self.skills)
        self.progress = SignProgress(sequence_for(self.skill, PVP_SEQUENCE_LENGTH), now)

    def state(self):
        return {
            "hp": self.hp,
            "max_hp": MAX_HP,
            "character": self.character,
            "skill": self.skill,
            "sequence": self.progress.sequence,
            "idx": self.progress.idx,
            "total": self.progress.total,
            "target_sign": self.progress.target_sign,
            "hold_progress": self.progress.hold_progress,
            "detected_sign": self.detected,
            "bbox": self.bbox,
            "jutsu_landed": self.jutsu_landed,
        }


def screen_bbox(detection, x_offset, frame_w, frame_h):
    """Detection box (raw crop pixels) -> [x1, y1, x2, y2] normalised to the
    full frame AS THE BROWSER SHOWS IT (mirrored), for the duel's reticles."""
    x1, y1, x2, y2 = detection["bbox"]
    mx1 = frame_w - (x2 + x_offset)
    mx2 = frame_w - (x1 + x_offset)
    return [round(max(0.0, min(1.0, v)), 4)
            for v in (mx1 / frame_w, y1 / frame_h, mx2 / frame_w, y2 / frame_h)]


def split_halves(frame_bgr):
    """[(x_offset, crop)] per player. The browser mirrors the feed, so the
    player on the LEFT of the screen is in the RIGHT half of the raw frame."""
    w = frame_bgr.shape[1]
    mid = w // 2
    return [
        (mid, np.ascontiguousarray(frame_bgr[:, mid:])),  # player 1 (screen left)
        (0, np.ascontiguousarray(frame_bgr[:, :mid])),    # player 2 (screen right)
    ]


class PvpMatch:
    def __init__(self, players, detector=None, clock=time.time):
        if detector is None:
            from .sign_detector import SignDetector
            detector = SignDetector()
        self.detector = detector
        self.clock = clock
        now = clock()
        self.players = [Player(p["character"], p["skills"], now) for p in players]
        self.stage = "countdown"
        self.start_time = now
        self.fight_start = None
        self.ko_start = None
        self.winner = None
        self._last_t = now

    def close(self):
        pass

    def _dt(self, now):
        dt = max(0.0, min(0.1, now - self._last_t))
        self._last_t = now
        return dt

    def _detect(self, i, crop):
        # The dev-only fake detector needs to know whose half it is looking at.
        if hasattr(self.detector, "detect_player"):
            return self.detector.detect_player(i, self.players[i], crop)
        return self.detector.detect(crop)

    def _end(self, winner, now, events):
        self.stage = "ko"
        self.winner = winner
        self.ko_start = now
        events.append({"type": "ko", "winner": winner})

    def _fight(self, halves, frame_shape, dt, now, events):
        detections = [self._detect(i, crop) for i, (_x, crop) in enumerate(halves)]
        frame_h, frame_w = frame_shape[:2]
        damage = [0, 0]
        for i, (player, detection) in enumerate(zip(self.players, detections)):
            player.detected = detection["en"] if detection else None
            player.bbox = screen_bbox(detection, halves[i][0], frame_w, frame_h) if detection else None
            if not player.progress.update(player.detected, dt, now):
                continue
            defender = 1 - i
            damage[defender] += SIGN_DAMAGE
            events.append({"type": "hit", "attacker": i, "defender": defender,
                           "damage": SIGN_DAMAGE, "kind": "sign"})
            if player.progress.complete:
                damage[defender] += JUTSU_DAMAGE
                player.jutsu_landed += 1
                events.append({"type": "hit", "attacker": i, "defender": defender,
                               "damage": JUTSU_DAMAGE, "kind": "jutsu", "skill": player.skill})
                player.next_skill(now)

        # Damage lands after both players are processed, so a hit traded on
        # the same frame counts for both (and can end in a double KO).
        for player, dmg in zip(self.players, damage):
            player.hp = max(0, player.hp - dmg)

        down = [p.hp <= 0 for p in self.players]
        if all(down):
            self._end("draw", now, events)
        elif any(down):
            self._end(down.index(False), now, events)
        elif now - self.fight_start >= ROUND_TIME:
            a, b = (p.hp for p in self.players)
            self._end("draw" if a == b else (0 if a > b else 1), now, events)
        return detections

    def process_frame(self, frame_bgr):
        now = self.clock()
        dt = self._dt(now)
        events = []
        detections = [None, None]
        halves = split_halves(frame_bgr)

        if self.stage == "countdown" and now - self.start_time >= COUNTDOWN:
            self.stage = "fight"
            self.fight_start = now
            for p in self.players:
                p.progress.last_seen = now

        if self.stage == "fight":
            detections = self._fight(halves, frame_bgr.shape, dt, now, events)
        elif self.stage == "ko" and now - self.ko_start >= KO_HOLD:
            self.stage = "done"

        if self.stage != "fight":
            for p in self.players:
                p.detected = None
                p.bbox = None

        canvas = cv2.flip(frame_bgr, 1)
        h, w = canvas.shape[:2]
        cv2.line(canvas, (w // 2, 0), (w // 2, h), DIVIDER_COLOR, 2, cv2.LINE_AA)
        for (x_offset, _crop), player, detection in zip(halves, self.players, detections):
            draw_detection(canvas, detection, player.progress.target_sign, x_offset, w)

        state = {
            "stage": self.stage,
            "winner": self.winner,
            "players": [p.state() for p in self.players],
            "events": events,
        }
        if self.stage == "countdown":
            state["countdown"] = max(1, math.ceil(COUNTDOWN - (now - self.start_time)))
        if self.stage == "fight":
            state["time_left"] = round(max(0.0, ROUND_TIME - (now - self.fight_start)), 1)
        return canvas, state


class FakeDuelDetector:
    """Dev-only stand-in (PVP_FAKE_DETECTOR=1): "performs" each player's
    current target sign after a random 0.5-2 s delay, so the whole duel can
    be played in a browser with no real hands in front of the camera."""

    def __init__(self, clock=time.time, rng=None):
        self.clock = clock
        self.rng = rng or random.Random()
        self.keys = [None, None]
        self.ready_at = [0.0, 0.0]

    def detect_player(self, i, player, crop):
        now = self.clock()
        key = (player.jutsu_landed, player.progress.idx)
        if key != self.keys[i]:
            self.keys[i] = key
            self.ready_at[i] = now + self.rng.uniform(0.5, 2.0)
        if now < self.ready_at[i] or player.progress.target_sign is None:
            return None
        h, w = crop.shape[:2]
        return {"en": player.progress.target_sign, "jp": "", "score": 0.99,
                "bbox": (w * 0.3, h * 0.3, w * 0.7, h * 0.7)}
