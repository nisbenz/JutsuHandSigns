// Clone family: Shadow Clone (live copies of you pop out of smoke and move
// with you), Substitution (a smoke burst, a log drops where you stood, you
// reappear beside it), Paper Clone (sheets of paper swirl together into a
// paper you, then scatter) and Beast Human Clone (a feral you + claw slashes).
import * as THREE from "three";
import { LightningRibbons, disposeTree, easeOutBack, smooth, span } from "../kit";
import { Cutout, FULL_MASK, Puffs, barkMaterial, personCenterX } from "../elements";
import { sfx } from "../../sfx";

const WHITE_SMOKE = [[0.78, 0.78, 0.8], [0.98, 0.98, 1.0]];

// White smoke burst at a screen-fraction position (x 0..1, y 0..1 bottom-up).
function poof(puffs, stage, sx, sy, size = 1) {
  const x = (sx - 0.5) * stage.visW;
  const y = (sy - 0.5) * stage.visH;
  const s = stage.visH * 0.07 * size;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = s * (2 + Math.random() * 3);
    puffs.spawn(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.8, 0.6, Math.cos(a) * v, Math.sin(a) * v * 0.8, 0, s * (0.9 + Math.random() * 0.6), 0.7 + Math.random() * 0.5, 2);
  }
  sfx.poof(size);
}

// Lazily build a cut-out once a mask (or the fallback) is available.
function makeClone(stage, root, segment, opts) {
  const c = new Cutout(stage, segment.seen ? segment : FULL_MASK, opts);
  root.add(c.mesh);
  return c;
}

class CloneBase {
  static needs = ["segment"];

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.smoke = new Puffs({ max: 260, mode: "smoke", drag: 3, lift: 0.3, smoke: WHITE_SMOKE });
    this.smoke.mesh.renderOrder = 60;
    this.root.add(this.smoke.mesh);
    stage.scene.add(this.root);
    this.clones = [];
  }

  // Ready once segmentation has produced a mask (or we stop waiting).
  _ready(t, track) {
    if (this.cx == null && (track.segment.seen || t > 0.6)) this.cx = personCenterX(track.segment);
    return this.cx != null;
  }

  _updateClones(track) {
    for (const c of this.clones) c.update(track.segment);
  }

  dispose() {
    this.clones.forEach((c) => c.dispose());
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
export class ShadowClone extends CloneBase {
  static duration = 6;

  update(t, dt, track) {
    const st = this.stage;
    const D = ShadowClone.duration;
    if (!this._ready(t, track)) return;
    // Two near clones, then two further back (smaller); all live.
    const slots = [
      { at: 0.5, dx: 0.28, scale: 0.97 },
      { at: 0.65, dx: -0.28, scale: 0.97 },
      { at: 1.3, dx: 0.52, scale: 0.86 },
      { at: 1.45, dx: -0.52, scale: 0.86 },
    ];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (t >= slot.at && !this.clones[i]) {
        const c = makeClone(st, this.root, track.segment, { live: true });
        c.mesh.renderOrder = 30 - i;
        c.uniforms.uMix.value = 0;
        this.clones[i] = c;
        poof(this.smoke, st, this.cx + slot.dx, 0.42, slot.scale);
      }
      const c = this.clones[i];
      if (!c) continue;
      const u = c.uniforms;
      u.uOffset.value.set(slot.dx, 0);
      u.uPivot.value.set(this.cx, 0);
      u.uScale.value = slot.scale;
      u.uAlpha.value = t < D - 0.8 ? 1 : 0;
    }
    if (t >= D - 0.8 && !this.gone) {
      this.gone = true;
      slots.forEach((s) => poof(this.smoke, st, this.cx + s.dx, 0.42, s.scale * 0.8));
    }
    this._updateClones(track);
    this.smoke.update(dt, t);
    st.vignette = 0.25;
  }
}

// ---------------------------------------------------------------------------
export class Substitution extends CloneBase {
  static duration = 4.8;

