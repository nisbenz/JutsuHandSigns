// Explosion family (Deidara, Yahiko): Exploding Clay (clay birds fly out and
// detonate), C4 Karura (a haze of microscopic bombs that pop in a cascade),
// Clay Clone (a clay copy of you rises and explodes) and Explosive Tag
// Barrage (paper tags flutter out, stick, sizzle, chain-detonate).
import * as THREE from "three";
import { Sparks, disposeTree, easeOutBack, pxPerUnit, smooth, span } from "../kit";
import { Cutout, FULL_MASK, Puffs, explode, personCenterX } from "../elements";
import { sfx } from "../../sfx";

const BLAST = new THREE.Color(1.0, 0.6, 0.25);

// Shared fire + smoke + sparks rig and a "last blast" light that decays.
class BlastRig {
  constructor(root) {
    this.fire = new Puffs({ max: 420, mode: "fire", drag: 2.6, lift: 0.8 });
    this.smoke = new Puffs({ max: 240, mode: "smoke", drag: 1.6, lift: 0.5 });
    this.sparks = new Sparks({ max: 600, color: new THREE.Color(1.6, 1.0, 0.45), size: 0.05, gravity: -4, drag: 1.2 });
    root.add(this.smoke.mesh, this.fire.mesh, this.sparks.points);
    this.light = 0;
    this.lightAt = { x: 0, y: 0 };
  }

  blast(stage, at, s, loud = 1) {
    explode(this, at, s);
    this.light = 1;
    this.lightAt = {
      x: (at.x / stage.visW + 0.5) * stage.width,
      y: (0.5 - at.y / stage.visH) * stage.height,
    };
    stage.shake(0.025 * loud);
    sfx.boom(loud);
  }

  update(stage, dt, t, s) {
    this.fire.update(dt, t);
    this.smoke.update(dt, t);
    this.sparks.setPixelScale(pxPerUnit(stage));
    this.sparks.material.uniforms.uSize.value = s * 0.12;
    this.sparks.update(dt);
    this.light *= Math.exp(-dt * 5);
    if (this.light > 0.02) {
      stage.setLight(1, this.lightAt.x, this.lightAt.y, stage.height * 0.5, BLAST, 1.4 * this.light);
      stage.flash.setRGB(0.25 * this.light, 0.14 * this.light, 0.05 * this.light);
    }
  }
}

function lights(root) {
  root.add(new THREE.HemisphereLight(0xfff4e0, 0x302820, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-2, 3, 5);
  root.add(key);
}

// ---------------------------------------------------------------------------
function wingGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.25, 0.9);
  shape.lineTo(-0.55, 0.75);
  shape.lineTo(-0.45, 0);
  return new THREE.ShapeGeometry(shape);
}

// Low-poly clay bird modeled facing +X.
function clayBird(material) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), material);
  body.scale.set(1.4, 0.75, 0.75);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), material);
  head.position.set(0.42, 0.12, 0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 8), material);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.62, 0.1, 0);
  g.add(beak);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 4), material);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.5, 0.05, 0);
  tail.scale.z = 0.3;
  g.add(tail);
  const wingGeo = wingGeometry();
  const wings = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.05, 0.08, side * 0.12);
    const wing = new THREE.Mesh(wingGeo, material);
    wing.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    pivot.add(wing);
    g.add(pivot);
    return { pivot, side };
  });
  return { group: g, wings };
}

export class ExplodingClay {
  static needs = ["hand"];
  static duration = 5.4;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    lights(this.root);
    this.clay = new THREE.MeshStandardMaterial({ color: 0xf1ebdc, roughness: 0.9, side: THREE.DoubleSide });
    this.birds = Array.from({ length: 6 }, (_, i) => {
      const b = clayBird(this.clay);
      this.root.add(b.group);
      return {
        ...b,
        launch: 0.3 + i * 0.18,
        boom: 2.9 + i * 0.16,
        target: new THREE.Vector3((Math.random() - 0.5) * 0.85, (Math.random() - 0.3) * 0.7, 0.5 + Math.random() * 2.5),
        arc: 0.4 + Math.random() * 0.6,
      };
    });
    this.rig = new BlastRig(this.root);
    stage.scene.add(this.root);
    this._palm = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    st.toWorld(h.seen ? h.x : st.width * 0.5, h.seen ? h.y : st.height * 0.62, 0.3, this._palm);
    const r = st.toWorldSize(h.seen ? h.size : st.height * 0.15);

