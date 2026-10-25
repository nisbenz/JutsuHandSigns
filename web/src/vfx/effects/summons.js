// Summoning family: Summoning: Toads (a giant toad rises out of smoke behind
// you), Summoning: Ninja Hounds (eight ninja dogs burst out of the ground),
// Snake Summoning (a giant snake rises behind you and strikes at the lens)
// and Edo Tensei (coffins rise and their lids fall open). Creatures that
// stand behind you are occluded by redrawing you from the live person mask.
import * as THREE from "three";
import { Sparks, disposeTree, easeOutBack, glowSprite, lerp, pxPerUnit, smooth, span } from "../kit";
import { Cutout, Puffs, resample, scaleMaterial } from "../elements";
import { DragonModel } from "../dragon";
import { sealMesh } from "./thunder-god";
import { sfx } from "../../sfx";

const WHITE_SMOKE = [[0.75, 0.75, 0.78], [0.97, 0.97, 1.0]];

function lights(root) {
  root.add(new THREE.HemisphereLight(0xfff2e0, 0x2a2420, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-3, 4, 5);
  root.add(key);
}

function bigPoof(puffs, at, s) {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = s * (1.5 + Math.random() * 3);
    puffs.spawn(at.x + Math.cos(a) * s * 0.5, at.y + Math.sin(a) * s * 0.5, at.z, Math.cos(a) * v, Math.sin(a) * v * 0.7 + s, 0, s * (0.6 + Math.random() * 0.5), 1.1 + Math.random() * 0.8, 2.2);
  }
}

// Redraw the player over things that stand behind them.
class Occluder {
  constructor(root) {
    this.root = root;
    this.cut = null;
  }
  update(stage, segment) {
    if (!this.cut && segment.seen) {
      this.cut = new Cutout(stage, segment, { live: true });
      this.cut.uniforms.uAlpha.value = 1;
      this.cut.uniforms.uMix.value = 0;
      this.root.add(this.cut.mesh);
    }
    this.cut?.update(segment);
  }
  dispose() {
    this.cut?.dispose();
  }
}

// ---------------------------------------------------------------------------
function buildToad() {
  const skin = new THREE.MeshStandardMaterial({ color: 0xc4532c, roughness: 0.7 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xe8b77a, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b1c14, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf2d24a, roughness: 0.3, emissive: 0x332200 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 30), skin);
  body.scale.set(1.6, 1.0, 1.2);
  g.add(body);
  const front = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), belly);
  front.scale.set(1.2, 0.75, 0.6);
  front.position.set(0, -0.2, 0.75);
  g.add(front);
  // Wide mouth line across the face.
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.04, 8, 48, Math.PI * 0.8), dark);
  mouth.rotation.set(Math.PI / 2 + 0.25, 0, Math.PI * 0.1);
  mouth.position.set(0, 0.05, 0.25);
  mouth.scale.set(1.25, 1, 1);
  g.add(mouth);
  // Warts.
  for (let i = 0; i < 26; i++) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.06 + Math.random() * 0.05, 8, 6), skin);
    const a = Math.random() * Math.PI * 2;
    const b = Math.random() * 0.9;
    w.position.set(Math.cos(a) * 1.55 * Math.cos(b), 0.3 + Math.sin(b) * 0.7, Math.sin(a) * 1.1 * Math.cos(b) - 0.2);
    g.add(w);
  }
  const lids = [];
  for (const s of [-1, 1]) {
    const bulge = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), skin);
    bulge.position.set(s * 0.8, 0.85, 0.45);
    g.add(bulge);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), eyeMat);
    eye.position.set(s * 0.82, 0.92, 0.66);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.05), dark);
    pupil.position.set(s * 0.82, 0.92, 0.95);
    g.add(pupil);
    // Eyelid: a skin dome that scales down over the eye to blink.
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), skin);
    lid.position.set(s * 0.82, 0.92, 0.66);
    lid.rotation.x = 0.3;
    g.add(lid);
    lids.push(lid);
    // Front legs and big webbed hands.
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 6, 12), skin);
    arm.position.set(s * 1.2, -0.65, 0.65);
    arm.rotation.z = s * 0.35;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), skin);
    hand.scale.set(1.3, 0.35, 1.1);
    hand.position.set(s * 1.38, -1.08, 0.95);
    g.add(hand);
  }
  return { group: g, lids };
}