  constructor(stage) {
    super(stage);
    this.root.add(new THREE.HemisphereLight(0xfff4e0, 0x302820, 1.2));
    this.log = new THREE.Group();
    const bark = barkMaterial();
    bark.uniforms.uLen.value = 1.5;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.3, 20, 1, true), bark);
    this.log.add(body);
    const ring = new THREE.MeshStandardMaterial({ color: 0xc9a571, roughness: 0.9 });
    for (const y of [-0.65, 0.65]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.23, 20), ring);
      cap.position.y = y;
      cap.rotation.x = y > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.log.add(cap);
    }
    this.log.visible = false;
    this.root.add(this.log);
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = Substitution.duration;
    if (!this._ready(t, track)) return;
    const SWAP = 0.7;
    if (t >= SWAP && !this.swapped) {
      this.swapped = true;
      // Dense, lingering cloud where you stood...
      poof(this.smoke, st, this.cx, 0.45, 2.2);
      poof(this.smoke, st, this.cx, 0.3, 1.8);
      // ...and you're suddenly over there.
      this.dx = this.cx < 0.5 ? 0.32 : -0.32;
      const c = makeClone(st, this.root, track.segment, { live: true });
      c.uniforms.uMix.value = 0;
      this.clones.push(c);
      poof(this.smoke, st, this.cx + this.dx, 0.45, 0.8);
      this.log.visible = true;
    }
    if (this.swapped) {
      const u = this.clones[0].uniforms;
      u.uOffset.value.set(this.dx, 0);
      u.uAlpha.value = 1 - span(t, D - 0.4, D);
      // The log tumbles down through the smoke and thuds.
      const fall = span(t, SWAP + 0.1, SWAP + 0.6);
      const unit = st.visH;
      this.log.position.set((this.cx - 0.5) * st.visW, (0.25 - fall * 0.45) * unit * 0.6, 0.8);
      this.log.rotation.set(0.3, 0.5, 1.2 + fall * 0.5);
      this.log.scale.setScalar(unit * 0.28 * easeOutBack(span(t, SWAP, SWAP + 0.15)));
      if (fall >= 1 && !this.thud) {
        this.thud = true;
        sfx.tick();
        st.shake(0.012);
      }
      // Keep the cloud thick where you were.
      if (t < D - 1 && Math.random() < 0.4) {
        const x = (this.cx - 0.5) * st.visW;
        this.smoke.spawn(x + (Math.random() - 0.5) * 1.5, (Math.random() - 0.3) * st.visH * 0.3, 0.7, 0, 0.3, 0, st.visH * 0.1, 1.2, 1.5);
      }
    }
    this._updateClones(track);
    this.smoke.update(dt, t);
  }
}

// ---------------------------------------------------------------------------
export class PaperClone extends CloneBase {
  static duration = 5.6;

