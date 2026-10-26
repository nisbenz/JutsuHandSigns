// Water family: Water Prison (a wobbling sphere of water on the palm),
// Shark Bomb (a water shark bursts from the hand and hits the lens),
// Water Dragon (rises from below, coils around you, lunges at the camera)
// and Samehada (the scaled sword drinks the room's chakra).
import * as THREE from "three";
import { fallbackBody } from "../tracking";
import { SCREEN_VERT } from "../stage";
import { Sparks, disposeTree, easeOutBack, glowSprite, lerp, pxPerUnit, smooth, span } from "../kit";
import { SpineTube, resample, waterMaterial } from "../elements";
import { DragonModel } from "../dragon";
import { sfx } from "../../sfx";

const CYAN = new THREE.Color(0.45, 0.85, 1.0);

// Droplets stuck on the lens after a splash: round beads with a bright rim
// and a dark refracted core, sliding down and drying off.
const LENS_FRAG = /* glsl */ `
uniform float uTime, uAmount;
uniform vec2 uRes;
varying vec2 vUv;
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
void main() {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = vUv * aspect * 7.0;
  float a = 0.0;
  vec3 c = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (1.0 + float(k) * 0.9);
    vec2 cell = floor(q);
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      vec2 id = cell + vec2(i, j);
      vec2 h = hash2(id + float(k) * 17.0);
      if (h.x > 0.55) continue;
      vec2 center = id + h + vec2(0.0, -uTime * (0.05 + h.y * 0.25));
      float r = 0.12 + h.y * 0.25;
      float d = length(q - center) / r;
      if (d < 1.0) {
        float rim = smoothstep(0.65, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d));
        float spec = 1.0 - smoothstep(0.0, 0.25, length((q - center) / r - vec2(-0.35, 0.35)));
        c += vec3(0.85, 0.95, 1.0) * (rim * 0.6 + spec);
        a = max(a, 0.25 + rim * 0.4);
      }
    }
  }
  gl_FragColor = vec4(c * uAmount, a * uAmount);
}`;

class LensDrops {
  constructor(stage) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uRes: stage.bg.uniforms.uRes },
      vertexShader: SCREEN_VERT,
      fragmentShader: LENS_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }
  set(t, amount) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uAmount.value = amount;
  }
}

function handAnchor(st, h) {
  return {
    x: h.seen ? h.x : st.width * 0.5,
    y: h.seen ? h.y : st.height * 0.62,
    size: h.seen ? h.size : st.height * 0.15,
  };
}

