// Reusable building blocks shared by the effect families: easing, glow
// sprites, shockwaves, lightning ribbons and CPU spark particles.
import * as THREE from "three";
import { COVER_GLSL, SCREEN_VERT } from "./stage";

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
// 0..1 progress of t through [a, b].
export const span = (t, a, b) => clamp01((t - a) / (b - a));
export const smooth = (x) => x * x * (3 - 2 * x);
export const easeOutCubic = (x) => 1 - (1 - x) ** 3;
export function easeOutBack(x, k = 1.9) {
  const c = x - 1;
  return 1 + (k + 1) * c * c * c + k * c * c;
}

// Additive, HDR-capable material defaults: effects glow by writing colors
// above the stage's bloom threshold, so they must skip tone mapping.
export const ADDITIVE = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
};

// Ashima / Stefan Gustavson 3D simplex noise (MIT).
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}`;

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(0.6, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

// Soft additive billboard. `color` may exceed 1 to feed the bloom.
export function glowSprite(color) {
  const mat = new THREE.SpriteMaterial({ map: getGlowTexture(), color, ...ADDITIVE });
  return new THREE.Sprite(mat);
}

// Expanding ring on a camera-facing quad. Drive with .progress (0..1).
export class Shockwave {
  constructor(color, thickness = 0.08) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uColor: { value: color }, uThickness: { value: thickness } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uProgress, uThickness;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = 1.0 - smoothstep(0.0, uThickness * (1.0 - uProgress * 0.6), abs(r - uProgress));
          float fade = (1.0 - uProgress) * step(0.001, uProgress);
          gl_FragColor = vec4(uColor * ring * fade, 1.0);
        }`,
      ...ADDITIVE,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
  }
  set progress(v) {
    this.material.uniforms.uProgress.value = v;
  }
}

// Midpoint-displacement polyline between a and b — the jagged shape of a
// lightning bolt. Each level doubles the points and halves the jitter.
export function boltPath(a, b, levels = 5, roughness = 0.22) {
  let pts = [a.clone(), b.clone()];
  let disp = a.distanceTo(b) * roughness;
  for (let l = 0; l < levels; l++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().lerp(pts[i + 1], 0.5);
      m.x += (Math.random() * 2 - 1) * disp;
      m.y += (Math.random() * 2 - 1) * disp;
      m.z += (Math.random() * 2 - 1) * disp * 0.5;
      next.push(m, pts[i + 1]);
    }
    pts = next;
    disp *= 0.55;
  }
  return pts;
}

