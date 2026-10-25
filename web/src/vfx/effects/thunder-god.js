// Flying Thunder God: a seal formula ignites on the palm, a three-pronged
// kunai forms and is thrown across the room, then a yellow flash teleports
// you to it — sold by a frozen ghost of the frame smearing toward the kunai.
import * as THREE from "three";
import {
  ADDITIVE,
  Ghost,
  LightningRibbons,
  Sparks,
  boltPath,
  disposeTree,
  easeOutBack,
  glowSprite,
  pxPerUnit,
  smooth,
  span,
} from "../kit";

const DURATION = 4.8;
const THROW_AT = 0.75;
const LAND_AT = 1.3;
const JUMP_AT = 2.3;
const YELLOW = new THREE.Color(1.0, 0.85, 0.3);

const SEAL_FRAG = /* glsl */ `
uniform float uTime, uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float outer = 1.0 - smoothstep(0.0, 0.025, abs(r - 0.93));
  float inner = 1.0 - smoothstep(0.0, 0.018, abs(r - 0.6));
  // A band of formula "script": hashed on/off strokes in rotating cells.
  float cells = 34.0;
  float c = a * cells + uTime * 0.8;
  float id = floor(c);
  float f = fract(c);
  float band = (r - 0.65) / 0.24;
  float row = floor(band * 3.0);
  float stroke = step(0.4, hash(id * 3.1 + row * 17.0)) * step(0.15, f) * step(f, 0.85)
    * step(0.05, band) * step(band, 0.95) * step(0.1, fract(band * 3.0)) * step(fract(band * 3.0), 0.9);
  // Inner spokes counter-rotate.
  float spokes = (1.0 - smoothstep(0.0, 0.04, abs(fract(a * 6.0 - uTime * 0.3) - 0.5) * 2.0 - 0.92))
    * step(0.15, r) * step(r, 0.58) * 0.6;
  float m = max(max(outer, inner), max(stroke * 0.9, spokes));
  gl_FragColor = vec4(uColor * m * uAlpha, 1.0);
}`;

export function sealMesh() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(1.15, 0.95, 0.3) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SEAL_FRAG,
    ...ADDITIVE,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
}

// Minato's three-pronged kunai, modeled along +Y (tip up), ~1 unit long.
function buildKunai() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.7, roughness: 0.3 });
  const wrap = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 4), steel);
  blade.rotation.y = Math.PI / 4;
  blade.position.y = 0.47;
  g.add(blade);
  for (const side of [-1, 1]) {
    const prong = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.32, 4), steel);
    prong.position.set(side * 0.1, 0.32, 0);
    prong.rotation.z = -side * 0.5;
    g.add(prong);
  }
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), steel);
  guard.position.y = 0.18;
  g.add(guard);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 10), wrap);
  g.add(handle);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 8, 24), steel);
  ring.position.y = -0.24;
  g.add(ring);
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);

export default class FlyingThunderGod {
  static needs = ["hand"];
  static duration = DURATION;

