// Wood family (Hashirama, Yamato, Madara, Obito): Wood Release (branches
// grow out of the arms), Deep Forest Emergence (giant trees erupt from the
// ground), Wood Clone (a wooden copy of you rises beside you) and Four-Pillar
// House Prison (timber pillars slam up in front of the camera).
import * as THREE from "three";
import { fallbackBody } from "../tracking";
import { disposeTree, lerp, smooth, span } from "../kit";
import { Cutout, FULL_MASK, Puffs, SpineTube, barkMaterial, personCenterX, resample } from "../elements";
import { sfx } from "../../sfx";

const _v = new THREE.Vector3();

// A wandering growth path in local units, starting at the origin.
function growPath(dir, len, { steps = 10, curl = 0.35, rise = 0.15, depth = 0.25 } = {}) {
  const d = dir.clone().normalize();
  const p = new THREE.Vector3();
  const pts = [p.clone()];
  for (let i = 0; i < steps; i++) {
    d.x += (Math.random() - 0.5) * curl;
    d.y += (Math.random() - 0.5) * curl + rise;
    d.z += (Math.random() - 0.5) * depth;
    d.normalize();
    p.addScaledVector(d, len / steps);
    pts.push(p.clone());
  }
  return pts;
}

function grownPoints(points, g) {
  const f = g * (points.length - 1);
  const k = Math.floor(f);
  const out = points.slice(0, k + 1);
  if (k < points.length - 1) out.push(points[k].clone().lerp(points[k + 1], f - k));
  return out;
}

// One branch: a local path that grows over time from an anchor point.
class Branch {
  constructor(material, path, { radius = 0.1, start = 0, grow = 1, segments = 28, radial = 8, square = false } = {}) {
    this.tube = new SpineTube(material, { segments, radial: square ? 4 : radial });
    this.path = path;
    this.radius = radius;
    this.start = start;
    this.growTime = grow;
    this.segments = segments;
    this.square = square;
    this.points = Array.from({ length: segments }, () => new THREE.Vector3());
    this.radii = new Float32Array(segments);
    this.world = path.map(() => new THREE.Vector3());
  }

  // anchor: world origin of the path; unit: world units per path unit.
  update(t, anchor, unit, ease = smooth) {
    const g = ease(span(t, this.start, this.start + this.growTime));
    this.tube.mesh.visible = g > 0.01;
    if (!this.tube.mesh.visible) return g;
    this.path.forEach((p, i) => this.world[i].copy(p).multiplyScalar(unit).add(anchor));
    const vis = grownPoints(this.world, g);
    if (vis.length < 2) vis.push(vis[0].clone().add(_v.set(0, 1e-4, 0)));
    resample(vis, this.segments, this.points);
    for (let i = 0; i < this.segments; i++) {
      const u = i / (this.segments - 1);
      // Timbers stay square-cut; branches taper and come to a point.
      this.radii[i] = this.square ? this.radius * unit : this.radius * unit * (1 - 0.8 * u) * Math.min(1, (1 - u) * 6 + 0.05);
    }
    this.tube.update(this.points, this.radii);
    return g;
  }

  tipAt(i) {
    return this.world[Math.min(i, this.world.length - 1)];
  }
}