    for (const bird of this.birds) {
      const g = bird.group;
      if (t >= bird.boom) {
        if (g.visible) {
          g.visible = false;
          this.rig.blast(st, g.position, r * 1.3, 0.7);
        }
        continue;
      }
      const f = smooth(span(t, bird.launch, bird.launch + 1.3));
      const target = new THREE.Vector3(bird.target.x * st.visW, bird.target.y * st.visH, bird.target.z);
      const prev = g.position.clone();
      g.position.lerpVectors(this._palm, target, f);
      g.position.y += Math.sin(f * Math.PI) * r * 3 * bird.arc;
      // After arriving, hover with a lazy bob.
      if (f >= 1) g.position.y += Math.sin(t * 4 + bird.arc * 10) * r * 0.15;
      const vel = g.position.clone().sub(prev);
      if (vel.lengthSq() > 1e-8) g.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vel.normalize()), 0.25);
      g.scale.setScalar(Math.max(1e-4, r * 1.3 * easeOutBack(span(t, bird.launch - 0.25, bird.launch + 0.1))));
      const flap = Math.sin(t * 16 + bird.arc * 7) * 0.9;
      for (const w of bird.wings) w.pivot.rotation.x = w.side * flap;
    }
    this.rig.update(st, dt, t, r);

    const tension = smooth(span(t, 2.2, 2.9));
    st.darken = 0.15 + 0.15 * tension;
    st.vignette = 0.25 + 0.25 * tension;
    st.vignetteColor.setRGB(0.05, 0.02, 0);
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
// C4 Karura: GPU points. Each mote pours out of a central clay mass, drifts,
// then pops (bright flash) at its own time in a cascade.
const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aHome;
uniform float uTime, uPx; // uPx: device pixel ratio
varying float vA;
varying float vFlash;
void main() {
  float spread = smoothstep(0.9, 2.0, uTime - aSeed.x * 0.4);
  vec3 p = mix(vec3(0.0, 0.6, 0.0), aHome, spread);
  p += vec3(sin(uTime * 0.5 + aSeed.y * 6.3), cos(uTime * 0.4 + aSeed.z * 6.3), 0.0) * 0.25 * spread;
  float popAt = 2.7 + aSeed.w * 2.4;
  float since = uTime - popAt;
  float flash = since > 0.0 ? exp(-since * 10.0) : 0.0;
  vFlash = flash;
  vA = since > 0.45 ? 0.0 : (since > 0.0 ? flash : 0.75 * smoothstep(0.7, 1.2, uTime));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (2.5 + flash * 18.0) * uPx * (10.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const MOTE_FRAG = /* glsl */ `
varying float vA;
varying float vFlash;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.0, 0.5, d)) * vA;
  if (a < 0.01) discard;
  vec3 c = mix(vec3(0.95, 0.93, 0.88), vec3(2.0, 1.4, 0.7), vFlash);
  gl_FragColor = vec4(c * a, 1.0);
}`;

export class C4Karura {
  static needs = [];
  static duration = 6.6;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    lights(this.root);
    const N = 4500;
    const seeds = new Float32Array(N * 4).map(() => Math.random());
    const homes = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      homes[i * 3] = (Math.random() - 0.5) * stage.visW * 1.15;
      homes[i * 3 + 1] = (Math.random() - 0.5) * stage.visH * 1.15;
      homes[i * 3 + 2] = -2 + Math.random() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute("aHome", new THREE.BufferAttribute(homes, 3));
    this.motes = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 100 } },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, this.motes);
    points.frustumCulled = false;
    this.root.add(points);
    // The clay mass that splits into the cloud.
    this.mass = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), new THREE.MeshStandardMaterial({ color: 0xf1ebdc, roughness: 0.9, flatShading: true }));
    this.mass.position.set(0, 0.6, 0);
    this.root.add(this.mass);
    stage.scene.add(this.root);
    this._nextPop = 2.7;
  }

  update(t, dt) {
    const st = this.stage;
    const D = C4Karura.duration;
    this.motes.uniforms.uTime.value = t;
    this.motes.uniforms.uPx.value = st.renderer.getPixelRatio();
    const grow = easeOutBack(span(t, 0, 0.7));
    const split = span(t, 0.9, 1.2);
    this.mass.scale.setScalar(Math.max(1e-4, st.visH * 0.12 * grow * (1 - split)));
    this.mass.rotation.y += dt * 0.8;
    this.mass.visible = split < 1;

    // The cascade: crackle of small pops, then the final whiteout.
    if (t > this._nextPop && t < 5.1) {
      this._nextPop = t + 0.18 + Math.random() * 0.15;
      sfx.boom(0.25);
    }
    const cascade = smooth(span(t, 2.7, 5.1));
    const white = span(t, 5.0, 5.3) * (1 - span(t, 5.4, D));
    if (t > 5.0 && !this.whited) {
      this.whited = true;
      sfx.boom(1.2);
    }
    const haze = smooth(span(t, 1.0, 2.0));
    st.flash.setRGB(0.04 * haze + 0.9 * white, 0.04 * haze + 0.85 * white, 0.035 * haze + 0.75 * white);
    st.desaturate = 0.25 * haze + 0.4 * cascade;
    st.shake(0.004 * cascade + 0.03 * white);
    st.bloom.strength = 0.8 + 0.6 * cascade;
    st.vignette = 0.2 + 0.3 * cascade;
    st.aberration = 0.02 + 0.08 * cascade;
  }

  dispose() {
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------


export class ClayClone {
  static needs = ["segment"];
  static duration = 5.2;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.rig = new BlastRig(this.root);
    this.dust = new Sparks({ max: 200, color: new THREE.Color(0.9, 0.86, 0.78), size: 0.05, gravity: -3, drag: 1 });
    this.root.add(this.dust.points);
    stage.scene.add(this.root);
  }

  update(t, dt, track) {
    const st = this.stage;
    const seg = track.segment;
    if (!this.clone && (seg.seen || t > 0.8) && t > 0.2) {
      this.clone = new Cutout(st, seg.seen ? seg : FULL_MASK, { grade: "clay" });
      this.root.add(this.clone.mesh);
      const cx = personCenterX(seg);
      this.dx = cx < 0.5 ? 0.3 : -0.3;
      this.cx = cx;
    }
    const KATSU = 3.3;
    const s = st.toWorldSize(st.height * 0.12);
    if (this.clone) {
      const u = this.clone.uniforms;
      const rise = smooth(span(t, 0.3, 1.6));
      u.uOffset.value.set(this.dx, 0);
      u.uScale.value = 0.96 + 0.01 * Math.sin(t * 3);
      u.uReveal.value = rise * 1.05;
      u.uAlpha.value = t < KATSU ? 1 : 0;
      if (t < 1.6) {
        const x = ((this.cx + this.dx) - 0.5) * st.visW;
        const y = (rise * 0.9 - 0.5) * st.visH;
        for (let i = 0; i < 3; i++) this.dust.spawn(x + (Math.random() - 0.5) * s * 3, y, 0.2, (Math.random() - 0.5) * s * 2, Math.random() * s * 3, 0, 0.5);
      }
      if (t >= KATSU && !this.boomed) {
        this.boomed = true;
        const at = new THREE.Vector3(((this.cx + this.dx) - 0.5) * st.visW, -0.05 * st.visH, 0.5);
        this.rig.blast(st, at, s * 2.2, 1.2);
        this.rig.blast(st, at.clone().add(new THREE.Vector3(0, 0.3 * st.visH, 0)), s * 1.6, 0.6);
      }
    }
    this.dust.setPixelScale(pxPerUnit(st));
    this.dust.material.uniforms.uSize.value = s * 0.2;
    this.dust.update(dt);
    this.rig.update(st, dt, t, s);
    st.vignette = 0.25;
  }

  dispose() {
    this.clone?.dispose();
    disposeTree(this.root);
  }
}