// Batches many camera-facing, tapered ribbons into one draw call. Rebuild
// every frame (or every few frames for a flicker) with begin/addBolt/end.
export class LightningRibbons {
  constructor({ maxPoints = 6000, color, coreColor }) {
    this.maxPoints = maxPoints;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxPoints * 2 * 3);
    this.attrs = new Float32Array(maxPoints * 2 * 3); // across, along, intensity
    this.indices = new Uint32Array(maxPoints * 6);
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aRib", new THREE.BufferAttribute(this.attrs, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uCore: { value: coreColor }, uIntensity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aRib;
        varying vec3 vRib;
        void main() { vRib = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uCore;
        uniform float uIntensity;
        varying vec3 vRib;
        void main() {
          float x = vRib.x;
          float core = exp(-x * x * 40.0);
          float halo = exp(-x * x * 3.0);
          vec3 c = uCore * core * 2.2 + uColor * halo * 0.9;
          gl_FragColor = vec4(c * vRib.z * uIntensity, 1.0);
        }`,
      ...ADDITIVE,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.begin();
  }

  begin() {
    this.np = 0;
    this.ni = 0;
  }

  addBolt(points, width, intensity = 1) {
    const n = points.length;
    if (n < 2 || this.np + n > this.maxPoints) return;
    const P = this.positions;
    const A = this.attrs;
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      let px = -(next.y - prev.y);
      let py = next.x - prev.x;
      const len = Math.hypot(px, py) || 1;
      const along = i / (n - 1);
      const w = width * (1 - 0.75 * along);
      px = (px / len) * w;
      py = (py / len) * w;
      const v = (this.np + i) * 2;
      const p = points[i];
      P.set([p.x - px, p.y - py, p.z, p.x + px, p.y + py, p.z], v * 3);
      // across = -1..1 over the ribbon width; the shader shapes core + halo from it.
      A.set([-1, along, intensity, 1, along, intensity], v * 3);
      if (i < n - 1) {
        this.indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], this.ni);
        this.ni += 6;
      }
    }
    this.np += n;
  }

  end() {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aRib.needsUpdate = true;
    this.geometry.index.needsUpdate = true;
    this.geometry.setDrawRange(0, this.ni);
  }
}

// Fixed-size pool of short-lived additive points with velocity + drag +
// gravity. Positions/sizes are world units; sizes scale with perspective.
export class Sparks {
  constructor({ max = 400, color, size = 0.08, gravity = -2, drag = 2.5 }) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); // remaining seconds
    this.maxLife = new Float32Array(max).fill(1);
    this.alpha = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uSize: { value: size }, uPxPerUnit: { value: 100 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uSize, uPxPerUnit;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * uPxPerUnit * (10.0 / -mv.z) * (0.4 + 0.6 * aAlpha);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      ...ADDITIVE,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  // pxPerUnit = renderer pixels per world unit at z = 0 (camera at z = 10).
  setPixelScale(pxPerUnit) {
    this.material.uniforms.uPxPerUnit.value = pxPerUnit;
  }

  spawn(x, y, z, vx, vy, vz, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt) {
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j] *= damp;
      this.vel[j + 1] = this.vel[j + 1] * damp + this.gravity * dt;
      this.vel[j + 2] *= damp;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

// Detach an effect's root and free its GPU resources. Shared textures
// (the glow sprite map) are left alone.
export function disposeTree(root) {
  root.removeFromParent();
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => m.dispose());
  });
}

// Renderer pixels per world unit on the z = 0 plane, for point sizing.
export function pxPerUnit(stage) {
  return (stage.height * stage.renderer.getPixelRatio()) / stage.visH;
}

// Procedural flame on a quad (uv.y = 0 at the base). Additive for normal
// fire; with `dark` it alpha-blends a black body with a colored rim
// (Amaterasu). Drive uTime and uAlpha; uSeed decorrelates neighbors.
const FLAME_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uSeed, uAlpha, uDark;
uniform vec3 uCore, uMid, uEdge;
varying vec2 vUv;
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  vec2 p = vUv;
  float x = (p.x - 0.5) * 2.0;
  float n = fbm(vec3(p.x * 2.6, p.y * 2.2 - uTime * 2.4, uSeed));
  // Teardrop that narrows and flickers upward.
  float width = mix(0.95, 0.1, pow(p.y, 0.8)) + n * 0.25;
  float body = 1.0 - smoothstep(0.0, 1.0, abs(x) / max(width, 0.05));
  float h = body * (1.0 - p.y * 0.9) + n * 0.5 - 0.15;
  float fire = smoothstep(0.08, 0.6, h) * smoothstep(0.0, 0.08, p.y);
  if (fire < 0.01) discard;
  if (uDark > 0.5) {
    vec3 c = mix(uEdge, uCore, smoothstep(0.15, 0.5, fire));
    gl_FragColor = vec4(c, smoothstep(0.05, 0.3, fire) * uAlpha);
  } else {
    vec3 c = mix(uEdge, uMid, smoothstep(0.1, 0.5, fire));
    c = mix(c, uCore, smoothstep(0.55, 0.95, fire));
    gl_FragColor = vec4(c * fire * uAlpha, 1.0);
  }
}`;

export function flameMaterial({ core, mid, edge, dark = false }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 100 },
      uAlpha: { value: 1 },
      uDark: { value: dark ? 1 : 0 },
      uCore: { value: core },
      uMid: { value: mid ?? core },
      uEdge: { value: edge },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: FLAME_FRAG,
    ...(dark ? { transparent: true, depthWrite: false, toneMapped: false } : ADDITIVE),
  });
}

// A flame quad whose origin is at the base, so scale.y = flame height.
export function flameMesh(material) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  return new THREE.Mesh(geo, material);
}

// Full-screen frozen camera frame drawn over the live feed — afterimages,
// teleport ghosts. Shares the stage's cover mapping so it lines up exactly.
export class Ghost {
  constructor(stage, texture) {
    const bg = stage.bg.uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: texture },
        uRes: bg.uRes,
        uVideoSize: bg.uVideoSize,
        uOffset: { value: new THREE.Vector2() },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uAlpha: { value: 0 },
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec2 uRes, uVideoSize, uOffset;
        uniform vec3 uTint;
        uniform float uAlpha;
        varying vec2 vUv;
        ${COVER_GLSL}
        void main() {
          vec2 v = coverUv(vUv - uOffset);
          if (v.x < 0.0 || v.x > 1.0 || v.y < 0.0 || v.y > 1.0) discard;
          gl_FragColor = vec4(min(texture2D(uTex, v).rgb * uTint, vec3(0.9)), uAlpha);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
  }
  get uniforms() {
    return this.material.uniforms;
  }
  dispose() {
    this.material.uniforms.uTex.value?.dispose();
  }
}
