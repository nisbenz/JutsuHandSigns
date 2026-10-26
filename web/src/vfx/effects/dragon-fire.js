// Fire Release: Great Dragon Fire. Embers are sucked into the mouth (inhale),
// then a coiling stream of volumetric fire puffs pours out of it toward the
// camera, swelling as it comes at you, with heat haze and warm light.
import * as THREE from "three";
import { NOISE_GLSL, Sparks, disposeTree, glowSprite, lerp, pxPerUnit, span } from "../kit";

const DURATION = 5.2;
const BREATH_AT = 0.9;
const BREATH_END = 4.2;
const PUFFS = 220;
const WARM = new THREE.Color(1.0, 0.55, 0.2);

const PUFF_VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
varying float vLife;
varying float vSeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  vLife = aLife;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const PUFF_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime;
varying float vLife;
varying float vSeed;
varying vec2 vUv;
void main() {
  if (vLife < 0.0) discard;
  vec2 p = vUv - 0.5;
  float n = snoise(vec3(p * 3.2, uTime * 1.6 + vSeed * 10.0)) * 0.6
          + snoise(vec3(p * 7.0, uTime * 2.5 + vSeed * 3.0)) * 0.3;
  float d = length(p) * 2.0 - n * 0.4;
  float a = 1.0 - smoothstep(0.25, 1.0, d);
  if (a < 0.01) discard;
  // White-hot at birth, through orange, to dull red as it cools.
  vec3 c = mix(vec3(1.7, 1.35, 0.8), vec3(1.5, 0.55, 0.1), smoothstep(0.0, 0.35, vLife));
  c = mix(c, vec3(0.55, 0.08, 0.02), smoothstep(0.35, 0.85, vLife));
  // Puffs grow as they cool and near the camera; thin them out so the
  // overlap reads as flame, not a white wall.
  a *= smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife)) / (1.0 + vLife * 1.5);
  gl_FragColor = vec4(c * a * 0.45, 1.0);
}`;

export default class GreatDragonFire {
  static needs = ["face"];
  static duration = DURATION;

  constructor(stage, { power = 1 } = {}) {
    this.stage = stage;
    this.power = power;
    this.root = new THREE.Group();

    const geo = new THREE.PlaneGeometry(1, 1);
    this.life = new Float32Array(PUFFS).fill(-1);
    this.seed = new Float32Array(PUFFS).map(() => Math.random());
    this.lifeAttr = new THREE.InstancedBufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aLife", this.lifeAttr);
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(this.seed, 1));
    this.puffMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.puffs = new THREE.InstancedMesh(geo, this.puffMat, PUFFS);
    this.puffs.frustumCulled = false;
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.puffs);

    this.pos = new Float32Array(PUFFS * 3);
    this.vel = new Float32Array(PUFFS * 3);
    this.age = new Float32Array(PUFFS);
    this.maxAge = new Float32Array(PUFFS).fill(1);
    this.size = new Float32Array(PUFFS);
    this.cursor = 0;
    this.spawnDebt = 0;

    this.mouthGlow = glowSprite(new THREE.Color(0.5, 0.22, 0.05));
    this.root.add(this.mouthGlow);
    this.embers = new Sparks({ max: 300, color: new THREE.Color(1.6, 0.8, 0.25), size: 0.04, gravity: 0, drag: 0 });
    this.root.add(this.embers.points);

    stage.scene.add(this.root);
    this._mouth = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  _spawn(mouth, s, aimX) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % PUFFS;
    const j = i * 3;
    this.pos.set([mouth.x, mouth.y - s * 0.05, mouth.z + 0.1], j);
    const speed = s * (8 + Math.random() * 3);
    this.vel.set(
      [
        (aimX * 0.9 + (Math.random() - 0.5) * 0.3) * speed,
        (-0.1 + (Math.random() - 0.5) * 0.25) * speed,
        (0.45 + Math.random() * 0.2) * speed,
      ],
      j
    );
    this.age[i] = 0;
    this.life[i] = 0;
    this.maxAge[i] = 0.9 + Math.random() * 0.5;
    this.size[i] = s * (0.5 + Math.random() * 0.4);
  }

  update(t, dt, track) {
    const st = this.stage;
    const f = track.face;
    const seen = f.seen;
    const mx = seen ? f.mouthX : st.width / 2;
    const my = seen ? f.mouthY : st.height * 0.55;
    const spanPx = seen ? Math.max(f.span, 30) : st.height * 0.12;
    st.toWorld(mx, my, 0, this._mouth);
    const s = st.toWorldSize(spanPx);
    // Breathe across the frame toward the roomier side (so the stream reads
    // as a coiling dragon rather than a blob straight into the lens), bent
    // further by where the face is turned.
    const eyeMid = (f.eyes[0].x + f.eyes[1].x) / 2;
    const turn = seen ? Math.max(-1, Math.min(1, ((f.noseX - eyeMid) / spanPx) * 4)) : 0;
    this.side ??= mx < st.width / 2 ? 1 : -1;
    const aimX = Math.max(-1.2, Math.min(1.2, this.side * 0.8 + turn * 0.6));

    const inhale = span(t, 0, BREATH_AT);
    const breath = span(t, BREATH_AT, BREATH_AT + 0.25) * (1 - span(t, BREATH_END, BREATH_END + 0.4));
    const fade = 1 - span(t, DURATION - 0.6, DURATION);

    // Inhale: embers pulled in from around the face.
    if (t < BREATH_AT) {
      const n = Math.round(dt * 160);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = s * (2.5 + Math.random() * 2);
        const sx = this._mouth.x + Math.cos(a) * d;
        const sy = this._mouth.y + Math.sin(a) * d;
        const life = 0.35 + Math.random() * 0.2;
        this.embers.spawn(sx, sy, 0, (this._mouth.x - sx) / life, (this._mouth.y - sy) / life, 0, life);
      }
    }
    this.embers.setPixelScale(pxPerUnit(st));
    this.embers.material.uniforms.uSize.value = s * 0.15;
    this.embers.update(dt);

    // Breath: spawn puffs and integrate them along a coiling path.
    if (breath > 0) {
      this.spawnDebt += dt * 45 * breath * (0.8 + 0.4 * this.power);
      while (this.spawnDebt >= 1) {
        this.spawnDebt -= 1;
        this._spawn(this._mouth, s, aimX);
      }
    }
    const m = this._m;
    for (let i = 0; i < PUFFS; i++) {
      if (this.life[i] < 0) {
        m.makeScale(0, 0, 0);
        this.puffs.setMatrixAt(i, m);
        continue;
      }
      this.age[i] += dt;
      const life = this.age[i] / this.maxAge[i];
      const j = i * 3;
      // Coil: a sideways push that rotates with age — the dragon's body.
      const phase = this.age[i] * 6 - t * 2.5;
      this.vel[j] += Math.sin(phase) * s * 3 * dt;
      this.vel[j + 1] += Math.cos(phase) * s * 9 * dt + s * 0.6 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (life >= 1 || this.pos[j + 2] > 6) {
        this.life[i] = -1;
        continue;
      }
      this.life[i] = life;
      const sc = this.size[i] * (1 + life * 5);
      m.makeScale(sc, sc, sc).setPosition(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.puffs.setMatrixAt(i, m);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.puffMat.uniforms.uTime.value = t;

    const glow = Math.max(inhale * 0.6, breath) * fade;
    this.mouthGlow.position.copy(this._mouth);
    this.mouthGlow.scale.setScalar(s * (1.2 + breath * 0.6) * (0.9 + Math.random() * 0.2));
    this.mouthGlow.material.opacity = glow;

    const flicker = 0.85 + Math.random() * 0.3;
    st.setLight(0, mx, my, spanPx * 6, WARM, 0.8 * glow * flicker);
    // Heat haze below the mouth and to the side the stream goes — kept off
    // the eyes, which would make the face look melted.
    st.setWarp(mx + aimX * spanPx * 2, my + spanPx * 2.5, spanPx * 3.5, -0.04 * breath, 0.25 * breath * Math.sin(t * 9));
    st.darken = 0.25 * glow;
    st.tint.setRGB(lerp(1, 1.12, glow), lerp(1, 0.95, glow), lerp(1, 0.78, glow));
    st.vignette = 0.25 + 0.35 * glow;
    st.vignetteColor.setRGB(0.06 * glow, 0.01 * glow, 0);
    st.bloom.strength = 0.8 + 0.2 * breath;
    st.shake(0.004 * breath);
    st.aberration = 0.02 + 0.04 * breath;
  }

  dispose() {
    disposeTree(this.root);
  }
}