// ---------------------------------------------------------------------------
export class WaterPrison {
  static needs = ["hand"];
  static duration = 6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.mat = waterMaterial({ opacity: 0.28 });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.mat);
    this.root.add(this.sphere);
    this.ringMat = waterMaterial({ opacity: 0.15, rim: [0.8, 1.1, 1.5] });
    this.rings = [0, 1, 2].map((i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75 + i * 0.08, 0.025, 8, 64), this.ringMat);
      ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.root.add(ring);
      return ring;
    });
    this.bubbles = new Sparks({ max: 300, color: new THREE.Color(0.8, 1.0, 1.2), size: 0.04, gravity: 1.5, drag: 1.5 });
    this.root.add(this.bubbles.points);
    stage.scene.add(this.root);
    this._c = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = WaterPrison.duration;
    const a = handAnchor(st, track.hand);
    const rPx = a.size * 1.6;
    const r = st.toWorldSize(rPx);
    st.toWorld(a.x, a.y, 0, this._c);
    const form = easeOutBack(span(t, 0.5, 1.4), 1.2);
    const burst = span(t, D - 0.7, D);
    const alpha = Math.min(1, form) * (1 - burst);

    // Inflow: droplets pulled in from all around before the sphere forms.
    if (t < 1.2) {
      for (let i = 0; i < Math.round(dt * 150); i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = r * (2 + Math.random() * 2);
        const life = 0.4 + Math.random() * 0.3;
        this.bubbles.spawn(this._c.x + Math.cos(ang) * d, this._c.y + Math.sin(ang) * d, 0, -Math.cos(ang) * d / life, -Math.sin(ang) * d / life, 0, life);
      }
    } else if (burst === 0) {
      for (let i = 0; i < Math.round(dt * 40); i++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = r * Math.sqrt(Math.random()) * 0.8;
        this.bubbles.spawn(this._c.x + Math.cos(ang) * rr, this._c.y + Math.sin(ang) * rr * 0.6 - r * 0.4, 0, 0, r * 0.4, 0, 0.8 + Math.random() * 0.6);
      }
    }
    if (burst > 0 && !this.splashed) {
      this.splashed = true;
      for (let i = 0; i < 160; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = r * (3 + Math.random() * 5);
        this.bubbles.spawn(this._c.x, this._c.y, 0, Math.cos(ang) * v, Math.sin(ang) * v, (Math.random() - 0.5) * v, 0.5 + Math.random() * 0.5);
      }
      this.bubbles.gravity = -r * 6;
      st.shake(0.012);
      sfx.select();
    }
    this.bubbles.setPixelScale(pxPerUnit(st));
    this.bubbles.material.uniforms.uSize.value = r * 0.07;
    this.bubbles.update(dt);

    // Surface wobble: three axes breathing out of phase.
    const s = r * Math.max(1e-4, form) * (1 + burst * 0.8);
    this.sphere.position.copy(this._c);
    this.sphere.scale.set(s * (1 + 0.05 * Math.sin(t * 5.1)), s * (1 + 0.05 * Math.sin(t * 4.3 + 1)), s * (1 + 0.04 * Math.sin(t * 6.2 + 2)));
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uAlpha.value = alpha;
    this.ringMat.uniforms.uTime.value = t;
    this.ringMat.uniforms.uAlpha.value = alpha;
    this.rings.forEach((ring, i) => {
      ring.position.copy(this._c);
      ring.scale.setScalar(s);
      ring.rotation.x += dt * (0.8 + i * 0.5);
      ring.rotation.y += dt * (1.1 - i * 0.3);
    });

    // Refraction: the sphere magnifies and swirls what's behind it.
    st.setWarp(a.x, a.y, rPx * 1.05 * Math.max(form, 0.01), -0.35 * alpha, 0.5 * alpha * Math.sin(t * 2));
    st.setLight(0, a.x, a.y, rPx * 2.2, CYAN, 0.5 * alpha);
    st.tint.setRGB(lerp(1, 0.9, alpha), lerp(1, 0.98, alpha), lerp(1, 1.1, alpha));
    st.darken = 0.15 * alpha;
    st.vignette = 0.2 + 0.25 * alpha;
    st.vignetteColor.setRGB(0, 0.02, 0.06);
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
// Shark built from a SpineTube (body) plus flat fins pinned to the spine.
function finGeometry(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  return new THREE.ShapeGeometry(shape);
}