  constructor(stage) {
    super(stage);
    this.root.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.4));
    const N = 160;
    this.sheets = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.12, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8, side: THREE.DoubleSide }),
      N
    );
    this.sheets.frustumCulled = false;
    this.sheets.renderOrder = 50;
    this.root.add(this.sheets);
    this.items = Array.from({ length: N }, () => ({
      from: new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.6, Math.random() * 3),
      to: new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.6) * 0.8, 0.5),
      spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      delay: Math.random() * 0.6,
    }));
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = PaperClone.duration;
    if (!this._ready(t, track)) return;
    this.dx ??= this.cx < 0.5 ? 0.3 : -0.3;
    if (!this.clones.length) {
      const c = makeClone(st, this.root, track.segment, { live: true, grade: "paper" });
      this.clones.push(c);
    }
    const SCATTER = 3.8;
    const u = this.clones[0].uniforms;
    u.uOffset.value.set(this.dx, 0);
    u.uReveal.value = smooth(span(t, 0.7, 1.7)) * 1.05;
    u.uAlpha.value = 1 - span(t, SCATTER, SCATTER + 0.6);
    // Sheets swirl in to build the clone, then blow away from it.
    const cxw = (this.cx + this.dx - 0.5) * st.visW;
    const size = st.visH;
    this.items.forEach((it, i) => {
      const gather = smooth(span(t, it.delay, it.delay + 1.2));
      const scatter = smooth(span(t, SCATTER + it.delay * 0.5, SCATTER + it.delay * 0.5 + 1.2));
      const p = new THREE.Vector3().lerpVectors(it.from, it.to, gather).lerp(it.from.clone().multiplyScalar(1.4), scatter);
      p.x = p.x * st.visW * 0.5 + cxw * (gather * (1 - scatter) + scatter * 0.5);
      p.y = p.y * size * 0.5;
      const visible = (gather < 1 || scatter > 0) && t < D - 0.2;
      this._e.set(it.spin.x * t, it.spin.y * t, it.spin.z * t);
      this._q.setFromEuler(this._e);
      const s = visible ? size * 0.35 : 0;
      this._m.compose(p, this._q, new THREE.Vector3(s, s, s));
      this.sheets.setMatrixAt(i, this._m);
    });
    this.sheets.instanceMatrix.needsUpdate = true;
    if (t > SCATTER && !this.rustled) {
      this.rustled = true;
      sfx.poof(0.6);
    }
    this._updateClones(track);
    this.smoke.update(dt, t);
    st.vignette = 0.25;
  }
}

// ---------------------------------------------------------------------------
export class BeastHumanClone extends CloneBase {
  static duration = 5;

  constructor(stage) {
    super(stage);
    this.claws = new LightningRibbons({ maxPoints: 400, color: new THREE.Color(0.7, 0.08, 0.05), coreColor: new THREE.Color(1.0, 0.75, 0.7) });
    this.claws.mesh.renderOrder = 70;
    this.root.add(this.claws.mesh);
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = BeastHumanClone.duration;
    if (!this._ready(t, track)) return;
    this.dx ??= this.cx < 0.5 ? 0.3 : -0.3;
    if (t >= 0.5 && !this.clones.length) {
      const c = makeClone(st, this.root, track.segment, { live: true, grade: "feral" });
      this.clones.push(c);
      poof(this.smoke, st, this.cx + this.dx, 0.42, 1.1);
    }
    if (this.clones.length) {
      const u = this.clones[0].uniforms;
      u.uOffset.value.set(this.dx, 0);
      u.uAlpha.value = 1 - span(t, D - 0.5, D);
    }
    // Three claw rips across the screen.
    const SLASH = 2.2;
    const f = span(t, SLASH, SLASH + 0.12);
    const fade = 1 - span(t, SLASH + 0.15, SLASH + 0.9);
    this.claws.begin();
    if (f > 0 && fade > 0) {
      const w = st.visW;
      const h = st.visH;
      for (let k = 0; k < 3; k++) {
        const a = new THREE.Vector3(-0.45 * w + k * 0.06 * w, 0.35 * h - k * 0.08 * h, 2);
        const b = new THREE.Vector3(0.35 * w + k * 0.06 * w, -0.3 * h - k * 0.08 * h, 2);
        const pts = [];
        for (let i = 0; i <= 16; i++) {
          const u = (i / 16) * f;
          const p = a.clone().lerp(b, u);
          p.y += Math.sin(u * Math.PI) * h * 0.05;
          pts.push(p);
        }
        this.claws.addBolt(pts, h * 0.006, 0.8);
      }
    }
    this.claws.end();
    this.claws.material.uniforms.uIntensity.value = fade;
    if (t > SLASH && !this.slashed) {
      this.slashed = true;
      sfx.slash();
      st.shake(0.02);
    }
    const hit = t > SLASH ? Math.exp(-(t - SLASH) * 6) : 0;
    st.flash.setRGB(0.2 * hit, 0.02 * hit, 0.01 * hit);
    st.aberration = 0.02 + 0.2 * hit;
    this._updateClones(track);
    this.smoke.update(dt, t);
    st.vignette = 0.3;
    st.vignetteColor.setRGB(0.08, 0.01, 0);
  }
}
