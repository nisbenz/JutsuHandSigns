// Shadow family (Shikamaru): Shadow Possession (tendrils crawl over the lens
// and bind — the frame freezes), Shadow Strangle (shadow hands climb up and
// squeeze the frame) and Shadow Sewing (needles shoot out and pin the frame).
// All grow from a shadow pool spreading under the player.
import * as THREE from "three";
import { fallbackBody } from "../tracking";
import { NOISE_GLSL, Ghost, disposeTree, lerp, smooth, span } from "../kit";
import { InkRibbons } from "../elements";
import { sfx } from "../../sfx";

const POOL_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uGrow;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float n = snoise(vec3(p * 2.5, uTime * 0.6)) * 0.18 + snoise(vec3(p * 6.0, uTime)) * 0.06;
  float d = length(p) - uGrow + n;
  float a = 1.0 - smoothstep(-0.15, 0.02, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.015, 0.01, 0.02, a * 0.92);
}`;

// A wavy path from a to b, `n` points, lateral wiggle `amp` (world units).
function crawlPath(a, b, n, amp, phase) {
  const pts = [];
  const dir = b.clone().sub(a);
  const side = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const p = a.clone().lerp(b, u);
    p.addScaledVector(side, Math.sin(u * Math.PI * 2.2 + phase) * amp * Math.sin(u * Math.PI));
    pts.push(p);
  }
  return pts;
}

// First `g` (0..1) of a path, ending exactly at the growing tip.
function grown(points, g) {
  if (g <= 0) return [];
  const f = g * (points.length - 1);
  const k = Math.floor(f);
  const out = points.slice(0, k + 1);
  if (k < points.length - 1) out.push(points[k].clone().lerp(points[k + 1], f - k));
  return out;
}

class ShadowBase {
  static needs = ["pose"];

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.poolMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGrow: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.poolMat);
    this.pool.renderOrder = 1;
    this.root.add(this.pool);
    this.ink = new InkRibbons({ maxPoints: 9000 });
    this.ink.mesh.renderOrder = 2;
    this.root.add(this.ink.mesh);
    stage.scene.add(this.root);
  }

  // Pool at the bottom of the frame under the player; returns its center.
  _pool(t, track, grow) {
    const st = this.stage;
    const b = track.body.seen ? track.body : fallbackBody(st.width, st.height);
    const c = st.toWorld(b.torsoX, st.height * 0.97, 0.2);
    const w = st.toWorldSize(b.span) * 1.6;
    this.pool.position.copy(c);
    this.pool.scale.set(w, w * 0.32, 1);
    this.poolMat.uniforms.uTime.value = t;
    this.poolMat.uniforms.uGrow.value = grow;
    this.ink.material.uniforms.uTime.value = t;
    return c;
  }

  _grade(amount) {
    const st = this.stage;
    st.darken = 0.35 * amount;
    st.desaturate = 0.4 * amount;
    st.tint.setRGB(lerp(1, 0.9, amount), lerp(1, 0.92, amount), lerp(1, 1.05, amount));
    st.vignette = 0.25 + 0.5 * amount;
    st.vignetteColor.setRGB(0.01, 0.005, 0.02);
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
export class ShadowPossession extends ShadowBase {
  static duration = 6.5;

  constructor(stage) {
    super(stage);
    const st = stage;
    const hw = st.visW / 2;
    const hh = st.visH / 2;
    // Tendrils start on the bottom edge / lower sides and crawl to the center.
    this.tendrils = [-0.8, -0.45, -0.15, 0.15, 0.45, 0.8, -1, 1].map((x, i) => {
      const start = i < 6 ? new THREE.Vector3(x * hw, -hh * 1.02, 1) : new THREE.Vector3(x * hw * 1.02, -hh * 0.2, 1);
      const end = new THREE.Vector3((Math.random() - 0.5) * hw * 0.3, (Math.random() - 0.2) * hh * 0.3, 1);
      return { path: crawlPath(start, end, 40, hh * 0.12, i * 1.7), delay: i * 0.08 };
    });
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = ShadowPossession.duration;
    const LOCK = 3.0;
    const RELEASE = 5.3;
    this._pool(t, track, smooth(span(t, 0, 0.9)) * (1 - span(t, RELEASE + 0.4, D)));
    const ret = span(t, RELEASE, RELEASE + 0.8);
    this.ink.begin();
    for (const td of this.tendrils) {
      const g = smooth(span(t, 0.7 + td.delay, LOCK)) * (1 - ret);
      const pts = grown(td.path, g);
      if (pts.length > 1) this.ink.addBolt(pts, st.visH * 0.035, 0.95);
    }
    this.ink.end();

    // The bind: the image itself freezes — you can't move.
    if (t >= LOCK && !this.ghost) {
      this.ghost = new Ghost(st, st.snapshot());
      this.root.add(this.ghost.mesh);
      sfx.tick();
      sfx.back();
    }
    if (this.ghost) {
      const u = this.ghost.uniforms;
      u.uAlpha.value = 1 - span(t, RELEASE, RELEASE + 0.4);
      u.uTint.value.setRGB(0.85, 0.85, 0.9);
      u.uOffset.value.set((Math.random() - 0.5) * 0.002, (Math.random() - 0.5) * 0.002);
    }
    const lock = t > LOCK ? Math.exp(-(t - LOCK) * 5) : 0;
    this._grade(smooth(span(t, 0.3, LOCK)) * (1 - ret));
    st.shake(0.012 * lock);
    st.aberration = 0.02 + 0.15 * lock;
  }

  dispose() {
    this.ghost?.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
export class ShadowStrangle extends ShadowBase {
  static duration = 6;

  constructor(stage) {
    super(stage);
    const hw = stage.visW / 2;
    const hh = stage.visH / 2;
    this.arms = [
      [-0.95, -1.02, -0.25, -0.05],
      [0.95, -1.02, 0.25, -0.05],
      [-0.4, -1.02, -0.12, -0.25],
      [0.4, -1.02, 0.12, -0.25],
    ].map(([sx, sy, ex, ey], i) => {
      const a = new THREE.Vector3(sx * hw, sy * hh, 1.2);
      const b = new THREE.Vector3(ex * hw, ey * hh, 1.2);
      return { path: crawlPath(a, b, 36, hh * 0.1, i * 2.3), delay: i * 0.15, dir: b.clone().sub(a).normalize() };
    });
    this._squeezes = 0;
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = ShadowStrangle.duration;
    const GRAB = 2.6;
    this._pool(t, track, smooth(span(t, 0, 0.8)) * (1 - span(t, D - 0.6, D)));
    const ret = span(t, D - 0.8, D - 0.1);
    // Squeeze pulses after the grab.
    const sq = t > GRAB ? Math.max(0, Math.sin((t - GRAB) * 4.2)) ** 2 : 0;
    if (t > GRAB && Math.floor((t - GRAB) * 4.2 / Math.PI) >= this._squeezes && t < D - 0.8) {
      this._squeezes++;
      sfx.tick();
    }
    const unit = st.visH;
    this.ink.begin();
    for (const arm of this.arms) {
      const g = smooth(span(t, 0.6 + arm.delay, GRAB)) * (1 - ret);
      const pts = grown(arm.path, g);
      if (pts.length < 2) continue;
      this.ink.addBolt(pts, unit * 0.04, 0.95);
      // Hand: five fingers fanning from the wrist, curling in on squeeze.
      const tip = pts[pts.length - 1];
      const base = Math.atan2(arm.dir.y, arm.dir.x);
      const open = g > 0.85 ? (g - 0.85) / 0.15 : 0;
      for (let f = 0; f < 5; f++) {
        let ang = base + (f - 2) * 0.32 * open;
        const finger = [tip.clone()];
        const p = tip.clone();
        const curl = 0.25 + sq * 0.55;
        for (let k = 0; k < 4; k++) {
          ang += (f - 2) * -0.12 * curl - curl * 0.12 * Math.sign(arm.dir.x || 1);
          p.add(new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0).multiplyScalar(unit * 0.035 * open));
          finger.push(p.clone());
        }
        if (open > 0) this.ink.addBolt(finger, unit * 0.012, 0.95);
      }
    }
    this.ink.end();

    const grip = smooth(span(t, 0.4, GRAB)) * (1 - ret);
    this._grade(grip);
    st.vignette = 0.3 + 0.55 * grip + 0.15 * sq;
    // The frame is being choked: it pinches toward the center on each squeeze.
    st.setWarp(st.width / 2, st.height * 0.55, st.height * 0.8, 0.22 * sq * grip, 0);
    st.shake(0.006 * sq * grip);
    st.aberration = 0.02 + 0.06 * sq;
  }
}

// ---------------------------------------------------------------------------
export class ShadowSewing extends ShadowBase {
  static duration = 5.6;

  constructor(stage) {
    super(stage);
    const hw = stage.visW / 2;
    const hh = stage.visH / 2;
    this.needles = Array.from({ length: 16 }, (_, i) => ({
      at: 1.0 + i * 0.1 + Math.random() * 0.1,
      x0: (Math.random() - 0.5) * hw * 0.6,
      end: new THREE.Vector3((Math.random() - 0.5) * hw * 1.9, (Math.random() - 0.35) * hh * 1.6, 1 + Math.random()),
      bend: (Math.random() - 0.5) * hh * 0.25,
      hit: false,
    }));
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = ShadowSewing.duration;
    const c = this._pool(t, track, smooth(span(t, 0, 0.8)) * (1 - span(t, D - 0.5, D)));
    const ret = span(t, D - 1.0, D - 0.3);
    let hits = 0;
    this.ink.begin();
    for (const n of this.needles) {
      const g = span(t, n.at, n.at + 0.14) * (1 - ret);
      if (g <= 0) continue;
      const a = new THREE.Vector3(c.x + n.x0, c.y, 1);
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const u = (i / 12) * g;
        const p = a.clone().lerp(n.end, u);
        p.x += Math.sin(u * Math.PI) * n.bend;
        pts.push(p);
      }
      this.ink.addBolt(pts, st.visH * 0.012, 1);
      if (g >= 1 && !n.hit) {
        n.hit = true;
        hits++;
        sfx.tick();
      }
    }
    this.ink.end();
    if (hits) st.shake(0.008);
    this._grade(smooth(span(t, 0.3, 1.2)) * (1 - ret));
  }
}
