"""Face trait extraction using MediaPipe FaceLandmarker.

Mirrors the feature definitions used by the (now-retired) browser-side
face-api.js version, so the precomputed character trait vectors in
data/character_traits.json stay comparable: faceRatio (box width/height),
eyeSpacingRatio, eyeSizeRatio (both relative to face width), and average
skin / hair RGB color.
"""
import math
import os

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    FaceLandmarker,
    FaceLandmarkerOptions,
    RunningMode,
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task")

_landmarker = FaceLandmarker.create_from_options(
    FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=RunningMode.IMAGE,
        num_faces=1,
    )
)

# Key landmark indices in MediaPipe's 468-point face mesh.
LEFT_EYE = [33, 133, 159, 145]
RIGHT_EYE = [263, 362, 386, 374]
FOREHEAD_TOP = 10
CHIN_BOTTOM = 152
JAW_LEFT = 234
JAW_RIGHT = 454
# Both cheeks (inner and outer) — the chin often carries a beard or shadow.
SKIN_SAMPLE_POINTS = [50, 280, 101, 330]


def _avg_point(landmarks, indices, w, h):
    xs = [landmarks[i].x * w for i in indices]
    ys = [landmarks[i].y * h for i in indices]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _dist(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def _average_color_at(bgr_image, points, radius=4):
    h, w = bgr_image.shape[:2]
    total = np.zeros(3, dtype=np.float64)
    count = 0
    for x, y in points:
        x0 = max(0, int(x - radius))
        y0 = max(0, int(y - radius))
        x1 = min(w, int(x + radius))
        y1 = min(h, int(y + radius))
        if x1 <= x0 or y1 <= y0:
            continue
        patch = bgr_image[y0:y1, x0:x1].reshape(-1, 3)
        total += patch.sum(axis=0)
        count += patch.shape[0]
    if count == 0:
        return None
    b, g, r = total / count
    return {"r": float(r), "g": float(g), "b": float(b)}


def _average_color_in_box(bgr_image, x, y, w, h):
    ih, iw = bgr_image.shape[:2]
    x0 = max(0, int(x))
    y0 = max(0, int(y))
    x1 = min(iw, int(x + w))
    y1 = min(ih, int(y + h))
    if x1 <= x0 or y1 <= y0:
        return None
    patch = bgr_image[y0:y1, x0:x1].reshape(-1, 3)
    if patch.shape[0] == 0:
        return None
    b, g, r = patch.mean(axis=0)
    return {"r": float(r), "g": float(g), "b": float(b)}


def extract_traits(bgr_image):
    """Returns a trait dict with `detected` True/False, same shape as the
    frontend's old JS version."""
    h, w = bgr_image.shape[:2]
    rgb = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = _landmarker.detect(mp_image)

    if not result.face_landmarks:
        return {"detected": False}

    landmarks = result.face_landmarks[0]

    face_w = landmarks[JAW_RIGHT].x * w - landmarks[JAW_LEFT].x * w
    face_h = landmarks[CHIN_BOTTOM].y * h - landmarks[FOREHEAD_TOP].y * h
    face_w = abs(face_w) or 1.0
    face_h = abs(face_h) or 1.0
    face_ratio = face_w / face_h

    left_eye_center = _avg_point(landmarks, LEFT_EYE, w, h)
    right_eye_center = _avg_point(landmarks, RIGHT_EYE, w, h)
    eye_dist = _dist(left_eye_center, right_eye_center)
    eye_spacing_ratio = eye_dist / face_w

    left_eye_width = _dist(
        (landmarks[33].x * w, landmarks[33].y * h),
        (landmarks[133].x * w, landmarks[133].y * h),
    )
    right_eye_width = _dist(
        (landmarks[263].x * w, landmarks[263].y * h),
        (landmarks[362].x * w, landmarks[362].y * h),
    )
    eye_size_ratio = ((left_eye_width + right_eye_width) / 2) / face_w

    skin_points = [
        (landmarks[i].x * w, landmarks[i].y * h) for i in SKIN_SAMPLE_POINTS
    ]
    skin = _average_color_at(bgr_image, skin_points) or {"r": 200, "g": 170, "b": 150}

    # Hair: a band just above the forehead landmark, over the middle half of
    # the face. Reaching higher or wider samples the wall behind the head.
    top_x = landmarks[JAW_LEFT].x * w + face_w * 0.25
    top_y = max(0, landmarks[FOREHEAD_TOP].y * h - face_h * 0.22)
    hair = _average_color_in_box(bgr_image, top_x, top_y, face_w * 0.5, face_h * 0.15) or {
        "r": 60,
        "g": 50,
        "b": 50,
    }

    return {
        "detected": True,
        "faceRatio": face_ratio,
        "eyeSpacingRatio": eye_spacing_ratio,
        "eyeSizeRatio": eye_size_ratio,
        "skin": skin,
        "hair": hair,
    }