class WaterShark {
  constructor(material) {
    this.segments = 40;
    this.tube = new SpineTube(material, { segments: this.segments, radial: 16 });
    this.group = new THREE.Group();
    this.group.add(this.tube.mesh);
    this.dorsal = new THREE.Mesh(finGeometry([[0, 0], [-0.5, 0], [-0.15, 0.7]]), material);
    this.tail = new THREE.Mesh(finGeometry([[0, 0], [-0.45, 0.6], [-0.25, 0], [-0.45, -0.45]]), material);
    this.pecs = [1, -1].map((s) => {
      const fin = new THREE.Mesh(finGeometry([[0, 0], [-0.35, 0], [-0.1, s * 0.45]]), material);
      this.group.add(fin);
      return fin;
    });
    this.eyes = [0, 1].map(() => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x041020 }));
      this.group.add(eye);
      return eye;
    });
    this.group.add(this.dorsal, this.tail);
    this.points = Array.from({ length: this.segments }, () => new THREE.Vector3());
    this.radii = new Float32Array(this.segments);
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
  }

  // head: world position; dir: unit swim direction; len: body length.
  pose(head, dir, len, t, wiggle) {
    const side = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (let i = 0; i < this.segments; i++) {
      const u = i / (this.segments - 1); // 0 tail -> 1 nose
      const back = (1 - u) * len;
      const sway = Math.sin(u * 5 - t * 13) * wiggle * len * (1 - u) ** 1.5;
      this.points[i].copy(head).addScaledVector(dir, -back).addScaledVector(side, sway);
      // Torpedo profile: thin tail, fat shoulders, rounded snout.
      const body = Math.sin(Math.PI * Math.min(1, u * 1.05) ** 0.75);
      this.radii[i] = len * 0.13 * Math.max(0.04, body) * (u > 0.92 ? 1 - (u - 0.92) * 6 : 1);
    }
    this.tube.update(this.points, this.radii);

    const frame = (i, target) => {
      const p = this.points[i];
      const tng = this.points[Math.min(i + 1, this.segments - 1)].clone().sub(this.points[Math.max(i - 1, 0)]).normalize();
      const s2 = new THREE.Vector3().crossVectors(up, tng).normalize();
      this._m.makeBasis(tng, up, s2);
      target.position.copy(p);
      target.quaternion.setFromRotationMatrix(this._m);
    };
    frame(Math.round(this.segments * 0.62), this.dorsal);
    this.dorsal.position.addScaledVector(up, this.radii[Math.round(this.segments * 0.62)] * 0.8);
    this.dorsal.scale.setScalar(len * 0.35);
    frame(1, this.tail);
    this.tail.scale.setScalar(len * 0.4);
    this.pecs.forEach((fin) => {
      frame(Math.round(this.segments * 0.72), fin);
      fin.rotateX(Math.PI / 2);
      fin.scale.setScalar(len * 0.3);
    });
    const ei = Math.round(this.segments * 0.9);
    this.eyes.forEach((eye, k) => {
      eye.position.copy(this.points[ei]).addScaledVector(side, (k ? 1 : -1) * this.radii[ei] * 0.8).addScaledVector(up, this.radii[ei] * 0.4);
      eye.scale.setScalar(len * 0.022);
    });
  }
}

