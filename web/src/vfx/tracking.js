// In-browser MediaPipe tracking for the cast phase. The backend only tells
// us *that* the sequence was completed; where the effect sits (palm, eyes)
// comes from these landmarkers running on the live <video> at full frame
// rate. Landmarkers are loaded once per page and shared across casts.
import { FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import { JOINTS, coverMapper, parseFace, parseHand, parsePose, smoothToward } from "./landmarks";

export { BODY_CHAINS, coverMapper, fallbackBody } from "./landmarks";

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

// `kind` is "hand" | "face" | "pose" | "segment", optionally followed by how
// many to detect ("pose2", "hand4", "face2" for duels). Each variant is its
// own cached instance, so duels never change what training casts track.
export function loadLandmarker(kind) {
  if (!landmarkerPromises[kind]) {
    filesetPromise ??= FilesetResolver.forVisionTasks(WASM_URL);
    const [, base, count] = /^([a-z]+)(\d*)$/.exec(kind);
    const num = Number(count) || 1;
    const promise = filesetPromise.then((vision) => {
      const baseOptions = { modelAssetPath: MODEL_URLS[base], delegate: "GPU" };
      if (base === "hand") {
        return HandLandmarker.createFromOptions(vision, { baseOptions, runningMode: "VIDEO", numHands: num });
      }
      if (base === "segment") {
        return ImageSegmenter.createFromOptions(vision, {
          baseOptions,
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      }
      if (base === "pose") {
        return PoseLandmarker.createFromOptions(vision, { baseOptions, runningMode: "VIDEO", numPoses: num });
      }
      return FaceLandmarker.createFromOptions(vision, { baseOptions, runningMode: "VIDEO", numFaces: num });
    });
    // A failed load (offline, blocked CDN) shouldn't poison later attempts.
    promise.catch(() => {
      if (landmarkerPromises[kind] === promise) delete landmarkerPromises[kind];
    });
    landmarkerPromises[kind] = promise;
  }
  return landmarkerPromises[kind];
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
    // The wrist isn't part of the smoothed hand state here.
    const { x, y, size, dirX, dirY } = parseHand(lm, map);
    this._handTarget = { x, y, size, dirX, dirY };
  }

  _readFace(result, map) {
    const face = parseFace(result.faceLandmarks?.[0], map);
    if (face) this._faceTarget = face;
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
    const body = parsePose(result.landmarks?.[0], map);
    if (body) this._bodyTarget = body;
  }
}
