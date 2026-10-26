// Pure landmark maths shared by the single-player Tracker (training casts)
// and the two-player DuelTracker: MediaPipe landmarks -> viewport pixels,
// and the hand / face / body shapes effects read. No MediaPipe import here,
// so it can be unit tested.

// Maps a normalized landmark (raw, unmirrored video frame) to CSS pixels on
// a W x H viewport showing the video with object-fit: cover + selfie mirror.
// Must agree with coverUv() in the background shader (stage.js).
export function coverMapper(W, H, vw, vh) {
  const scale = Math.max(W / vw, H / vh);
  const extX = vw * scale;
  const extY = vh * scale;
  const offX = (W - extX) / 2;
  const offY = (H - extY) / 2;
  return (lm) => ({ x: offX + (1 - lm.x) * extX, y: offY + lm.y * extY });
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function smoothToward(cur, target, k) {
  for (const key of Object.keys(target)) {
    if (typeof target[key] === "number") cur[key] += (target[key] - cur[key]) * k;
  }
}

// Body joints we expose, by MediaPipe Pose index. L/R keep MediaPipe's
// (subject-relative) labels; effects only care that elbow follows shoulder.
export const JOINTS = {
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


// One hand's landmarks -> { x, y (palm centre), size, dirX, dirY, wristX, wristY }.
export function parseHand(lm, map) {
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
  return {
    x: palm.x,
    y: palm.y,
    size,
    dirX: (palm.x - wrist.x) / len,
    dirY: (palm.y - wrist.y) / len,
    wristX: wrist.x,
    wristY: wrist.y,
  };
}

// One face's landmarks (478 with irises) -> eyes, roll, mouth, nose; or null.
export function parseFace(lm, map) {
  if (!lm || lm.length < 478) return null;
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
  return {
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

// One body's pose landmarks -> { joints, span, torsoX, torsoY }; or null.
export function parsePose(lm, map) {
  if (!lm) return null;
  const joints = {};
  for (const [name, idx] of Object.entries(JOINTS)) joints[name] = map(lm[idx]);
  const span = dist(joints.lShoulder, joints.rShoulder);
  if (span < 8) return null;
  // At a desk the hips are usually below the frame; MediaPipe then guesses
  // wildly, so place them a torso-length under the shoulders instead.
  const hipsVisible = (lm[23].visibility ?? 1) > 0.5 && (lm[24].visibility ?? 1) > 0.5;
  if (!hipsVisible) {
    joints.lHip = { x: joints.lShoulder.x, y: joints.lShoulder.y + span * 1.4 };
    joints.rHip = { x: joints.rShoulder.x, y: joints.rShoulder.y + span * 1.4 };
  }
  return {
    joints,
    span,
    torsoX: (joints.lShoulder.x + joints.rShoulder.x + joints.lHip.x + joints.rHip.x) / 4,
    torsoY: (joints.lShoulder.y + joints.rShoulder.y + joints.lHip.y + joints.rHip.y) / 4,
  };
}
