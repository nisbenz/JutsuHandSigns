// Pure logic for tracking two players on one camera: which detected body,
// hand and face belongs to whom, splitting the person mask per player, and
// the per-player view effects read. Player 0 stands on the LEFT of the
// (mirrored) screen, player 1 on the right. No MediaPipe or Three.js here,
// so it is unit tested (people.test.js).
import { dist, fallbackBody } from "../landmarks";

// Fraction of the screen width a player can lean past the divider before
// they are counted on the other side.
export const HYSTERESIS = 0.06;

// Which half (0 = left, 1 = right) a screen x belongs to. A point that was
// on `prevSide` stays there until it is HYSTERESIS past the divider.
export function sideOfX(x, W, prevSide = null) {
  const mid = W / 2;
  const h = W * HYSTERESIS;
  if (prevSide === 0 && x < mid + h) return 0;
  if (prevSide === 1 && x > mid - h) return 1;
  return x < mid ? 0 : 1;
}

const shoulderMidX = (b) => (b.joints.lShoulder.x + b.joints.rShoulder.x) / 2;

// bodies: parsed poses (any order). prevX: [x | null, x | null], each
// player's shoulder midpoint last frame. Returns [body | null, body | null].
export function assignBodies(bodies, W, prevX = [null, null]) {
  const out = [null, null];
  // Two (or more) people: the two biggest, left one is player 0.
  if (bodies.length >= 2) {
    const two = [...bodies].sort((a, b) => b.span - a.span).slice(0, 2);
    two.sort((a, b) => shoulderMidX(a) - shoulderMidX(b));
    return two;
  }
  if (bodies.length === 1) {
    const b = bodies[0];
    const x = shoulderMidX(b);
    // Keep it with whoever it was nearest to last frame, if anyone was close.
    let prevSide = null;
    let best = W * 0.2;
    prevX.forEach((px, i) => {
      if (px != null && Math.abs(px - x) < best) {
        best = Math.abs(px - x);
        prevSide = i;
      }
    });
    out[sideOfX(x, W, prevSide)] = b;
  }
  return out;
}

// hands: parsed hands (with wristX / wristY). bodies: [body | null, body | null]
// from assignBodies. A hand belongs to the player whose wrist joint it is
// near (so a hand reaching past the divider stays with its owner); with no
// body near it, it goes by which half its wrist is in. Returns two arrays,
// biggest hand first, at most two each.
export function assignHands(hands, bodies, W) {
  const out = [[], []];
  for (const h of hands) {
    const wrist = { x: h.wristX, y: h.wristY };
    let owner = null;
    let best = Infinity;
    bodies.forEach((b, i) => {
      if (!b) return;
      const d = Math.min(dist(wrist, b.joints.lWrist), dist(wrist, b.joints.rWrist));
      if (d < b.span * 1.5 && d < best) {
        best = d;
        owner = i;
      }
    });
    out[owner ?? sideOfX(wrist.x, W)].push(h);
  }
  return out.map((list) => list.sort((a, b) => b.size - a.size).slice(0, 2));
}

// faces: parsed faces. Nearest to a player's pose nose wins; otherwise by half.
export function assignFaces(faces, bodies, W) {
  const out = [null, null];
  for (const f of faces) {
    const nose = { x: f.noseX, y: f.noseY };
    let owner = null;
    let best = Infinity;
    bodies.forEach((b, i) => {
      if (!b) return;
      const d = dist(nose, b.joints.nose);
      if (d < b.span && d < best) {
        best = d;
        owner = i;
      }
    });
    const side = owner ?? sideOfX(nose.x, W);
    if (!out[side]) out[side] = f;
  }
  return out;
}

// The person mask covers everyone; keep only `side`'s player, feathered over
// `feather` columns at the divider. The mask is in RAW video orientation
// (unmirrored), so the screen-left player (side 0) is the raw RIGHT half.
export function splitMask(data, width, height, side, feather = 8, out = new Uint8Array(data.length)) {
  const mid = width / 2;
  for (let x = 0; x < width; x++) {
    // 0 at the raw left edge side ... 1 on the raw right side, ramped at mid.
    // Measured from the pixel's centre, so an exact split lands on the middle.
    const t = Math.min(1, Math.max(0, (x + 0.5 - (mid - feather / 2)) / feather));
    const w = side === 0 ? t : 1 - t;
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      out[i] = data[i] * w;
    }
  }
  return out;
}

// Mask for a player we have no segmentation for: their whole half.
export function halfMask(side) {
  // 2x1, raw orientation: [raw-left, raw-right].
  return { seen: false, width: 2, height: 1, data: new Uint8Array(side === 0 ? [0, 255] : [255, 0]), version: 0 };
}

// Stand-in skeleton centred in the player's half.
export function halfBody(side, W, H) {
  const b = fallbackBody(W / 2, H);
  const dx = side * (W / 2);
  const joints = Object.fromEntries(Object.entries(b.joints).map(([k, p]) => [k, { x: p.x + dx, y: p.y }]));
  return { ...b, torsoX: b.torsoX + dx, joints };
}

// Builds the Tracker-shaped view an effect reads for one player. Everything
// is always `seen` (effects then never fall back to the screen centre, which
// in a duel is the divider); `tracked` says whether it is real.
// raw: { hand, hands, face, body, segment } with `seen`/`presence` from the
// tracker's smoothing (or null parts).
export function scopeView(raw, side, W, H) {
  const body = raw.body?.seen ? { ...raw.body, seen: true, tracked: true } : { ...halfBody(side, W, H), seen: true, tracked: false, presence: 1 };
  const cx = body.tracked ? body.torsoX : W * (side ? 0.75 : 0.25);

  const hand = raw.hand?.seen
    ? { ...raw.hand, seen: true, tracked: true }
    : { seen: true, tracked: false, presence: 1, x: cx, y: H * 0.6, size: H * 0.09, dirX: 0, dirY: -1 };

  let face;
  if (raw.face?.seen) {
    face = { ...raw.face, seen: true, tracked: true };
  } else {
    const nose = body.joints.nose;
    const span = Math.max(20, body.span * 0.32);
    const eye = (dx) => ({ x: nose.x + dx, y: nose.y - span * 0.35, r: span * 0.16, cx: nose.x + dx, cy: nose.y - span * 0.35, halfW: span * 0.3, halfH: span * 0.12 });
    face = {
      seen: true,
      tracked: false,
      presence: 1,
      eyes: [eye(-span / 2), eye(span / 2)],
      roll: 0,
      span,
      mouthX: nose.x,
      mouthY: nose.y + span * 0.6,
      mouthOpen: 0,
      noseX: nose.x,
      noseY: nose.y,
    };
  }

  const segment = raw.segment?.seen ? raw.segment : halfMask(side);
  return { side, hand, hands: raw.hands ?? [], face, body, segment };
}