export class SharkBomb {
  static needs = ["hand"];
  static duration = 4.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.mat = waterMaterial({ deep: [0.04, 0.2, 0.45], opacity: 0.55 });
    this.shark = new WaterShark(this.mat);
    this.root.add(this.shark.group);
    this.orbMat = waterMaterial({ opacity: 0.3 });
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.orbMat);
    this.root.add(this.orb);
    this.drops = new Sparks({ max: 500, color: new THREE.Color(0.7, 0.95, 1.2), size: 0.05, gravity: -6, drag: 0.8 });
    this.root.add(this.drops.points);
    this.lens = new LensDrops(stage);
    this.root.add(this.lens.mesh);
    stage.scene.add(this.root);
    this._palm = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const a = handAnchor(st, track.hand);
    st.toWorld(a.x, a.y, 0, this._palm);
    const r = st.toWorldSize(a.size);
    const LAUNCH = 0.9;
    const HIT = 2.5;

    // Gather a ball of water in the palm.
    const gather = smooth(span(t, 0, LAUNCH));
    this.orb.position.copy(this._palm);
    this.orb.scale.setScalar(Math.max(1e-4, r * 0.9 * gather * (t < LAUNCH ? 1 : 1 - span(t, LAUNCH, LAUNCH + 0.2))));
    this.orbMat.uniforms.uTime.value = t;

    // Swim: out of the palm across the room in profile (so the shark reads
    // as a shark), then a hard turn straight into the lens.
    const swim = span(t, LAUNCH, HIT);
    const visible = t >= LAUNCH && t < HIT + 0.05;
    this.shark.group.visible = visible;
    if (visible) {
      const side = a.x < st.width / 2 ? 1 : -1;
      const via = new THREE.Vector3(side * st.visW * 0.3, st.visH * 0.05, 1.2);
      const target = new THREE.Vector3(0, -0.3, 7.6);
      const at = (f) => {
        const k = f * f * (3 - 2 * f);
        const p = new THREE.Vector3().lerpVectors(this._palm, via, k);
        return p.lerp(new THREE.Vector3().lerpVectors(via, target, k), k);
      };
      const head = at(swim);
      const dir = at(Math.min(1, swim + 0.03)).sub(head).normalize();
      const len = r * 4.5 * smooth(span(t, LAUNCH, LAUNCH + 0.35));
      this.shark.pose(head, dir, Math.max(len, 1e-3), t, 0.12);
      this.mat.uniforms.uTime.value = t;
      if (Math.random() < 0.6) {
        const tail = this.shark.points[2];
        this.drops.spawn(tail.x, tail.y, tail.z, (Math.random() - 0.5) * r, (Math.random() - 0.3) * r, 0, 0.4);
      }
    }

    // Impact on the lens.
    const hit = t > HIT ? Math.exp(-(t - HIT) * 3) : 0;
    if (t > HIT && !this.hit) {
      this.hit = true;
      for (let i = 0; i < 220; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 6;
        this.drops.spawn(0, -0.3, 6, Math.cos(ang) * v, Math.sin(ang) * v, -Math.random() * 3, 0.5 + Math.random() * 0.6);
      }
      sfx.taiko();
    }
    this.lens.set(t, t > HIT ? 1 - span(t, HIT + 0.6, HIT + 2.0) : 0);
    this.drops.setPixelScale(pxPerUnit(st));
    this.drops.material.uniforms.uSize.value = r * 0.12;
    this.drops.update(dt);

    st.setLight(0, a.x, a.y, a.size * 3, CYAN, 0.6 * gather * (t < HIT ? 1 : 0));
    st.setWarp(st.width / 2, st.height / 2, st.height * 0.9, -0.25 * hit, 2 * hit);
    st.flash.setRGB(0.15 * hit, 0.3 * hit, 0.4 * hit);
    st.shake(0.03 * hit);
    st.darken = 0.15;
    st.tint.setRGB(0.92, 1, 1.08);
    st.aberration = 0.02 + 0.2 * hit;
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
export class WaterDragon {
  static needs = ["pose"];
  static duration = 6.2;

