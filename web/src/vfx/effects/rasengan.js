// Rasengan: a dense sphere of spiralling chakra held in the palm.
// Timeline: particles converge (charge) -> orb snaps in and churns
// (sustain) -> it swells and bursts in a shockwave (release).
import * as THREE from "three";
import { ADDITIVE, NOISE_GLSL, Shockwave, disposeTree, easeOutBack, glowSprite, lerp, pxPerUnit, span } from "../kit";

const DURATION = 6.0;
const RELEASE_AT = 5.2;
const RING_COUNT = 7;
const PARTICLES = 520;

const SPHERE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CORE_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uIntensity;
uniform vec3 uColor, uHot;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  vec3 p = normalize(vObj);
  float n = snoise(p * 2.2 + vec3(0.0, uTime * 1.7, 0.0));
  float ang = atan(p.z, p.x);
  // Spiral bands winding toward the poles, warped by noise so they churn.
  float bands = pow(0.5 + 0.5 * sin(ang * 5.0 + p.y * 7.0 - uTime * 19.0 + n * 3.5), 6.0);
  float fine = pow(max(0.0, snoise(p * 7.0 - vec3(uTime * 4.0))), 2.0);
  float rim = pow(1.0 - ndv, 3.0);
  float core = pow(ndv, 8.0);
  vec3 c = uColor * (bands * 0.75 + rim * 0.7 + fine * 0.35 + 0.02) + uHot * (core * 0.3 + bands * fine * 0.8);
  gl_FragColor = vec4(c * uIntensity, 1.0);
}`;

const SHELL_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uIntensity;
uniform vec3 uColor;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float n = snoise(normalize(vObj) * 3.0 + vec3(uTime * 2.5, 0.0, -uTime * 1.3));
  float rim = pow(1.0 - ndv, 3.0) * (0.7 + 0.6 * n);
  gl_FragColor = vec4(uColor * rim * uIntensity, 1.0);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const RING_FRAG = /* glsl */ `
