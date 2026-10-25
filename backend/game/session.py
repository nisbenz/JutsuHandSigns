import time

import cv2

from .sign_detector import SignDetector
from .jutsu_catalog import sequence_for

HOLD_TIME = 0.5          # seconds a sign must be held to count
GRACE = 0.6              # seconds the sign can drop out before hold resets
TIME_LIMIT = 120.0       # soft cap so a stuck session still finishes
CAST_DURATION = 6.0      # seconds before the result card shows (the browser draws the effect)
SEQUENCE_LENGTH = 4

BOX_COLOR = (60, 220, 255)
MISS_COLOR = (60, 60, 255)
TEXT_COLOR = (255, 255, 255)
BANNER_BG = (10, 12, 18)


class JutsuSession:
    """One player's attempt at one jutsu. Owns its own sign detector;
    `process_frame` is called once per incoming frame and returns
    (annotated_frame_bgr, state_dict). The cast effect itself is rendered
    in the browser (web/src/fx), so the cast stage here is just a timer."""

    def __init__(self, skill_name):
        self.skill_name = skill_name
        self.sequence = sequence_for(skill_name, length=SEQUENCE_LENGTH)
        self.detector = SignDetector()

        self.stage = "play"
        self.idx = 0
        self.hold = 0.0
        self.misses = 0
        self.last_seen = time.time()
        self.start_time = time.time()
        self.cast_start = None
        self.power = None
        self.rating = None
        self._last_t = time.time()

    def close(self):
        pass

    def _dt(self):
        now = time.time()
        dt = max(0.0, min(0.1, now - self._last_t))
        self._last_t = now
        return dt

    def _finish_play(self):
        elapsed = time.time() - self.start_time
        power = 1.0 - self.misses * 0.08 - max(0.0, (elapsed - 8.0) / 40.0)
        power = max(0.25, min(1.0, power))
        self.power = power
        self.rating = "PERFECT!" if power >= 0.85 else "CLEAN" if power >= 0.6 else "TRAINED HARD"
        self.stage = "cast"
        self.cast_start = time.time()

    def process_frame(self, frame_bgr):
        dt = self._dt()
        # Sign detection only matters while the sequence is being played.
        detection = self.detector.detect(frame_bgr) if self.stage == "play" else None
        # Mirrored like the browser's selfie view (and the cast effect), so the
        # picture doesn't flip left/right when the jutsu fires. Detection above
        # still runs on the raw frame.
        canvas = cv2.flip(frame_bgr, 1)

        if self.stage == "play":
            target_sign = self.sequence[self.idx]

            if detection is not None:
                self.last_seen = time.time()
                if detection["en"] == target_sign:
                    self.hold += dt
                else:
                    self.hold = max(0.0, self.hold - dt * 2)
                    if self.hold == 0.0:
                        self.misses += 1
                if self.hold >= HOLD_TIME:
                    self.idx += 1
                    self.hold = 0.0
                    if self.idx >= len(self.sequence):
                        self._finish_play()
            else:
                if time.time() - self.last_seen > GRACE:
                    self.hold = 0.0

            if time.time() - self.start_time > TIME_LIMIT and self.stage == "play":
                self._finish_play()

            self._draw_play_hud(canvas, detection, target_sign)

        elif self.stage == "cast":
            if time.time() - self.cast_start > CAST_DURATION:
                self.stage = "done"

        state = {
            "stage": self.stage,
            "sequence": self.sequence,
            "idx": min(self.idx, len(self.sequence)),
            "total": len(self.sequence),
            "misses": self.misses,
        }
        if self.stage == "play":
            state["target_sign"] = self.sequence[self.idx]
            state["hold_progress"] = round(min(1.0, self.hold / HOLD_TIME), 2)
            state["detected_sign"] = detection["en"] if detection else None
        if self.stage in ("cast", "done"):
            state["power"] = round(self.power, 2)
            state["rating"] = self.rating

        return canvas, state

    def _draw_play_hud(self, canvas, detection, target_sign):
        h, w = canvas.shape[:2]

        if detection is not None:
            x1, y1, x2, y2 = (int(v) for v in detection["bbox"])
            x1, x2 = w - x2, w - x1  # bbox is in raw-frame coords; canvas is mirrored
            correct = detection["en"] == target_sign
            color = (90, 230, 120) if correct else BOX_COLOR
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 3, cv2.LINE_AA)
            label = f"{detection['en']} {detection['score']:.2f}"
            cv2.putText(canvas, label, (x1, max(20, y1 - 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)

        cv2.rectangle(canvas, (0, 0), (w, 64), BANNER_BG, -1)
        label = f"{self.idx + 1}/{len(self.sequence)}  Make: {target_sign}"
        cv2.putText(canvas, label, (20, 42), cv2.FONT_HERSHEY_SIMPLEX, 1.0, TEXT_COLOR, 2, cv2.LINE_AA)

        if self.misses:
            cv2.putText(canvas, f"misses: {self.misses}", (w - 170, 42),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, MISS_COLOR, 2, cv2.LINE_AA)