  static prebake() {
    DragonModel.prebake("dragon");
  }

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.mat = waterMaterial({ deep: [0.04, 0.22, 0.5], opacity: 0.5 });
    this.segments = 90;
    this.dragon = new DragonModel(this.mat, { segments: this.segments });
    this.root.add(this.dragon.group);
    this.points = Array.from({ length: this.segments }, () => new THREE.Vector3());
    this.eyes = [0, 1].map(() => {
      const eye = glowSprite(new THREE.Color(1.4, 1.8, 2.2));
      this.root.add(eye);
      return eye;
    });
    this.drops = new Sparks({ max: 500, color: new THREE.Color(0.6, 0.9, 1.2), size: 0.05, gravity: -5, drag: 0.5 });
    this.root.add(this.drops.points);
    this.lens = new LensDrops(stage);
    this.root.add(this.lens.mesh);
    stage.scene.add(this.root);
  }

  // Path the dragon swims along, s = 0 at the bottom of the frame. It spirals
  // up around the body, then (s > 1) dives straight at the camera.
  _path(s, c, R, H, out) {
    const k = Math.min(s, 1);
    const ang = k * Math.PI * 2.4 - Math.PI / 2;
    out.set(c.x + Math.cos(ang) * R, c.y - H * 0.55 + k * H * 1.1, Math.sin(ang) * R * 0.9);
    if (s > 1) {
      const f = Math.min(1, (s - 1) / 0.6);
      out.lerp(new THREE.Vector3(c.x * 0.3, c.y * 0.3, 7.4), f * f);
    }
    if (s < 0) out.y += s * H;
    return out;
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = WaterDragon.duration;
    const b = track.body.seen ? track.body : fallbackBody(st.width, st.height);
    const c = st.toWorld(b.torsoX, b.torsoY - b.span * 0.3);
    const R = st.toWorldSize(b.span) * 1.0;
    const H = st.visH * 0.9;

    const LUNGE = 4.3;
    const headS = t < LUNGE ? lerp(-0.15, 1.0, smooth(span(t, 0.2, LUNGE))) : 1 + span(t, LUNGE, LUNGE + 0.55) * 0.6;
    const bodyLen = 1.25;
    const raw = [];
    for (let i = 0; i < 40; i++) {
      const s = headS - (1 - i / 39) * bodyLen;
      raw.push(this._path(s, c, R, H, new THREE.Vector3()));
    }
    resample(raw, this.segments, this.points);
    const thick = st.toWorldSize(b.span) * 0.2;
    // Snarl as it rises, then the jaw gapes for the lunge.
    const jaw = Math.max(0.25 + 0.2 * Math.sin(t * 3), smooth(span(t, LUNGE - 0.4, LUNGE)));
    const { headPos, headFrame: f } = this.dragon.update(this.points, thick, t, jaw);
    this.mat.uniforms.uTime.value = t;
    const out = 1 - span(t, D - 0.6, D);
    this.mat.uniforms.uAlpha.value = out;
    const hs = thick * 3.2;
    this.eyes.forEach((eye, k) => {
      // Sculpted eye sockets sit at (0.3, 0.12, ±0.19) in head units.
      eye.position.copy(headPos).addScaledVector(f.t, hs * 0.3).addScaledVector(f.up, hs * 0.12).addScaledVector(f.side, (k ? 1 : -1) * hs * 0.19);
      eye.scale.setScalar(thick * 0.35);
      eye.material.opacity = out;
    });

    for (let i = 0; i < Math.round(dt * 90 * out); i++) {
      const p = this.points[Math.floor(Math.random() * this.segments)];
      this.drops.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.3, 0, 0, 0.5 + Math.random() * 0.4);
    }
    const HIT = LUNGE + 0.55;
    const hit = t > HIT ? Math.exp(-(t - HIT) * 3) : 0;
    if (t > HIT && !this.hit) {
      this.hit = true;
      sfx.taiko();
      for (let i = 0; i < 200; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 6;
        this.drops.spawn(0, 0, 6.5, Math.cos(ang) * v, Math.sin(ang) * v, -Math.random() * 3, 0.5 + Math.random() * 0.5);
      }
    }
    this.lens.set(t, t > HIT ? 1 - span(t, HIT + 0.5, D) : 0);
    this.drops.setPixelScale(pxPerUnit(st));
    this.drops.material.uniforms.uSize.value = thick * 0.3;
    this.drops.update(dt);

    const rise = smooth(span(t, 0, 1));
    st.tint.setRGB(lerp(1, 0.86, rise), lerp(1, 0.97, rise), lerp(1, 1.12, rise));
    st.darken = 0.25 * rise * out;
    st.desaturate = 0.25 * rise;
    st.vignette = 0.3 + 0.3 * rise;
    st.vignetteColor.setRGB(0, 0.02, 0.07);
    st.flash.setRGB(0.15 * hit, 0.3 * hit, 0.4 * hit);
    st.shake(0.003 * rise + 0.03 * hit);
    st.aberration = 0.02 + 0.2 * hit;
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
// Samehada: a huge bandaged club of scales and spikes that drinks chakra.
function buildSamehada() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x3d4f6e, roughness: 0.55, metalness: 0.1 });
  const pts = [];
  // Lathe profile along +Y: grip, swelling blade, rounded tip.
  for (let i = 0; i <= 24; i++) {
    const y = i / 24;
    const w = y < 0.22 ? 0.06 : 0.06 + 0.16 * Math.sin(Math.min(1, (y - 0.22) / 0.78) * Math.PI * 0.92);
    pts.push(new THREE.Vector2(w, y * 3));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), skin);
  g.add(body);
  const spikeGeo = new THREE.ConeGeometry(0.045, 0.16, 6);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x8fa6c8, roughness: 0.4 });
  const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, 90);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 90; i++) {
    const y = 0.25 + Math.random() * 0.72;
    const w = 0.06 + 0.16 * Math.sin(Math.min(1, (y - 0.22) / 0.78) * Math.PI * 0.92);
    const ang = Math.random() * Math.PI * 2;
    const nrm = new THREE.Vector3(Math.cos(ang), 0.25, Math.sin(ang)).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    m.compose(new THREE.Vector3(Math.cos(ang) * w, y * 3, Math.sin(ang) * w), q, new THREE.Vector3(1, 1, 1));
    spikes.setMatrixAt(i, m);
  }
  g.add(spikes);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a35, roughness: 0.9 }));
  wrap.position.y = 0.3;
  g.add(wrap);
  return { group: g, spikes };
}

