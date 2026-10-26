import time

import cv2

from .sign_detector import SignDetector
from .sign_progress import SignProgress
from .jutsu_catalog import sequence_for

TIME_LIMIT = 120.0       # soft cap so a stuck session still finishes
CAST_DURATION = 6.0      # seconds before the result card shows (the browser draws the effect)
SEQUENCE_LENGTH = 4

BOX_COLOR = (60, 220, 255)
MATCH_COLOR = (90, 230, 120)


def draw_detection(canvas, detection, target_sign, x_offset=0, raw_width=None):
    """Draws a detection box on the mirrored canvas. `bbox` is in raw-frame
    coords of a crop starting at `x_offset` in a raw frame `raw_width` wide."""
    if detection is None:
        return
    raw_width = canvas.shape[1] if raw_width is None else raw_width
    x1, y1, x2, y2 = (int(v) for v in detection["bbox"])
    x1, x2 = raw_width - (x2 + x_offset), raw_width - (x1 + x_offset)
    color = MATCH_COLOR if detection["en"] == target_sign else BOX_COLOR
    cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 3, cv2.LINE_AA)
    label = f"{detection['en']} {detection['score']:.2f}"
    cv2.putText(canvas, label, (x1, max(20, y1 - 12)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)


class JutsuSession:
    """One player's attempt at one jutsu. Owns its own sign detector;
    `process_frame` is called once per incoming frame and returns
    (annotated_frame_bgr, state_dict). The cast effect itself is rendered
    in the browser (web/src/fx), so the cast stage here is just a timer."""

    def __init__(self, skill_name, detector=None, clock=time.time):
        self.skill_name = skill_name
        self.clock = clock
        self.sequence = sequence_for(skill_name, length=SEQUENCE_LENGTH)
        self.detector = detector or SignDetector()

        now = clock()
        self.progress = SignProgress(self.sequence, now)
        self.stage = "play"
        self.start_time = now
        self.cast_start = None
        self.power = None
        self.rating = None
        self._last_t = now

    def close(self):
        pass

    def _dt(self):
        now = self.clock()
        dt = max(0.0, min(0.1, now - self._last_t))
        self._last_t = now
        return dt

    def _finish_play(self):
        elapsed = self.clock() - self.start_time
        power = 1.0 - self.progress.misses * 0.08 - max(0.0, (elapsed - 8.0) / 40.0)
        power = max(0.25, min(1.0, power))
        self.power = power
        self.rating = "PERFECT!" if power >= 0.85 else "CLEAN" if power >= 0.6 else "TRAINED HARD"
        self.stage = "cast"
        self.cast_start = self.clock()

    def process_frame(self, frame_bgr):
        dt = self._dt()
        now = self.clock()
        # Sign detection only matters while the sequence is being played.
        detection = self.detector.detect(frame_bgr) if self.stage == "play" else None
        # Mirrored like the browser's selfie view (and the cast effect), so the
        # picture doesn't flip left/right when the jutsu fires. Detection above
        # still runs on the raw frame.
        canvas = cv2.flip(frame_bgr, 1)

        if self.stage == "play":
            target_sign = self.progress.target_sign
            self.progress.update(detection["en"] if detection else None, dt, now)
            if self.progress.complete:
                self._finish_play()
            elif now - self.start_time > TIME_LIMIT:
                self._finish_play()

            # The sign / progress HUD is drawn by the frontend (Storm panel);
            # only the detection box belongs on the frame itself.
            draw_detection(canvas, detection, target_sign)

        elif self.stage == "cast":
            if now - self.cast_start > CAST_DURATION:
                self.stage = "done"

        state = {
            "stage": self.stage,
            "sequence": self.sequence,
            "idx": min(self.progress.idx, len(self.sequence)),
            "total": len(self.sequence),
            "misses": self.progress.misses,
        }
        if self.stage == "play":
            state["target_sign"] = self.progress.target_sign
            state["hold_progress"] = self.progress.hold_progress
            state["detected_sign"] = detection["en"] if detection else None
        if self.stage in ("cast", "done"):
            state["power"] = round(self.power, 2)
            state["rating"] = self.rating

        return canvas, state