export class SummonToad {
  static needs = ["segment"];
  static duration = 6.5;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    lights(this.root);
    const { group, lids } = buildToad();
    this.toad = group;
    this.lids = lids;
    this.toad.visible = false;
    this.root.add(this.toad);
    this.seal = sealMesh();
    this.root.add(this.seal);
    this.smoke = new Puffs({ max: 260, mode: "smoke", drag: 2.2, lift: 0.5, smoke: WHITE_SMOKE });
    this.smoke.mesh.renderOrder = 60;
    this.root.add(this.smoke.mesh);
    this.occ = new Occluder(this.root);
    stage.scene.add(this.root);
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = SummonToad.duration;
    this.occ.update(st, track.segment);
    const POP = 0.9;
    const H = st.visH;
    // Summoning formula spreads on the ground first.
    const seal = smooth(span(t, 0, 0.6)) * (1 - span(t, POP, POP + 0.4));
    this.seal.position.set(0, -H * 0.42, 0.5);
    this.seal.rotation.set(-1.2, 0, t);
    this.seal.scale.setScalar(H * 0.35 * Math.max(seal, 1e-3));
    this.seal.material.uniforms.uTime.value = t;
    this.seal.material.uniforms.uAlpha.value = seal;
    if (t >= POP && !this.popped) {
      this.popped = true;
      this.toad.visible = true;
      bigPoof(this.smoke, new THREE.Vector3(0, -H * 0.1, -1.5), H * 0.18);
      sfx.poof(1.6);
      sfx.boom(0.8);
      st.shake(0.03);
    }
    if (this.toad.visible) {
      const rise = easeOutBack(span(t, POP, POP + 0.7), 1.2);
      const sink = span(t, D - 0.8, D);
      this.toad.position.set(0, -H * 0.18 - (1 - rise) * H * 0.5 - sink * H * 0.7, -2.5);
      this.toad.scale.setScalar(H * 0.33);
      this.toad.rotation.y = Math.sin(t * 0.5) * 0.08;
      // Breathing and the occasional slow blink.
      this.toad.scale.y = H * 0.33 * (1 + 0.025 * Math.sin(t * 2.2));
      const blink = Math.max(0, Math.sin((t - 2.5) * 1.6)) ** 30;
      this.lids.forEach((l) => l.scale.set(1, 1, Math.max(0.05, blink)));
      this.lids.forEach((l) => (l.visible = blink > 0.05));
    }
    this.smoke.update(dt, t);
    st.vignette = 0.3;
    st.darken = 0.1;
  }

  dispose() {
    this.occ.dispose();
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
function buildDog(coat, head, band) {
  const fur = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.9 });
  const muzzle = new THREE.MeshStandardMaterial({ color: head, roughness: 0.9 });
  const cloth = new THREE.MeshStandardMaterial({ color: band, roughness: 0.6 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 6, 12), fur);
  body.rotation.z = Math.PI / 2 - 0.5;
  g.add(body);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), fur);
  skull.position.set(0.35, 0.38, 0.05);
  g.add(skull);
  const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 4, 8), muzzle);
  snout.rotation.z = Math.PI / 2;
  snout.position.set(0.53, 0.33, 0.08);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  nose.position.set(0.66, 0.35, 0.08);
  g.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), fur);
    ear.position.set(0.32, 0.56, 0.05 + s * 0.11);
    ear.rotation.x = s * 0.3;
    g.add(ear);
  }
  // Leaf-headband.
  const bandMesh = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 20), cloth);
  bandMesh.position.set(0.36, 0.45, 0.05);
  bandMesh.rotation.x = Math.PI / 2;
  g.add(bandMesh);
  for (const [x, z] of [[0.18, 0.12], [0.18, -0.12], [-0.25, 0.12], [-0.25, -0.12]]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.25, 4, 8), fur);
    leg.position.set(x, -0.3, z);
    g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), fur);
  tail.position.set(-0.45, 0.2, 0);
  tail.rotation.z = 1.1;
  g.add(tail);
  return { group: g, tail };
}