// ---------------------------------------------------------------------------
let tagTexture = null;
function getTagTexture() {
  if (tagTexture) return tagTexture;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 384;
  const g = c.getContext("2d");
  g.fillStyle = "#efe3c4";
  g.fillRect(0, 0, 128, 384);
  g.strokeStyle = "#a3221b";
  g.lineWidth = 6;
  g.strokeRect(10, 10, 108, 364);
  g.lineWidth = 2;
  g.strokeRect(20, 20, 88, 344);
  g.fillStyle = "#a3221b";
  g.font = "bold 84px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("爆", 64, 150);
  g.font = "bold 34px serif";
  g.fillText("封", 64, 250);
  g.fillText("印", 64, 300);
  tagTexture = new THREE.CanvasTexture(c);
  tagTexture.colorSpace = THREE.SRGBColorSpace;
  return tagTexture;
}

export class ExplosiveTagBarrage {
  static needs = ["hand"];
  static duration = 5.2;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    const geo = new THREE.PlaneGeometry(0.33, 1);
    this.tags = Array.from({ length: 14 }, (_, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: getTagTexture(), side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      this.root.add(mesh);
      return {
        mesh,
        mat,
        launch: 0.15 + i * 0.07,
        boom: 2.7 + Math.random() * 1.2,
        target: new THREE.Vector3((Math.random() - 0.5) * 0.85, (Math.random() - 0.5) * 0.7, Math.random() * 2),
        tilt: (Math.random() - 0.5) * 0.6,
        spin: Math.random() * 10,
      };
    });
    this.fuse = new Sparks({ max: 500, color: new THREE.Color(1.6, 0.8, 0.25), size: 0.04, gravity: -2, drag: 1 });
    this.root.add(this.fuse.points);
    this.rig = new BlastRig(this.root);
    stage.scene.add(this.root);
    this._palm = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    st.toWorld(h.seen ? h.x : st.width * 0.5, h.seen ? h.y : st.height * 0.62, 0.3, this._palm);
    const r = st.toWorldSize(h.seen ? h.size : st.height * 0.15);
    for (const tag of this.tags) {
      const m = tag.mesh;
      if (t >= tag.boom) {
        if (m.visible) {
          m.visible = false;
          this.rig.blast(st, m.position, r * 1.2, 0.55);
        }
        continue;
      }
      const f = smooth(span(t, tag.launch, tag.launch + 0.7));
      const target = new THREE.Vector3(tag.target.x * st.visW, tag.target.y * st.visH, tag.target.z);
      m.position.lerpVectors(this._palm, target, f);
      m.position.y += Math.sin(f * Math.PI) * r;
      // Flutter in flight, settle flat once stuck.
      const flutter = (1 - f) * Math.sin(t * 18 + tag.spin);
      m.rotation.set(flutter * 0.8, flutter * 1.2, tag.tilt + (1 - f) * tag.spin);
      m.scale.setScalar(Math.max(1e-4, r * 1.6 * Math.min(1, span(t, tag.launch - 0.1, tag.launch + 0.15))));
      // Sizzling fuse: sparks off the top edge, paper scorches darker.
      const burn = smooth(span(t, 1.4, tag.boom));
      if (burn > 0 && Math.random() < 0.5) {
        const top = new THREE.Vector3(0, 0.5, 0).applyMatrix4(m.matrixWorld);
        this.fuse.spawn(top.x, top.y, top.z, (Math.random() - 0.5) * r, Math.random() * r * 1.5, 0, 0.3);
      }
      m.material.color.setScalar(1 - 0.45 * burn);
    }
    this.fuse.setPixelScale(pxPerUnit(st));
    this.fuse.material.uniforms.uSize.value = r * 0.1;
    this.fuse.update(dt);
    this.rig.update(st, dt, t, r);
    st.darken = 0.15;
    st.vignette = 0.3;
  }

  dispose() {
    disposeTree(this.root);
  }
}
