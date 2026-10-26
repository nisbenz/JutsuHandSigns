// Two-player tracking for duels. Runs multi-person MediaPipe landmarkers on
// the live video, assigns every detection to player 0 (screen left) or 1
// (screen right), smooths each player like the single-player Tracker, and
// hands out per-player views shaped exactly like Tracker, so existing jutsu
// effects can run scoped to one player.
import { loadLandmarker } from "../tracking";
import { coverMapper, parseFace, parseHand, parsePose, smoothToward } from "../landmarks";
import { assignBodies, assignFaces, assignHands, scopeView, splitMask } from "./people";

const LOST_AFTER = 0.25; // seconds without a detection before presence fades
const LANDMARKERS = { pose: "pose2", hand: "hand4", face: "face2", segment: "segment" };

function emptyPlayer() {
  return {
    hand: { seen: false, presence: 0, sinceSeen: Infinity, x: 0, y: 0, size: 0, dirX: 0, dirY: -1 },
    hands: [],
    face: null,
    body: null,
    segment: { seen: false, width: 0, height: 0, data: null, version: 0 },
    _handT: null,
    _faceT: null,
    _bodyT: null,
  };
}

function integrate(cur, target, k, dt, smooth) {
  if (target) {
    // First sighting snaps instead of sliding in from (0, 0).
    smooth(cur, target, cur.seen ? k : 1);
    cur.seen = true;
    cur.sinceSeen = 0;
  } else {
    cur.sinceSeen += dt;
    if (cur.sinceSeen > LOST_AFTER * 4) cur.seen = false;
  }
  const want = cur.sinceSeen < LOST_AFTER ? 1 : 0;
  cur.presence += (want - cur.presence) * (1 - Math.exp(-dt * 8));
}

export class DuelTracker {
  // needs: any of "pose", "hand", "face", "segment".
  constructor(video, needs = ["pose", "hand"]) {
    this.video = video;
    this.needs = new Set(needs);
    this.landmarkers = {};
    this.players = [emptyPlayer(), emptyPlayer()];
    this.views = [null, null];
    this.lastVideoTime = -1;
    this.tick = 0;
    this.prevBodyX = [null, null];
    this.loaded = false;
    this.segmentEvery = 3; // frames between person-mask updates

    // Milliseconds spent in detection last frame, for the stats overlay.
    this.ms = 0;
  }

  async ready() {
    await Promise.all(
      [...this.needs].map(async (kind) => {
        this.landmarkers[kind] = await loadLandmarker(LANDMARKERS[kind]);
      })
    );
    this.loaded = true;
  }

  // Load more landmarkers later (e.g. face for a Sharingan finisher).
  async need(kind) {
    if (this.landmarkers[kind]) return;
    this.needs.add(kind);
    this.landmarkers[kind] = await loadLandmarker(LANDMARKERS[kind]);
  }

  update(W, H, dt) {
    const v = this.video;
    const t0 = performance.now();
    if (v && v.readyState >= 2 && v.videoWidth && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      this.tick++;
      const now = performance.now();
      const map = coverMapper(W, H, v.videoWidth, v.videoHeight);
      const lm = this.landmarkers;
      // Alternate the heavy models so each runs at ~half the camera rate.
      if (lm.pose && (this.tick % 2 === 0 || !lm.hand)) this._readPose(lm.pose.detectForVideo(v, now), map, W);
      if (lm.hand && (this.tick % 2 === 1 || !lm.pose)) this._readHands(lm.hand.detectForVideo(v, now), map, W);
      if (lm.face && this.tick % 2 === 0) this._readFaces(lm.face.detectForVideo(v, now), map, W);
      if (lm.segment && this.tick % this.segmentEvery === 0) this._readSegment(lm.segment.segmentForVideo(v, now));
    }
    this.ms = performance.now() - t0;

    const k = 1 - Math.exp(-dt * 22);
    this.players.forEach((p, i) => {
      integrate(p.hand, p._handT, k, dt, smoothToward);
      if (p._faceT && !p.face) p.face = { seen: false, presence: 0, sinceSeen: Infinity, ...p._faceT };
      if (p.face) {
        integrate(p.face, p._faceT, k, dt, (cur, t, kk) => {
          smoothToward(cur, t, kk);
          t.eyes.forEach((e, j) => smoothToward(cur.eyes[j], e, kk));
        });
      }
      if (p._bodyT && !p.body) p.body = { seen: false, presence: 0, sinceSeen: Infinity, ...structuredClone(p._bodyT) };
      if (p.body) {
        integrate(p.body, p._bodyT, k, dt, (cur, t, kk) => {
          smoothToward(cur, t, kk);
          for (const name of Object.keys(t.joints)) smoothToward(cur.joints[name], t.joints[name], kk);
        });
        this.prevBodyX[i] = p.body.seen ? (p.body.joints.lShoulder.x + p.body.joints.rShoulder.x) / 2 : null;
      }
      p._handT = null;
      p._faceT = null;
      p._bodyT = null;
      this.views[i] = scopeView(p, i, W, H);
    });
    return this;
  }

  // Tracker-shaped view of one player (0 = left, 1 = right).
  view(i) {
    return this.views[i];
  }

  _bodies() {
    return this.players.map((p) => (p.body?.seen ? p.body : null));
  }

  _readPose(result, map, W) {
    const bodies = (result.landmarks ?? []).map((lm) => parsePose(lm, map)).filter(Boolean);
    assignBodies(bodies, W, this.prevBodyX).forEach((b, i) => {
      if (b) this.players[i]._bodyT = b;
    });
  }

  _readHands(result, map, W) {
    const hands = (result.landmarks ?? []).map((lm) => parseHand(lm, map));
    assignHands(hands, this._bodies(), W).forEach((list, i) => {
      const p = this.players[i];
      p.hands = list;
      if (!list.length) return;
      // Main hand: the one nearest last frame's, so it doesn't swap between
      // the player's two hands; the seal is two hands together anyway.
      const prev = p.hand.seen ? p.hand : null;
      const main = prev ? list.reduce((a, b) => (Math.hypot(a.x - prev.x, a.y - prev.y) <= Math.hypot(b.x - prev.x, b.y - prev.y) ? a : b)) : list[0];
      const { x, y, size, dirX, dirY } = main;
      p._handT = { x, y, size, dirX, dirY };
    });
  }

  _readFaces(result, map, W) {
    const faces = (result.faceLandmarks ?? []).map((lm) => parseFace(lm, map)).filter(Boolean);
    assignFaces(faces, this._bodies(), W).forEach((f, i) => {
      if (f) this.players[i]._faceT = f;
    });
  }

  _readSegment(result) {
    const mask = result.confidenceMasks?.[0];
    if (mask) {
      const f = mask.getAsFloat32Array();
      const full = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) full[i] = f[i] * 255;
      this.players.forEach((p, side) => {
        const seg = p.segment;
        seg.data = splitMask(full, mask.width, mask.height, side, Math.max(4, mask.width * 0.03), seg.data?.length === f.length ? seg.data : undefined);
        seg.width = mask.width;
        seg.height = mask.height;
        seg.seen = true;
        seg.version++;
      });
    }
    result.close();
  }
}