// ---------------------------------------------------------------------------
export class WoodRelease {
  static needs = ["pose"];
  static duration = 6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.bark = barkMaterial();
    this.branches = [];
    for (const side of ["l", "r"]) {
      const out = side === "l" ? 1 : -1;
      // Mains grow from the wrist and elbow, outward and up; twigs fork off.
      for (let i = 0; i < 4; i++) {
        const joint = i < 3 ? `${side}Wrist` : `${side}Elbow`;
        const dir = new THREE.Vector3(out * (0.6 + Math.random() * 0.6), 0.5 + Math.random() * 0.8, (Math.random() - 0.3) * 0.6);
        const path = growPath(dir, 2.2 + Math.random() * 1.0, { steps: 12 });
        const main = new Branch(this.bark, path, { radius: 0.17, start: 0.3 + i * 0.2 + (side === "r" ? 0.1 : 0), grow: 1.6 });
        main.joint = joint;
        this.branches.push(main);
        for (let k = 0; k < 2; k++) {
          const at = 4 + Math.floor(Math.random() * 6);
          const twig = growPath(new THREE.Vector3(out * Math.random(), 0.6 + Math.random(), (Math.random() - 0.5) * 0.6), 0.6 + Math.random() * 0.5, { steps: 6 });
          const base = path[at];
          const b = new Branch(this.bark, twig.map((p) => p.add(base)), { radius: 0.08, start: main.start + 0.7 + k * 0.2, grow: 0.9, segments: 16 });
          b.joint = joint;
          this.branches.push(b);
        }
      }
    }
    this.branches.forEach((b) => this.root.add(b.tube.mesh));
    stage.scene.add(this.root);
    this._creaks = 0;
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = WoodRelease.duration;
    const body = track.body.seen ? track.body : fallbackBody(st.width, st.height);
    const unit = st.toWorldSize(body.span) * 0.55;
    const out = 1 - span(t, D - 0.5, D);
    this.bark.uniforms.uAlpha.value = out;
    for (const b of this.branches) {
      const j = body.joints[b.joint];
      b.update(t, st.toWorld(j.x, j.y, 0.3), unit);
    }
    const starts = this.branches.filter((b) => b.radius > 0.1 && t > b.start).length;
    if (starts > this._creaks) {
      this._creaks = starts;
      sfx.tick();
    }
    const grow = smooth(span(t, 0.2, 2.2));
    st.tint.setRGB(lerp(1, 1.05, grow), lerp(1, 1.0, grow), lerp(1, 0.9, grow));
    st.darken = 0.15 * grow;
    st.vignette = 0.25 + 0.2 * grow;
    st.vignetteColor.setRGB(0.04, 0.03, 0.01);
    st.shake(0.003 * grow * (1 - span(t, 2.5, 3)));
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
// Falling leaves: instanced pointed ellipses, swaying and tumbling.
class Leaves {
  constructor(count = 160) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.5);
    shape.quadraticCurveTo(0.35, 0, 0, 0.5);
    shape.quadraticCurveTo(-0.35, 0, 0, -0.5);
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5f8f3a, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const shades = [0x4f7f2f, 0x6a9a40, 0x7fa84a, 0x3f6a28];
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, new THREE.Color(shades[i % shades.length]));
    this.items = Array.from({ length: count }, () => ({ born: -1 }));
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this.count = count;
  }

  update(t, dt, stage, rate, size) {
    let spawn = rate * dt;
    for (let i = 0; i < this.count; i++) {
      const L = this.items[i];
      if (L.born < 0 && spawn > Math.random()) {
        spawn -= 1;
        Object.assign(L, {
          born: t,
          x: (Math.random() - 0.5) * stage.visW,
          y: stage.visH * 0.55,
          z: Math.random() * 3,
          vy: -(0.8 + Math.random() * 0.8),
          spin: Math.random() * 6,
          sway: Math.random() * 6,
        });
      }
      if (L.born < 0) {
        this.mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0));
        continue;
      }
      L.y += L.vy * dt;
      const age = t - L.born;
      if (L.y < -stage.visH * 0.6) L.born = -1;
      const x = L.x + Math.sin(age * 2 + L.sway) * 0.4;
      this._q.setFromEuler(this._e.set(age * L.spin, age * 1.3, Math.sin(age * 3 + L.sway)));
      this._m.compose(_v.set(x, L.y, L.z), this._q, new THREE.Vector3(size, size, size));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class DeepForestEmergence {
  static needs = [];
  static duration = 6.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.bark = barkMaterial({ light: [0.5, 0.36, 0.22], dark: [0.14, 0.09, 0.05] });
    this.trunks = [];
    const xs = [-0.85, -0.55, -0.25, 0.05, 0.35, 0.62, 0.9];
    xs.forEach((x, i) => {
      const toward = i % 2 === 0;
      const dir = new THREE.Vector3(x * -0.25, 1, toward ? 0.55 : -0.1);
      const path = growPath(dir, 1.25 + Math.random() * 0.4, { steps: 12, curl: 0.25, rise: 0.05, depth: 0.15 });
      const trunk = new Branch(this.bark, path, { radius: 0.07 + Math.random() * 0.03, start: 0.2 + i * 0.25, grow: 1.4, segments: 36, radial: 12 });
      trunk.x = x;
      this.trunks.push(trunk);
      for (let k = 0; k < 3; k++) {
        const at = 5 + k * 2;
        const twig = growPath(new THREE.Vector3((Math.random() - 0.5) * 2, 0.6, Math.random() * 0.6), 0.4 + Math.random() * 0.3, { steps: 7 });
        const base = path[at];
        const b = new Branch(this.bark, twig.map((p) => p.add(base)), { radius: 0.03, start: trunk.start + 0.8 + k * 0.15, grow: 0.8, segments: 18 });
        b.x = x;
        this.trunks.push(b);
      }
    });
    this.trunks.forEach((b) => this.root.add(b.tube.mesh));
    this.leaves = new Leaves();
    this.root.add(this.leaves.mesh);
    this.dust = new Puffs({ max: 120, mode: "smoke", drag: 2, lift: 0.4 });
    this.root.add(this.dust.mesh);
    stage.scene.add(this.root);
    this._rumbled = 0;
  }

  update(t, dt) {
    const st = this.stage;
    const D = DeepForestEmergence.duration;
    const unit = st.visH;
    const out = 1 - span(t, D - 0.6, D);
    this.bark.uniforms.uAlpha.value = out;
    let rumbling = 0;
    for (const b of this.trunks) {
      const base = new THREE.Vector3(b.x * st.visW * 0.5, -st.visH * 0.62, 0);
      const g = b.update(t, base, unit, (x) => 1 - (1 - x) ** 3);
      if (g > 0 && g < 1 && b.radius > 0.05) rumbling++;
    }
    // A boom and a dust burst as each trunk breaks the ground.
    const started = this.trunks.filter((b) => b.radius > 0.05 && t > b.start).length;
    while (this._rumbled < started) {
      const b = this.trunks.filter((x) => x.radius > 0.05)[this._rumbled++];
      sfx.boom(0.45);
      for (let i = 0; i < 10; i++) {
        this.dust.spawn(b.x * st.visW * 0.5 + (Math.random() - 0.5), -st.visH * 0.5, 0.5, (Math.random() - 0.5) * 2, Math.random() * 1.5, 0, 0.5 + Math.random() * 0.4, 1.6, 3);
      }
    }
    this.dust.update(dt, t);
    this.leaves.update(t, dt, st, t > 1.6 ? 40 * out : 0, st.visH * 0.025);

    const grow = smooth(span(t, 0.2, 2.5));
    st.shake(0.006 * Math.min(1, rumbling));
    st.tint.setRGB(lerp(1, 0.95, grow), lerp(1, 1.04, grow), lerp(1, 0.88, grow));
    st.darken = 0.25 * grow * out;
    st.vignette = 0.3 + 0.3 * grow;
    st.vignetteColor.setRGB(0.02, 0.04, 0.01);
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------


export class WoodClone {
  static needs = ["segment"];
  static duration = 5.4;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.bark = barkMaterial();
    this.roots = Array.from({ length: 5 }, (_, i) => {
      const path = growPath(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1, 0.3), 0.3 + Math.random() * 0.15, { steps: 8, curl: 0.6, rise: 0.05 });
      const b = new Branch(this.bark, path, { radius: 0.011, start: 0.2 + i * 0.12, grow: 1.2, segments: 20 });
      b.dx = (i - 2) * 0.06;
      this.root.add(b.tube.mesh);
      return b;
    });
    stage.scene.add(this.root);
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = WoodClone.duration;
    const seg = track.segment;
    if (!this.clone && (seg.seen || t > 0.8) && t > 0.15) {
      this.clone = new Cutout(st, seg.seen ? seg : FULL_MASK, { grade: "wood" });
      this.root.add(this.clone.mesh);
      const cx = personCenterX(seg);
      this.dx = cx < 0.5 ? 0.3 : -0.3;
      this.cx = cx;
      sfx.tick();
    }
    const out = 1 - span(t, D - 0.6, D);
    const footX = ((this.cx ?? 0.5) + (this.dx ?? 0.3) - 0.5) * st.visW;
    for (const b of this.roots) b.update(t, new THREE.Vector3(footX + b.dx * st.visW, -st.visH * 0.52, 0.4), st.visH);
    this.bark.uniforms.uAlpha.value = out;
    if (this.clone) {
      const u = this.clone.uniforms;
      u.uOffset.value.set(this.dx, 0);
      u.uScale.value = 0.97;
      u.uReveal.value = smooth(span(t, 0.4, 2.0)) * 1.05;
      u.uAlpha.value = out;
    }
    const rise = smooth(span(t, 0.3, 2.0));
    st.shake(0.004 * rise * (1 - span(t, 2, 2.4)));
    st.vignette = 0.25 + 0.15 * rise;
    st.tint.setRGB(lerp(1, 1.04, rise), 1, lerp(1, 0.93, rise));
  }

  dispose() {
    this.clone?.dispose();
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
export class FourPillarHousePrison {
  static needs = [];
  static duration = 5.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.bark = barkMaterial({ light: [0.58, 0.42, 0.26], dark: [0.25, 0.16, 0.08] });
    this.bark.uniforms.uLen.value = 2;
    const Z = 2.5;
    // Visible half-extent at the pillars' depth (they stand close to the lens).
    const scale = (10 - Z) / 10;
    const hw = (stage.visW / 2) * scale;
    const hh = (stage.visH / 2) * scale;
    this.timbers = [];
    [-0.78, -0.3, 0.3, 0.78].forEach((x, i) => {
      const path = [new THREE.Vector3(x * hw, -hh * 1.3, Z), new THREE.Vector3(x * hw, hh * 1.3, Z)];
      this.timbers.push(new Branch(this.bark, path, { radius: hh * 0.07, start: 0.35 + i * 0.3, grow: 0.16, segments: 8, square: true }));
    });
    [0.62, -0.62].forEach((y, i) => {
      const path = [new THREE.Vector3(-hw * 1.3, y * hh, Z + 0.1), new THREE.Vector3(hw * 1.3, y * hh, Z + 0.1)];
      this.timbers.push(new Branch(this.bark, path, { radius: hh * 0.055, start: 1.8 + i * 0.3, grow: 0.2, segments: 8, square: true }));
    });
    this.timbers.forEach((b) => this.root.add(b.tube.mesh));
    this.dust = new Puffs({ max: 150, mode: "smoke", drag: 2.2, lift: 0.3 });
    this.root.add(this.dust.mesh);
    stage.scene.add(this.root);
    this._slams = 0;
    this.hh = hh;
  }

  update(t, dt) {
    const st = this.stage;
    const D = FourPillarHousePrison.duration;
    const sink = span(t, D - 0.8, D);
    const origin = new THREE.Vector3(0, -sink * this.hh * 2.6, 0);
    for (const b of this.timbers) b.update(t, origin, 1, (x) => x * x);
    // Each timber lands with a slam: shake, boom, dust.
    const landed = this.timbers.filter((b) => t > b.start + b.growTime).length;
    while (this._slams < landed) {
      const b = this.timbers[this._slams++];
      sfx.boom(0.6);
      st.shake(0.03);
      const p = b.path[0];
      for (let i = 0; i < 12; i++) {
        this.dust.spawn(p.x + (Math.random() - 0.5) * 0.4, -this.hh * 0.95, p.z - 0.2, (Math.random() - 0.5) * 2.5, Math.random() * 1.2, 0, 0.35 + Math.random() * 0.3, 1.0, 3);
      }
    }
    this.dust.update(dt, t);
    const caged = smooth(span(t, 0.3, 2.2)) * (1 - sink);
    st.darken = 0.3 * caged;
    st.vignette = 0.3 + 0.35 * caged;
    st.vignetteColor.setRGB(0.03, 0.02, 0.01);
    st.tint.setRGB(lerp(1, 1.05, caged), 1, lerp(1, 0.9, caged));
  }

  dispose() {
    disposeTree(this.root);
  }
}