export class Samehada {
  static needs = ["hand"];
  static duration = 5.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.root.add(new THREE.HemisphereLight(0xcfe0ff, 0x101820, 1.4));
    this.key = new THREE.DirectionalLight(0xffffff, 1.2);
    this.key.position.set(-2, 3, 4);
    this.root.add(this.key);
    const { group, spikes } = buildSamehada();
    this.sword = group;
    this.spikes = spikes;
    this.root.add(this.sword);
    this.glow = glowSprite(new THREE.Color(0.1, 0.3, 0.7));
    this.root.add(this.glow);
    this.wisps = new Sparks({ max: 700, color: new THREE.Color(0.4, 0.8, 1.6), size: 0.05, gravity: 0, drag: 0 });
    this.root.add(this.wisps.points);
    stage.scene.add(this.root);
    this._p = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = Samehada.duration;
    const a = handAnchor(st, track.hand);
    st.toWorld(a.x, a.y, 0.3, this._p);
    const r = st.toWorldSize(a.size);
    const appear = easeOutBack(span(t, 0, 0.7), 1.4);
    const out = 1 - span(t, D - 0.5, D);
    const drain = smooth(span(t, 0.8, D - 0.8));

    // Held from the grip, blade raised up and away from the wrist.
    const dir = new THREE.Vector3(track.hand.seen ? track.hand.dirX : 0.3, track.hand.seen ? -track.hand.dirY : 1, 0.35).normalize();
    this.sword.position.copy(this._p).addScaledVector(dir, -r * 0.6);
    this.sword.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const breathe = 1 + 0.04 * Math.sin(t * 6) * drain;
    this.sword.scale.setScalar(Math.max(1e-4, r * 1.05 * appear * out * breathe));
    this.spikes.scale.setScalar(1 + drain * 0.5);

    // Chakra pulled out of the room into the blade.
    const tip = this._p.clone().addScaledVector(dir, r * 2.5);
    for (let i = 0; i < Math.round(dt * 220 * drain * out); i++) {
      const sx = (Math.random() - 0.5) * st.visW;
      const sy = (Math.random() - 0.5) * st.visH;
      const life = 0.5 + Math.random() * 0.4;
      const tx = tip.x + (Math.random() - 0.5) * r;
      const ty = tip.y + (Math.random() - 0.5) * r * 2;
      this.wisps.spawn(sx, sy, 0, (tx - sx) / life, (ty - sy) / life, 0, life);
    }
    this.wisps.setPixelScale(pxPerUnit(st));
    this.wisps.material.uniforms.uSize.value = r * 0.1;
    this.wisps.update(dt);

    this.glow.position.copy(tip);
    this.glow.scale.setScalar(r * (3 + drain * 4));
    this.glow.material.opacity = drain * out;

    const tipPx = { x: a.x + dir.x * a.size * 2.5, y: a.y - dir.y * a.size * 2.5 };
    st.setLight(0, tipPx.x, tipPx.y, a.size * 4, CYAN, 0.8 * drain * out);
    // The room loses its chakra: colors and light drain away.
    st.desaturate = 0.7 * drain;
    st.darken = 0.4 * drain;
    st.tint.setRGB(lerp(1, 0.85, drain), lerp(1, 0.92, drain), lerp(1, 1.1, drain));
    st.vignette = 0.25 + 0.5 * drain;
    st.vignetteColor.setRGB(0, 0.01, 0.04);
    st.shake(0.002 * drain);
  }

  dispose() {
    disposeTree(this.root);
  }
}