export class SummonHounds {
  static needs = [];
  static duration = 5.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    lights(this.root);
    const coats = [[0xb08a5a, 0xd9c09a], [0x6b6b70, 0xa9a9ad], [0x3a332e, 0x8a7d70], [0xcfc6b8, 0xefe8dc], [0x8a5a35, 0xc9a07a]];
    this.dogs = Array.from({ length: 8 }, (_, i) => {
      const [coat, head] = coats[i % coats.length];
      const d = buildDog(coat, head, 0x2d3a5a);
      const facing = i < 4 ? 1 : -1;
      d.group.scale.x = facing;
      this.root.add(d.group);
      return { ...d, x: -0.85 + (i / 7) * 1.7, at: 0.5 + Math.abs(i - 3.5) * 0.12, z: 1.2 + (i % 2) * 0.6, facing };
    });
    this.dust = new Puffs({ max: 200, mode: "smoke", drag: 2.5, lift: 0.3, smoke: [[0.35, 0.3, 0.26], [0.58, 0.52, 0.45]] });
    this.root.add(this.dust.mesh);
    this.seal = sealMesh();
    this.root.add(this.seal);
    stage.scene.add(this.root);
  }

  update(t, dt) {
    const st = this.stage;
    const D = SummonHounds.duration;
    const H = st.visH;
    const seal = smooth(span(t, 0, 0.4)) * (1 - span(t, 0.9, 1.4));
    this.seal.position.set(0, -H * 0.45, 1);
    this.seal.rotation.set(-1.25, 0, -t);
    this.seal.scale.setScalar(H * 0.45 * Math.max(seal, 1e-3));
    this.seal.material.uniforms.uTime.value = t;
    this.seal.material.uniforms.uAlpha.value = seal;
    for (const d of this.dogs) {
      const up = easeOutBack(span(t, d.at, d.at + 0.35), 2);
      const sink = span(t, D - 0.6, D);
      const scaleZ = (10 - d.z) / 10;
      d.group.position.set(d.x * st.visW * 0.5 * scaleZ, -H * 0.5 * scaleZ + (up * 0.18 - sink * 0.3) * H * scaleZ, d.z);
      d.group.scale.set(d.facing * H * 0.32, H * 0.32, H * 0.32);
      // Mostly facing the camera, angled toward the middle.
      d.group.rotation.y = -d.facing * 1.05;
      d.tail.rotation.z = 1.1 + Math.sin(t * 14 + d.x * 5) * 0.4;
      if (t >= d.at && !d.burst) {
        d.burst = true;
        sfx.boom(0.25);
        const x = d.group.position.x;
        for (let i = 0; i < 8; i++) {
          this.dust.spawn(x + (Math.random() - 0.5) * 0.6, d.group.position.y - H * 0.05, d.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, 0, H * 0.04, 0.6 + Math.random() * 0.4, 2.5);
        }
      }
    }
    this.dust.update(dt, t);
    st.shake(0.004 * (1 - span(t, 1.2, 1.6)));
    st.vignette = 0.25;
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
export class SnakeSummoning {
  static needs = ["segment"];
  static duration = 6.4;

  static prebake() {
    DragonModel.prebake("snake");
  }

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    lights(this.root);
    this.skin = scaleMaterial();
    this.skin.uniforms.uLen.value = 5;
    this.headSkin = new THREE.MeshStandardMaterial({ color: 0x8a76a3, roughness: 0.55, transparent: true });
    this.segments = 100;
    this.snake = new DragonModel(this.skin, { segments: this.segments, style: "snake", headMaterial: this.headSkin });
    this.root.add(this.snake.group);
    this.points = Array.from({ length: this.segments }, () => new THREE.Vector3());
    this.eyes = [0, 1].map(() => {
      const e = glowSprite(new THREE.Color(1.6, 1.3, 0.2));
      this.root.add(e);
      return e;
    });
    this.smoke = new Puffs({ max: 220, mode: "smoke", drag: 2.2, lift: 0.5, smoke: WHITE_SMOKE });
    this.smoke.mesh.renderOrder = 60;
    this.root.add(this.smoke.mesh);
    this.occ = new Occluder(this.root);
    stage.scene.add(this.root);
  }

  update(t, dt, track) {
    const st = this.stage;
    const D = SnakeSummoning.duration;
    this.occ.update(st, track.segment);
    const H = st.visH;
    if (t > 0.4 && !this.popped) {
      this.popped = true;
      bigPoof(this.smoke, new THREE.Vector3(0, -H * 0.3, -2), H * 0.16);
      sfx.poof(1.4);
    }
    // Rises in an S behind you, sways, then strikes at the lens.
    const STRIKE = 4.6;
    const rise = smooth(span(t, 0.4, 2.2));
    const strike = smooth(span(t, STRIKE, STRIKE + 0.5));
    const raw = [];
    for (let i = 0; i < 40; i++) {
      const u = i / 39;
      const y = -H * 0.75 + u * H * 0.95 * rise;
      const x = Math.sin(u * 5 + t * 1.6) * H * 0.18 * (1 - u * 0.4);
      const z = -2.5 + Math.cos(u * 4 + t) * 0.6;
      raw.push(new THREE.Vector3(x, y, z));
    }
    // The head end bends toward the camera for the strike.
    for (let i = 30; i < 40; i++) {
      const k = (i - 30) / 9;
      raw[i].lerp(new THREE.Vector3(0, -H * 0.02, 5.2 - (1 - k) * 2.5), strike * k);
    }
    resample(raw, this.segments, this.points);
    const thick = H * 0.095;
    const jaw = Math.max(0.15 + 0.1 * Math.sin(t * 2), strike);
    const { headPos, headFrame: f } = this.snake.update(this.points, thick, t, jaw);
    this.snake.group.visible = t > 0.4;
    const hs = thick * 3.2;
    this.eyes.forEach((e, k) => {
      // Sculpted eye sockets sit at (0.36, 0.08, ±0.2) in head units.
      e.position.copy(headPos).addScaledVector(f.t, hs * 0.36).addScaledVector(f.up, hs * 0.08).addScaledVector(f.side, (k ? 1 : -1) * hs * 0.2);
      e.scale.setScalar(thick * 0.6);
      e.material.opacity = this.snake.group.visible ? 1 : 0;
    });
    if (t > STRIKE + 0.45 && !this.hit) {
      this.hit = true;
      sfx.taiko();
      st.shake(0.04);
    }
    const out = 1 - span(t, D - 0.5, D);
    this.skin.uniforms.uAlpha.value = out;
    this.headSkin.opacity = out;
    this.smoke.update(dt, t);
    const menace = smooth(span(t, 1, 3));
    st.darken = 0.25 * menace;
    st.tint.setRGB(lerp(1, 0.95, menace), lerp(1, 0.9, menace), lerp(1, 1.05, menace));
    st.vignette = 0.3 + 0.3 * menace;
    st.vignetteColor.setRGB(0.04, 0, 0.06);
  }

  dispose() {
    this.occ.dispose();
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
let coffinTag = null;
function getCoffinTag() {
  if (coffinTag) return coffinTag;
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#e6dcc2";
  g.fillRect(0, 0, 96, 256);
  g.fillStyle = "#8a1a14";
  g.font = "bold 46px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  ["穢", "土", "転", "生"].forEach((ch, i) => g.fillText(ch, 48, 40 + i * 58));
  coffinTag = new THREE.CanvasTexture(c);
  coffinTag.colorSpace = THREE.SRGBColorSpace;
  return coffinTag;
}

function buildCoffin() {
  const wood = new THREE.MeshStandardMaterial({ color: 0x2b1e16, roughness: 0.8 });
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.7, 0.4), wood);
  g.add(box);
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.58), new THREE.MeshBasicMaterial({ color: 0x050308 }));
  inside.position.z = 0.201;
  g.add(inside);
  // Lid hinged at its bottom edge so it can fall forward.
  const hinge = new THREE.Group();
  hinge.position.set(0, -0.85, 0.22);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.75, 0.06), wood);
  lid.position.y = 0.85;
  hinge.add(lid);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.45), new THREE.MeshBasicMaterial({ map: getCoffinTag() }));
  tag.position.set(0, 1.05, 0.035);
  hinge.add(tag);
  g.add(hinge);
  return { group: g, hinge };
}

