import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Solid colors painted on each half of a test frame, so a fake detector can
# tell from the crop alone which half it was given (BGR).
RAW_LEFT_COLOR = (0, 0, 200)
RAW_RIGHT_COLOR = (200, 0, 0)


class FakeClock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt


def detection(sign, bbox=(10, 10, 50, 50)):
    return {"en": sign, "jp": "", "score": 0.9, "bbox": bbox}


class FixedDetector:
    """Returns whatever `self.sign` is set to, for any frame."""

    def __init__(self, sign=None):
        self.sign = sign

    def detect(self, _frame):
        return detection(self.sign) if self.sign else None


class HalfDetector:
    """Returns `signs['raw_left']` / `signs['raw_right']` depending on which
    painted half of the frame it was handed."""

    def __init__(self):
        self.signs = {"raw_left": None, "raw_right": None}
        self.calls = []

    def detect(self, crop):
        b, _g, r = crop.reshape(-1, 3).mean(axis=0)
        half = "raw_right" if b > r else "raw_left"
        self.calls.append((half, crop.shape))
        sign = self.signs[half]
        return detection(sign) if sign else None


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def painted_frame():
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    frame[:, :320] = RAW_LEFT_COLOR
    frame[:, 320:] = RAW_RIGHT_COLOR
    return frame