  constructor(stage, { power = 1 } = {}) {
    this.stage = stage;
    this.power = power;
    this.root = new THREE.Group();

    this.root.add(new THREE.HemisphereLight(0xdde6ff, 0x221a10, 1.2));
    this.light = new THREE.PointLight(0xffd36a, 0, 0, 1.5);
    this.root.add(this.light);

    this.palmSeal = sealMesh();
    this.kunaiSeal = sealMesh();
    this.kunai = buildKunai();
    this.kunaiGlow = glowSprite(new THREE.Color(0.14, 0.11, 0.03));
    this.root.add(this.palmSeal, this.kunaiSeal, this.kunaiGlow, this.kunai);

    this.streak = new LightningRibbons({
      maxPoints: 2000,
      color: new THREE.Color(1.2, 0.9, 0.2),
      coreColor: new THREE.Color(1.6, 1.5, 1.0),
    });
    this.root.add(this.streak.mesh);
    this.sparks = new Sparks({ max: 300, color: new THREE.Color(1.6, 1.3, 0.5), size: 0.05, gravity: -3 });
    this.root.add(this.sparks.points);

    stage.scene.add(this.root);
    this.palm = new THREE.Vector3();
    this.target = null;
    this.ghost = null;
    this.landed = false;
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    const px = h.seen ? h.x : st.width * 0.4;
    const py = h.seen ? h.y : st.height * 0.62;
    const sizePx = h.seen ? h.size : st.height * 0.15;
    st.toWorld(px, py, 0, this.palm);
    const r = st.toWorldSize(sizePx);

    // The kunai flies to the far side of the room from the throwing hand.
    if (!this.target && t >= THROW_AT) {
      this.targetPx = { x: px < st.width / 2 ? st.width * 0.8 : st.width * 0.2, y: st.height * 0.42 };
      this.target = st.toWorld(this.targetPx.x, this.targetPx.y, -1.5);
    }

    // Palm seal.
    const sealIn = easeOutBack(span(t, 0.0, 0.5));
    const sealOut = 1 - span(t, JUMP_AT, JUMP_AT + 0.4);
    this.palmSeal.position.copy(this.palm);
    this.palmSeal.scale.setScalar(Math.max(1e-4, r * 0.9 * sealIn));
    this.palmSeal.rotation.z = t * 0.8;
    this.palmSeal.material.uniforms.uTime.value = t;
    this.palmSeal.material.uniforms.uAlpha.value = sealIn * sealOut * (t > THROW_AT ? 0.5 : 1);

    // Kunai: forms in the palm, then arcs out (toward the camera mid-flight).
    const k = this.kunai;
    const size = r * 1.7 * (0.9 + 0.2 * this.power);
    if (t < THROW_AT) {
      k.position.copy(this.palm);
      k.scale.setScalar(Math.max(1e-4, size * easeOutBack(span(t, 0.2, 0.6))));
      k.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), px < st.width / 2 ? -0.6 : 0.6);
      k.rotateY(t * 3);
    } else if (t < LAND_AT) {
      const f = smooth(span(t, THROW_AT, LAND_AT));
      const prev = k.position.clone();
      k.position.lerpVectors(this.palm, this.target, f);
      k.position.z += Math.sin(f * Math.PI) * 2.5;
      const vel = k.position.clone().sub(prev);
      if (vel.lengthSq() > 1e-8) k.quaternion.setFromUnitVectors(_up, vel.normalize());
      k.rotateY(t * 20);
      k.scale.setScalar(size);
    } else if (!this.landed) {
      this.landed = true;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = r * (2 + Math.random() * 5);
        this.sparks.spawn(this.target.x, this.target.y, this.target.z, Math.cos(a) * s, Math.sin(a) * s, 0, 0.3 + Math.random() * 0.4);
      }
      st.shake(0.008);
    }
    const out = 1 - span(t, DURATION - 0.5, DURATION);
    if (t >= LAND_AT) k.scale.setScalar(Math.max(1e-4, size * out));

    // Seal flares on the stuck kunai, the marker you'll jump to.
    const marked = t >= LAND_AT ? smooth(span(t, LAND_AT, LAND_AT + 0.3)) * out : 0;
    if (this.target) {
      this.kunaiSeal.position.copy(this.target);
      this.kunaiGlow.position.copy(this.target);
    }
    this.kunaiSeal.scale.setScalar(Math.max(1e-4, r * 1.1 * marked * (1 + 0.05 * Math.sin(t * 9))));
    this.kunaiSeal.rotation.z = -t * 1.2;
    this.kunaiSeal.material.uniforms.uTime.value = t;
    this.kunaiSeal.material.uniforms.uAlpha.value = marked * 0.55;
    this.kunaiGlow.scale.setScalar(r * 4 * marked);
    this.kunaiGlow.material.opacity = marked;

    this.light.position.copy(t < LAND_AT ? k.position : this.target ?? this.palm);
    this.light.position.z += 1;
    this.light.intensity = 12 * Math.max(sealIn * sealOut, marked);

    this._jump(t, r);
    this.sparks.setPixelScale(pxPerUnit(st));
    this.sparks.material.uniforms.uSize.value = r * 0.12;
    this.sparks.update(dt);

    const glowAt = t < LAND_AT ? { x: px, y: py } : this.targetPx;
    st.setLight(0, glowAt.x, glowAt.y, sizePx * 3, YELLOW, 0.9 * Math.max(sealIn * sealOut, marked));
    st.darken = 0.2;
    st.vignette = 0.35;
  }

  // The teleport: flash, streak from hand to kunai, ghost of the frame smears.
  _jump(t, r) {
    const st = this.stage;
    if (t >= JUMP_AT && !this.ghost) {
      this.ghost = new Ghost(st, st.snapshot());
      this.root.add(this.ghost.mesh);
    }
    if (!this.ghost) return;
    const f = span(t, JUMP_AT, JUMP_AT + 0.45);
    const dx = (this.targetPx.x - st.width / 2) / st.width;
    const u = this.ghost.uniforms;
    u.uOffset.value.set(dx * 0.25 * smooth(f), 0);
    u.uTint.value.setRGB(1.3, 1.15, 0.6);
    u.uAlpha.value = (1 - f) * 0.85;

    const hit = Math.exp(-(t - JUMP_AT) * 7);
    this.streak.begin();
    if (t < JUMP_AT + 0.3) {
      for (let i = 0; i < 3; i++) this.streak.addBolt(boltPath(this.palm, this.target, 5, 0.06), r * (0.18 - i * 0.05), 1.2);
    }
    this.streak.end();
    this.streak.material.uniforms.uIntensity.value = hit;
    st.flash.setRGB(0.55 * hit, 0.45 * hit, 0.12 * hit);
    st.shake(0.025 * hit);
    st.aberration = 0.02 + 0.35 * hit;
    st.bloom.strength = 0.8 + 1.5 * hit;
  }

  dispose() {
    this.ghost?.dispose();
    disposeTree(this.root);
  }
}
