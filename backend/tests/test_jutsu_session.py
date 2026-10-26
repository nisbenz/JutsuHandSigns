import numpy as np

from conftest import FixedDetector, detection
from game.session import JutsuSession, draw_detection

DT = 0.05


def test_frame_with_detection_does_not_crash(clock):
    det = FixedDetector("Ox")  # whatever the target is, a detection is present
    s = JutsuSession("Rasengan", detector=det, clock=clock)
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    clock.advance(DT)
    canvas, state = s.process_frame(frame)
    assert canvas.shape == frame.shape
    assert state["stage"] == "play" and state["detected_sign"] == "Ox"


def test_detection_box_is_mirrored():
    canvas = np.zeros((360, 640, 3), dtype=np.uint8)
    draw_detection(canvas, detection("Rat", bbox=(10, 100, 50, 140)), "Ox")
    cols = np.where(canvas[120].any(axis=1))[0]
    # box spans raw x 10..50 -> mirrored 590..630 (plus line thickness)
    assert cols.min() >= 585 and cols.max() <= 635


def test_plays_through_whole_sequence(clock):
    det = FixedDetector()
    s = JutsuSession("Rasengan", detector=det, clock=clock)
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    seen = []
    for _ in range(400):
        det.sign = s.progress.target_sign
        clock.advance(DT)
        _canvas, state = s.process_frame(frame)
        seen.append(state["idx"])
        if state["stage"] != "play":
            break
    assert state["stage"] == "cast"
    assert state["rating"] == "PERFECT!"
    assert sorted(set(seen)) == list(range(len(s.sequence) + 1))
