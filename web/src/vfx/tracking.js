// In-browser MediaPipe tracking for the cast phase. The backend only tells
// us *that* the sequence was completed; where the effect sits (palm, eyes)
// comes from these landmarkers running on the live <video> at full frame
// rate. Landmarkers are loaded once per page and shared across casts.
import { FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URLS = {
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  // "lite": body effects only need coarse joints, and it runs beside the others.
  pose: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  // Person-vs-background mask, for clones cut out of the camera frame.
  segment: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
};

let filesetPromise = null;
const landmarkerPromises = {};

export function loadLandmarker(kind) {
  if (!landmarkerPromises[kind]) {
    filesetPromise ??= FilesetResolver.forVisionTasks(WASM_URL);
    const promise = filesetPromise.then((vision) => {
      const baseOptions = { modelAssetPath: MODEL_URLS[kind], delegate: "GPU" };
      if (kind === "hand") {
        return HandLandmarker.createFromOptions(vision, { baseOptions, runningMode: "VIDEO", numHands: 1 });
      }
      if (kind === "segment") {
        return ImageSegmenter.createFromOptions(vision, {
          baseOptions,
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      }
      if (kind === "pose") {
        return PoseLandmarker.createFromOptions(vision, { baseOptions, runningMode: "VIDEO", numPoses: 1 });
      }
      return FaceLandmarker.createFromOptions(vision, { baseOptions, runningMode: "VIDEO", numFaces: 1 });
    });
    // A failed load (offline, blocked CDN) shouldn't poison later attempts.
    promise.catch(() => {
      if (landmarkerPromises[kind] === promise) delete landmarkerPromises[kind];
    });
    landmarkerPromises[kind] = promise;
  }
  return landmarkerPromises[kind];
}

// Maps a normalized landmark (raw, unmirrored video frame) to CSS pixels on
// a W x H viewport showing the video with object-fit: cover + selfie mirror.
// Must agree with coverUv() in the background shader (stage.js).
function coverMapper(W, H, vw, vh) {
  const scale = Math.max(W / vw, H / vh);
  const extX = vw * scale;
  const extY = vh * scale;
  const offX = (W - extX) / 2;
  const offY = (H - extY) / 2;
  return (lm) => ({ x: offX + (1 - lm.x) * extX, y: offY + lm.y * extY });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function smoothToward(cur, target, k) {
  for (const key of Object.keys(target)) {
    if (typeof target[key] === "number") cur[key] += (target[key] - cur[key]) * k;
  }
}

// Body joints we expose, by MediaPipe Pose index. L/R keep MediaPipe's
// (subject-relative) labels; effects only care that elbow follows shoulder.
const JOINTS = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
};
// Limb chains for effects that crawl along the body.
export const BODY_CHAINS = [
  ["lShoulder", "lElbow", "lWrist"],
  ["rShoulder", "rElbow", "rWrist"],
  ["lShoulder", "lHip"],
  ["rShoulder", "rHip"],
  ["lShoulder", "rShoulder"],
];

// Stand-in skeleton (viewport px) for when pose tracking hasn't locked on.
export function fallbackBody(W, H) {
  const s = H * 0.28;
  const cx = W / 2;
  const sy = H * 0.72;
  return {
    span: s,
    torsoX: cx,
    torsoY: sy + s * 0.7,
    joints: {
      nose: { x: cx, y: sy - s * 0.9 },
      lShoulder: { x: cx + s / 2, y: sy },
      rShoulder: { x: cx - s / 2, y: sy },
      lElbow: { x: cx + s * 0.8, y: sy + s * 0.8 },
      rElbow: { x: cx - s * 0.8, y: sy + s * 0.8 },
      lWrist: { x: cx + s * 0.7, y: sy + s * 1.5 },
      rWrist: { x: cx - s * 0.7, y: sy + s * 1.5 },
      lHip: { x: cx + s * 0.4, y: sy + s * 1.4 },
      rHip: { x: cx - s * 0.4, y: sy + s * 1.4 },
    },
  };
}

const LOST_AFTER = 0.25; // seconds without a detection before presence fades

export class Tracker {
  constructor(video, needs) {
    this.video = video;
    this.needs = needs;
    this.landmarkers = {};
    this.lastVideoTime = -1;
    // Everything below is in viewport CSS pixels.
    this.hand = { seen: false, presence: 0, sinceSeen: Infinity, x: 0, y: 0, size: 0, dirX: 0, dirY: -1 };
    this.face = {
      seen: false,
      presence: 0,
      sinceSeen: Infinity,
      roll: 0,
      span: 0, // distance between iris centers
      eyes: [
        { x: 0, y: 0, r: 0, cx: 0, cy: 0, halfW: 0, halfH: 0 },
        { x: 0, y: 0, r: 0, cx: 0, cy: 0, halfW: 0, halfH: 0 },
      ],
      // Mouth center + how open it is (lip gap / eye span), and nose tip.
      mouthX: 0,
      mouthY: 0,
      mouthOpen: 0,
      noseX: 0,
      noseY: 0,
    };
    this.body = {
      seen: false,
      presence: 0,
      sinceSeen: Infinity,
      span: 0, // shoulder width
      torsoX: 0,
      torsoY: 0,
      joints: Object.fromEntries(Object.keys(JOINTS).map((k) => [k, { x: 0, y: 0 }])),
    };
    // Person mask in raw (unmirrored) video orientation, row 0 = top,
    // 0..255 = background..person. Sample it through coverUv like the feed.
    this.segment = { seen: false, width: 0, height: 0, data: null, version: 0 };
    this._handTarget = null;
    this._faceTarget = null;
    this._bodyTarget = null;
  }

  async ready() {
    await Promise.all(
      this.needs.map(async (kind) => {
        this.landmarkers[kind] = await loadLandmarker(kind);
      })
    );
  }

  update(W, H, dt) {
    const v = this.video;
    if (v && v.readyState >= 2 && v.videoWidth && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      const map = coverMapper(W, H, v.videoWidth, v.videoHeight);
      if (this.landmarkers.hand) this._readHand(this.landmarkers.hand.detectForVideo(v, now), map);
      if (this.landmarkers.face) this._readFace(this.landmarkers.face.detectForVideo(v, now), map);
      if (this.landmarkers.pose) this._readPose(this.landmarkers.pose.detectForVideo(v, now), map);
      if (this.landmarkers.segment) this._readSegment(this.landmarkers.segment.segmentForVideo(v, now));
    }

    const k = 1 - Math.exp(-dt * 22);
    this._integrate(this.hand, this._handTarget, k, dt, smoothToward);
    this._integrate(this.face, this._faceTarget, k, dt, (cur, t, kk) => {
      smoothToward(cur, t, kk);
      t.eyes.forEach((e, i) => smoothToward(cur.eyes[i], e, kk));
    });
    this._integrate(this.body, this._bodyTarget, k, dt, (cur, t, kk) => {
      smoothToward(cur, t, kk);
      for (const name of Object.keys(t.joints)) smoothToward(cur.joints[name], t.joints[name], kk);
    });
    this._handTarget = null;
    this._faceTarget = null;
    this._bodyTarget = null;
    return this;
  }

  _integrate(cur, target, k, dt, smooth) {
    if (target) {
      // First sighting snaps (k = 1) instead of sliding in from (0, 0).
      smooth(cur, target, cur.seen ? k : 1);
      cur.seen = true;
      cur.sinceSeen = 0;
    } else {
      cur.sinceSeen += dt;
    }
    const want = cur.sinceSeen < LOST_AFTER ? 1 : 0;
    cur.presence += (want - cur.presence) * (1 - Math.exp(-dt * 8));
  }

  _readHand(result, map) {
    const lm = result.landmarks?.[0];
    if (!lm) return;
    // Palm center from the four finger-base knuckles; the wrist would drag
    // it down toward the forearm.
    const palm = map({
      x: (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4,
      y: (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4,
    });
    const wrist = map(lm[0]);
    // Wrist -> middle knuckle stays stable when the fingers curl.
    const size = dist(wrist, map(lm[9]));
    const len = dist(palm, wrist) || 1;
    this._handTarget = {
      x: palm.x,
      y: palm.y,
      size,
      dirX: (palm.x - wrist.x) / len,
      dirY: (palm.y - wrist.y) / len,
    };
  }

  _readFace(result, map) {
    const lm = result.faceLandmarks?.[0];
    if (!lm || lm.length < 478) return;
    // 468 = iris of the eye with corners 33/133 and lids 159/145;
    // 473 = iris of the eye with corners 362/263 and lids 386/374.
    const eye = (iris, cornerA, cornerB, lidTop, lidBottom) => {
      const a = map(lm[cornerA]);
      const b = map(lm[cornerB]);
      const top = map(lm[lidTop]);
      const bottom = map(lm[lidBottom]);
      const width = dist(a, b);
      const c = map(lm[iris]);
      return {
        x: c.x,
        y: c.y,
        r: Math.max(4, width * 0.28),
        // The eye *opening* is centered between the corners/lids, not on
        // the iris — the iris usually sits high in it.
        cx: (a.x + b.x) / 2,
        cy: (top.y + bottom.y) / 2,
        halfW: width / 2,
        halfH: dist(top, bottom) / 2,
      };
    };
    const eyes = [eye(468, 33, 133, 159, 145), eye(473, 362, 263, 386, 374)].sort((a, b) => a.x - b.x);
    const span = dist(eyes[0], eyes[1]);
    const upperLip = map(lm[13]);
    const lowerLip = map(lm[14]);
    const nose = map(lm[1]);
    this._faceTarget = {
      eyes,
      roll: Math.atan2(eyes[1].y - eyes[0].y, eyes[1].x - eyes[0].x),
      span,
      mouthX: (upperLip.x + lowerLip.x) / 2,
      mouthY: (upperLip.y + lowerLip.y) / 2,
      mouthOpen: dist(upperLip, lowerLip) / Math.max(span, 1),
      noseX: nose.x,
      noseY: nose.y,
    };
  }

  _readSegment(result) {
    const mask = result.confidenceMasks?.[0];
    if (mask) {
      const f = mask.getAsFloat32Array();
      const seg = this.segment;
      if (!seg.data || seg.data.length !== f.length) seg.data = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) seg.data[i] = f[i] * 255;
      seg.width = mask.width;
      seg.height = mask.height;
      seg.seen = true;
      seg.version++;
    }
    result.close();
  }

  _readPose(result, map) {
    const lm = result.landmarks?.[0];
    if (!lm) return;
    const joints = {};
    for (const [name, idx] of Object.entries(JOINTS)) joints[name] = map(lm[idx]);
    const span = dist(joints.lShoulder, joints.rShoulder);
    if (span < 8) return;
    // At a desk the hips are usually below the frame; MediaPipe then guesses
    // wildly, so place them a torso-length under the shoulders instead.
    const hipsVisible = (lm[23].visibility ?? 1) > 0.5 && (lm[24].visibility ?? 1) > 0.5;
    if (!hipsVisible) {
      joints.lHip = { x: joints.lShoulder.x, y: joints.lShoulder.y + span * 1.4 };
      joints.rHip = { x: joints.rShoulder.x, y: joints.rShoulder.y + span * 1.4 };
    }
    this._bodyTarget = {
      joints,
      span,
      torsoX: (joints.lShoulder.x + joints.rShoulder.x + joints.lHip.x + joints.rHip.x) / 4,
      torsoY: (joints.lShoulder.y + joints.rShoulder.y + joints.lHip.y + joints.rHip.y) / 4,
    };
  }
}