uniform float uTime, uSpeed, uOffset, uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // Two comets chase each other around the ring, bright head + long tail.
  float f = fract(vUv.x * 2.0 - uTime * uSpeed + uOffset);
  float tail = pow(f, 3.5);
  gl_FragColor = vec4(uColor * tail * uIntensity, 1.0);
}`;

const PARTICLE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uCharge, uBurst, uPxPerUnit, uScale;
varying float vAlpha;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  float life = fract(uTime * (0.5 + aSeed.x * 0.9) + aSeed.y);
  // While charging, particles fall in from far away; once formed they
  // stay in a tight churning shell.
  float outer = mix(1.7, 4.2, 1.0 - uCharge);
  float r = mix(outer, 0.95, pow(life, 0.65));
  r += uBurst * (2.0 + aSeed.w * 7.0);
  float a = aSeed.z * 6.2831853 + uTime * (3.0 + life * 7.0);
  vec3 p = vec3(cos(a) * r, 0.0, sin(a) * r);
  p = rotZ(aSeed.x * 3.14159) * rotX((aSeed.w - 0.5) * 2.6) * p;
  vAlpha = sin(life * 3.14159) * (1.0 - uBurst);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.025 + aSeed.w * 0.045) * uScale * uPxPerUnit * (10.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const BLUE = new THREE.Color(0.25, 0.6, 1.0);

export default class Rasengan {
  static needs = ["hand"];
  static duration = DURATION;

  constructor(stage, { power = 1 } = {}) {
    this.stage = stage;
    this.power = power;
    const root = (this.root = new THREE.Group());
    const orb = (this.orb = new THREE.Group());
    root.add(orb);

    this.coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uColor: { value: new THREE.Color(0.12, 0.38, 1.25) },
        uHot: { value: new THREE.Color(0.9, 1.15, 1.5) },
      },
      vertexShader: SPHERE_VERT,
      fragmentShader: CORE_FRAG,
      ...ADDITIVE,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.coreMat);
    orb.add(this.core);

    this.shellMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(0.2, 0.45, 1.3) } },
      vertexShader: SPHERE_VERT,
      fragmentShader: SHELL_FRAG,
      ...ADDITIVE,
    });
    orb.add(new THREE.Mesh(new THREE.SphereGeometry(1.28, 96, 64), this.shellMat));

    this.rings = [];
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 1 },
        uOffset: { value: 0 },
        uIntensity: { value: 1 },
        uColor: { value: new THREE.Color(0.45, 0.75, 1.5) },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      ...ADDITIVE,
    });
    for (let i = 0; i < RING_COUNT; i++) {
      const pivot = new THREE.Group();
      pivot.quaternion.random();
      const mat = ringMat.clone();
      mat.uniforms.uSpeed.value = 1.6 + Math.random() * 2.2;
      mat.uniforms.uOffset.value = Math.random();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.02 + Math.random() * 0.32, 0.014 + Math.random() * 0.012, 6, 160),
        mat
      );
      pivot.add(ring);
      orb.add(pivot);
      this.rings.push({ pivot, ring, mat, spin: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6) });
    }
    ringMat.dispose();

    const seeds = new Float32Array(PARTICLES * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    pgeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCharge: { value: 0 },
        uBurst: { value: 0 },
        uPxPerUnit: { value: 100 },
        uScale: { value: 1 },
        uColor: { value: new THREE.Color(0.25, 0.45, 1.0) },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      ...ADDITIVE,
    });
    this.particles = new THREE.Points(pgeo, this.particleMat);
    this.particles.frustumCulled = false;
    root.add(this.particles);

    this.halo = glowSprite(new THREE.Color(0.06, 0.16, 0.5));
    root.add(this.halo);

    this.wave = new Shockwave(new THREE.Color(0.6, 1.0, 1.8), 0.05);
    root.add(this.wave.mesh);

    stage.scene.add(root);
    this._pos = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    const k = 0.85 + 0.3 * this.power;

    // Sit just past the palm center toward the fingers; with no hand yet,
    // hover in the lower-middle of the frame so the cast still reads.
    const ax = h.seen ? h.x + h.dirX * h.size * 0.2 : st.width / 2;
    const ay = h.seen ? h.y + h.dirY * h.size * 0.2 : st.height * 0.62;
    const radiusPx = (h.seen ? h.size * 0.62 : st.height * 0.1) * k;

    const charge = span(t, 0.0, 1.4);
    const form = easeOutBack(span(t, 0.55, 1.35));
    const release = span(t, RELEASE_AT, DURATION);
    const swell = 1 + release * 0.9;
    const fade = 1 - span(t, RELEASE_AT + 0.25, DURATION);
    const presence = lerp(0.35, 1, h.seen ? h.presence : 1);
    const energy = form * fade * presence;

    st.toWorld(ax, ay, 0, this._pos);
    const r = st.toWorldSize(radiusPx);
    this.root.position.copy(this._pos);
    this.orb.scale.setScalar(Math.max(1e-4, r * form * swell));
    this.orb.rotation.y += dt * 2.2;
    this.orb.rotation.x += dt * 0.9;

    this.coreMat.uniforms.uTime.value = t;
    this.coreMat.uniforms.uIntensity.value = energy * (0.92 + 0.08 * Math.sin(t * 40));
    this.shellMat.uniforms.uTime.value = t;
    this.shellMat.uniforms.uIntensity.value = energy;
    for (const ring of this.rings) {
      ring.ring.rotation.z += ring.spin * dt;
      ring.mat.uniforms.uTime.value = t;
      ring.mat.uniforms.uIntensity.value = energy;
    }

    const pu = this.particleMat.uniforms;
    pu.uTime.value = t;
    pu.uCharge.value = charge;
    pu.uBurst.value = release;
    pu.uPxPerUnit.value = pxPerUnit(st);
    pu.uScale.value = r;
    this.particles.scale.setScalar(r);

    this.halo.scale.setScalar(r * 4.2 * swell * Math.max(form, charge * 0.4));
    this.halo.material.opacity = fade * presence;

    this.wave.mesh.scale.setScalar(r * 14);
    this.wave.progress = release > 0 ? Math.min(1, release * 1.6) : 0;

    // How the orb sits in the world: it bends the image behind it, lights
    // the hand, and the frame dims so it reads as the brightest thing.
    st.setWarp(ax, ay, radiusPx * 1.6 * swell, 0.18 * energy, 2.2 * energy);
    st.setLight(0, ax, ay, radiusPx * 3.2, BLUE, 0.9 * energy * (0.85 + 0.15 * Math.sin(t * 31)));
    st.darken = 0.28 * Math.max(energy, charge * 0.5);
    st.desaturate = 0.2 * energy;
    st.vignette = 0.2 + 0.35 * energy;
    st.vignetteColor.setRGB(0.0, 0.02, 0.08);
    st.aberration = 0.02 + 0.05 * energy + release * 0.25;
    st.bloom.strength = 0.8 + 0.3 * energy + release * 0.8;
    st.shake(0.0015 * energy);
    if (release > 0) {
      const burst = Math.max(0, 1 - release * 2.5);
      st.flash.setRGB(0.25 * burst, 0.45 * burst, 0.7 * burst);
      st.shake(0.02 * burst);
    }
  }

  dispose() {
    disposeTree(this.root);
  }
}