export class EdoTensei {
  static needs = [];
  static duration = 6.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    lights(this.root);
    this.coffins = [-0.62, 0.62].map((x, i) => {
      const c = buildCoffin();
      this.root.add(c.group);
      const glow = glowSprite(new THREE.Color(0.7, 0.35, 1.0));
      this.root.add(glow);
      return { ...c, x, at: 0.4 + i * 0.35, open: 2.8 + i * 0.3, glow };
    });
    this.dust = new Puffs({ max: 180, mode: "smoke", drag: 2.5, lift: 0.3, smoke: [[0.3, 0.27, 0.24], [0.5, 0.46, 0.4]] });
    this.root.add(this.dust.mesh);
    this.ash = new Sparks({ max: 400, color: new THREE.Color(0.55, 0.45, 0.7), size: 0.05, gravity: 0.6, drag: 1 });
    this.root.add(this.ash.points);
    stage.scene.add(this.root);
  }

  update(t, dt) {
    const st = this.stage;
    const D = EdoTensei.duration;
    const Z = 1.2;
    const k = (10 - Z) / 10;
    const H = st.visH * k;
    for (const c of this.coffins) {
      const rise = smooth(span(t, c.at, c.at + 1.1));
      const sink = span(t, D - 0.7, D);
      c.group.position.set(c.x * st.visW * 0.5 * k, -H * 0.85 + rise * H * 0.5 - sink * H * 0.8, Z);
      c.group.scale.setScalar(H * 0.32);
      c.group.rotation.y = -c.x * 0.4;
      if (t > c.at && t < c.at + 1.1 && Math.random() < 0.5) {
        this.dust.spawn(c.group.position.x + (Math.random() - 0.5) * 0.8, -H * 0.48, Z, (Math.random() - 0.5) * 1.5, Math.random(), 0, H * 0.05, 0.8, 2.5);
      }
      if (t > c.at && !c.rumbled) {
        c.rumbled = true;
        sfx.boom(0.5);
      }
      // Lid falls forward; dead chakra seeps out.
      const open = span(t, c.open, c.open + 0.5);
      c.hinge.rotation.x = open * open * 1.45;
      if (open >= 1 && !c.slammed) {
        c.slammed = true;
        sfx.tick();
        st.shake(0.015);
      }
      // In front of the open coffin (the box itself would hide it).
      c.glow.position.copy(c.group.position).add(new THREE.Vector3(0, 0, H * 0.2));
      c.glow.scale.set(H * 0.3, H * 0.6, 1);
      c.glow.material.opacity = open * (1 - sink);
      if (open > 0.5 && Math.random() < 0.6) {
        const p = c.group.position;
        this.ash.spawn(p.x + (Math.random() - 0.5) * H * 0.2, p.y + (Math.random() - 0.5) * H * 0.6, Z + 0.2, (Math.random() - 0.5) * 0.3, 0.2, 0, 1 + Math.random());
      }
    }
    this.dust.update(dt, t);
    this.ash.setPixelScale(pxPerUnit(st));
    this.ash.material.uniforms.uSize.value = H * 0.012;
    this.ash.update(dt);
    const dread = smooth(span(t, 0.3, 2.5));
    st.desaturate = 0.5 * dread;
    st.darken = 0.3 * dread;
    st.tint.setRGB(lerp(1, 0.92, dread), lerp(1, 0.97, dread), lerp(1, 0.9, dread));
    st.vignette = 0.3 + 0.4 * dread;
    st.vignetteColor.setRGB(0.03, 0.02, 0.04);
  }

  dispose() {
    disposeTree(this.root);
  }
}
