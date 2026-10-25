import { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";

// In-browser MediaPipe tracking for the cast effects: up to two hands, the
// body pose and the face mesh. Models are created once per page and shared
// across casts; only the ones a jutsu needs are loaded.

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_BASE = "https://storage.googleapis.com/mediapipe-models";

let visionPromise = null;
const modelPromises = {};

function vision() {
  if (!visionPromise) visionPromise = FilesetResolver.forVisionTasks(WASM_URL);
  return visionPromise;
}

function loadModel(kind) {
  if (modelPromises[kind]) return modelPromises[kind];
  modelPromises[kind] = vision().then((v) => {
    if (kind === "hands") {
      return HandLandmarker.createFromOptions(v, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }
    if (kind === "pose") {
      return PoseLandmarker.createFromOptions(v, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    }
    return FaceLandmarker.createFromOptions(v, {
      baseOptions: {
        modelAssetPath: `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
  });
  return modelPromises[kind];
}

// Raw tracking output, in normalized video coordinates (0..1, top-left,
// NOT mirrored). The renderer maps these to canvas pixels.
export class Tracker {
  constructor(video, need) {
    this.video = video;
    this.need = need;
    this.models = {};
    this.lastTime = -1;
    this.frame = 0;
    this.result = { hands: [], pose: null, face: null };
    this.disposed = false;
    for (const kind of ["hands", "pose", "face"]) {
      if (!need[kind]) continue;
      loadModel(kind)
        .then((m) => {
          if (!this.disposed) this.models[kind] = m;
        })
        .catch((err) => console.error(`[fx] ${kind} model failed to load`, err));
    }
  }

  update() {
    const v = this.video;
    if (!v || v.readyState < 2 || v.currentTime === this.lastTime) return this.result;
    this.lastTime = v.currentTime;
    this.frame += 1;
    const now = performance.now();

    if (this.models.hands) {
      const r = this.models.hands.detectForVideo(v, now);
      this.result.hands = (r.landmarks || []).map((lm, i) => ({
        lm,
        label: r.handednesses?.[i]?.[0]?.categoryName || String(i),
      }));
    }
    // Pose and face alternate frames when both run, to keep the frame rate up.
    const both = this.models.pose && this.models.face;
    if (this.models.pose && (!both || this.frame % 2 === 0)) {
      const r = this.models.pose.detectForVideo(v, now + 0.1);
      this.result.pose = r.landmarks?.[0] || null;
    }
    if (this.models.face && (!both || this.frame % 2 === 1)) {
      const r = this.models.face.detectForVideo(v, now + 0.2);
      this.result.face = r.faceLandmarks?.[0] || null;
    }
    return this.result;
  }

  dispose() {
    this.disposed = true;
  }
}

// Synthetic tracking for the effect gallery (?fxlab&mock): two hands
// circling, a face and a body, so every effect can be previewed without a
// camera. `zoom` > 1 frames the person closer, like a seated webcam user
// (head scaled about MOCK_HEAD and moved to `headY`).
export const MOCK_HEAD = { x: 0.5, y: 0.32 };

export function mockFraming(zoom = 1, headY = MOCK_HEAD.y) {
  return (x, y) => ({ x: 0.5 + (x - MOCK_HEAD.x) * zoom, y: headY + (y - MOCK_HEAD.y) * zoom });
}

export class MockTracker {
  constructor(zoom = 1, headY = MOCK_HEAD.y) {
    this.start = performance.now();
    this.frame = mockFraming(zoom, headY);
  }

  update() {
    const t = (performance.now() - this.start) / 1000;
    const hand = (cx, cy, phase) => {
      const x = cx + Math.sin(t * 0.8 + phase) * 0.04;
      const y = cy + Math.cos(t * 0.6 + phase) * 0.03;
      const lm = [];
      // Wrist below, fingers above: a roughly open palm ~0.18 tall.
      lm[0] = { x, y: y + 0.11 };
      const bases = [1, 5, 9, 13, 17];
      bases.forEach((b, f) => {
        const fx = x + (f - 2) * 0.025;
        for (let k = 0; k < 4; k++) lm[b + k] = { x: fx + (f === 0 ? -0.02 * k : 0), y: y + 0.03 - k * 0.025 };
      });
      return lm;
    };
    const face = [];
    for (let i = 0; i < 478; i++) face[i] = { x: 0.5, y: 0.32 };
    const set = (i, x, y) => (face[i] = { x, y });
    set(468, 0.535, 0.3); set(473, 0.465, 0.3);
    set(362, 0.515, 0.3); set(263, 0.56, 0.3); set(33, 0.44, 0.3); set(133, 0.485, 0.3);
    set(386, 0.537, 0.29); set(374, 0.537, 0.31); set(159, 0.462, 0.29); set(145, 0.462, 0.31);
    set(151, 0.5, 0.22); set(168, 0.5, 0.3); set(234, 0.41, 0.33); set(454, 0.59, 0.33);
    const pose = [];
    for (let i = 0; i < 33; i++) pose[i] = { x: 0.5, y: 0.5, visibility: 1 };
    pose[11] = { x: 0.62, y: 0.55, visibility: 1 };
    pose[12] = { x: 0.38, y: 0.55, visibility: 1 };
    pose[23] = { x: 0.58, y: 0.98, visibility: 0.3 };
    pose[24] = { x: 0.42, y: 0.98, visibility: 0.3 };
    const map = (lm) => lm.map((p) => ({ ...p, ...this.frame(p.x, p.y) }));
    return {
      hands: [
        { lm: map(hand(0.3, 0.55, 0)), label: "Left" },
        { lm: map(hand(0.7, 0.55, 2)), label: "Right" },
      ],
      pose: map(pose),
      face: map(face),
    };
  }

  dispose() {}
}
