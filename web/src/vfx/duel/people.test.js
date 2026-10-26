import { describe, expect, it } from "vitest";
import { HYSTERESIS, assignBodies, assignFaces, assignHands, halfMask, scopeView, sideOfX, splitMask } from "./people";

const W = 1000;
const H = 600;

// A minimal parsed body centred at x (shoulder midpoint), span s.
function body(x, s = 120, y = 250) {
  const j = (dx, dy) => ({ x: x + dx, y: y + dy });
  return {
    span: s,
    torsoX: x,
    torsoY: y + s * 0.7,
    joints: {
      nose: j(0, -s * 0.9),
      lShoulder: j(s / 2, 0),
      rShoulder: j(-s / 2, 0),
      lElbow: j(s * 0.8, s * 0.8),
      rElbow: j(-s * 0.8, s * 0.8),
      lWrist: j(s * 0.7, s * 1.5),
      rWrist: j(-s * 0.7, s * 1.5),
      lHip: j(s * 0.4, s * 1.4),
      rHip: j(-s * 0.4, s * 1.4),
    },
  };
}
const hand = (wristX, wristY, size = 40) => ({ x: wristX, y: wristY - size, size, dirX: 0, dirY: -1, wristX, wristY });
const face = (noseX, noseY = 150) => ({ noseX, noseY, eyes: [], span: 40 });

describe("sideOfX", () => {
  it("splits at the middle", () => {
    expect(sideOfX(100, W)).toBe(0);
    expect(sideOfX(900, W)).toBe(1);
  });
  it("keeps a point on its side until it is HYSTERESIS past the divider", () => {
    const lean = W / 2 + W * HYSTERESIS * 0.5;
    expect(sideOfX(lean, W, 0)).toBe(0);
    expect(sideOfX(lean, W, null)).toBe(1);
    expect(sideOfX(W / 2 + W * HYSTERESIS * 1.5, W, 0)).toBe(1);
  });
});

describe("assignBodies", () => {
  it("puts the left person on player 0 and the right on player 1, in any order", () => {
    const [a, b] = [body(250), body(760)];
    expect(assignBodies([b, a], W)).toEqual([a, b]);
  });
  it("keeps the two biggest when there are extra detections", () => {
    const tiny = body(500, 20);
    const [a, b] = [body(250), body(760)];
    expect(assignBodies([tiny, b, a], W)).toEqual([a, b]);
  });
  it("assigns a lone person by half", () => {
    const b = body(800);
    expect(assignBodies([b], W)).toEqual([null, b]);
  });
  it("keeps a lone person who leans across the divider with their previous side", () => {
    const leaning = body(W / 2 + 30);
    expect(assignBodies([leaning], W, [W / 2 - 20, null])).toEqual([leaning, null]);
  });
  it("returns nobody for no detections", () => {
    expect(assignBodies([], W)).toEqual([null, null]);
  });
});

describe("assignHands", () => {
  it("assigns hands by half when nobody's pose is known", () => {
    const [l, r] = [hand(200, 400), hand(800, 400)];
    expect(assignHands([r, l], [null, null], W)).toEqual([[l], [r]]);
  });
  it("keeps a hand that reaches past the divider with the body whose wrist it is", () => {
    const p0 = body(380);
    // p0's lWrist is at 380 + 84 = 464; put a hand just past the middle near it.
    const reaching = hand(520, p0.joints.lWrist.y);
    expect(assignHands([reaching], [p0, null], W)).toEqual([[reaching], []]);
  });
  it("keeps at most two hands per player, biggest first", () => {
    const hs = [hand(100, 400, 30), hand(150, 400, 50), hand(200, 400, 40)];
    const [p0] = assignHands(hs, [null, null], W);
    expect(p0.map((h) => h.size)).toEqual([50, 40]);
  });
  it("handles no hands", () => {
    expect(assignHands([], [null, null], W)).toEqual([[], []]);
  });
});

describe("assignFaces", () => {
  it("matches faces to the nearest pose nose, else by half", () => {
    const p1 = body(760);
    const f1 = face(p1.joints.nose.x, p1.joints.nose.y);
    const f0 = face(200);
    expect(assignFaces([f1, f0], [null, p1], W)).toEqual([f0, f1]);
  });
});

describe("splitMask", () => {
  // 8x1 raw mask, everyone everywhere.
  const full = new Uint8Array(8).fill(200);
  it("keeps the raw RIGHT half for the screen-left player (raw is unmirrored)", () => {
    expect([...splitMask(full, 8, 1, 0, 0.001)]).toEqual([0, 0, 0, 0, 200, 200, 200, 200]);
    expect([...splitMask(full, 8, 1, 1, 0.001)]).toEqual([200, 200, 200, 200, 0, 0, 0, 0]);
  });
  it("feathers across the seam and the two halves add back up", () => {
    const a = splitMask(full, 8, 1, 0, 4);
    const b = splitMask(full, 8, 1, 1, 4);
    expect(a[3]).toBeGreaterThan(0);
    expect(a[3]).toBeLessThan(200);
    for (let i = 0; i < 8; i++) expect(a[i] + b[i]).toBeGreaterThanOrEqual(199);
  });
  it("halfMask covers the player's half in raw orientation", () => {
    expect([...halfMask(0).data]).toEqual([0, 255]);
    expect([...halfMask(1).data]).toEqual([255, 0]);
  });
});

describe("scopeView", () => {
  const untracked = { hand: { seen: false }, face: null, body: null, segment: { seen: false } };
  it("puts an untracked player's hand, body and face inside their own half", () => {
    for (const side of [0, 1]) {
      const v = scopeView(untracked, side, W, H);
      const inHalf = (x) => (side === 0 ? x > 0 && x < W / 2 : x > W / 2 && x < W);
      expect(v.hand.seen).toBe(true);
      expect(v.hand.tracked).toBe(false);
      expect(inHalf(v.hand.x)).toBe(true);
      expect(inHalf(v.body.torsoX)).toBe(true);
      Object.values(v.body.joints).forEach((j) => expect(inHalf(j.x)).toBe(true));
      expect(inHalf(v.face.noseX)).toBe(true);
      v.face.eyes.forEach((e) => expect(inHalf(e.x)).toBe(true));
    }
  });
  it("passes real tracking through, marked tracked", () => {
    const b = { ...body(300), seen: true, presence: 1 };
    const h = { seen: true, presence: 1, x: 320, y: 420, size: 50, dirX: 0, dirY: -1 };
    const v = scopeView({ hand: h, body: b, face: null, segment: { seen: false } }, 0, W, H);
    expect(v.hand).toMatchObject({ x: 320, y: 420, tracked: true });
    expect(v.body).toMatchObject({ torsoX: 300, tracked: true });
    // The face falls back to the tracked body's nose.
    expect(v.face.noseX).toBe(b.joints.nose.x);
  });
});
