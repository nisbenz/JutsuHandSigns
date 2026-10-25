// Elemental building blocks, on top of kit.js: tubes along animated spines
// (dragons, sharks, branches), water and bark materials, fire/smoke puffs
// and explosions, ink ribbons (shadows) and person cut-outs (clones).
import * as THREE from "three";
import { COVER_GLSL, SCREEN_VERT } from "./stage";
import { LightningRibbons, NOISE_GLSL } from "./kit";

// ---------------------------------------------------------------------------
// Tube along an animated spine. Call update(points, radii) every frame with
// world-space points (tail -> head, exactly `segments` of them) and a radius
// per point; the geometry is rebuilt in place with parallel-transport frames
// so the tube can coil and whip without twisting. uv.x runs along the spine
// (0 tail, 1 head), uv.y around it.
export class SpineTube {
  constructor(material, { segments = 64, radial = 14 } = {}) {
    this.segments = segments;
    this.radial = radial;
    const verts = segments * (radial + 1);
    this.pos = new Float32Array(verts * 3);
    this.nor = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const idx = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        uv[k * 2] = i / (segments - 1);
        uv[k * 2 + 1] = j / radial;
        if (i < segments - 1 && j < radial) {
          const b = k + radial + 1;
          idx.push(k, b, k + 1, b, b + 1, k + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  update(points, radii) {
    const R = this.radial;
    const t = this._t;
    const n = this._n;
    const b = this._b;
    const tmp = this._tmp;
    t.subVectors(points[1], points[0]).normalize();
    n.set(0, 0, 1);
    if (Math.abs(t.dot(n)) > 0.9) n.set(1, 0, 0);
    n.addScaledVector(t, -n.dot(t)).normalize();
    for (let i = 0; i < this.segments; i++) {
      tmp.subVectors(points[Math.min(i + 1, this.segments - 1)], points[Math.max(i - 1, 0)]);
      if (tmp.lengthSq() > 1e-12) {
        t.copy(tmp).normalize();
        // Parallel transport: strip the new tangent's component from n.
        n.addScaledVector(t, -n.dot(t)).normalize();
      }
      b.crossVectors(t, n);
      const p = points[i];
      const r = radii[i];
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nx = n.x * c + b.x * s;
        const ny = n.y * c + b.y * s;
        const nz = n.z * c + b.z * s;
        const k = (i * (R + 1) + j) * 3;
        this.pos[k] = p.x + nx * r;
        this.pos[k + 1] = p.y + ny * r;
        this.pos[k + 2] = p.z + nz * r;
        this.nor[k] = nx;
        this.nor[k + 1] = ny;
        this.nor[k + 2] = nz;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }
}

// Resample a polyline to n points evenly spaced by arc length.
export function resample(points, n, out = []) {
  const lens = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = lens[lens.length - 1] || 1;
  let seg = 1;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * total;
    while (seg < points.length - 1 && lens[seg] < d) seg++;
    const f = (d - lens[seg - 1]) / Math.max(1e-9, lens[seg] - lens[seg - 1]);
    out[i] = (out[i] ?? new THREE.Vector3()).lerpVectors(points[seg - 1], points[seg], Math.min(1, Math.max(0, f)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Translucent water: deep body, bright fresnel rim, moving caustic glints and
// a hard specular. Pair with stage.setWarp for the refraction behind it.
export function waterMaterial({ deep = [0.05, 0.28, 0.55], rim = [0.55, 0.95, 1.4], opacity = 0.5 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 1 },
      uDeep: { value: new THREE.Color(...deep) },
      uRim: { value: new THREE.Color(...rim) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 nrm = normal;
        // Instanced use (e.g. a dragon's spines) needs the per-instance transform.
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
          nrm = mat3(instanceMatrix) * nrm;
        #endif
        vec4 w = modelMatrix * local;
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vN = normalize(normalMatrix * nrm);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime, uAlpha, uOpacity;
      uniform vec3 uDeep, uRim;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float fres = pow(1.0 - abs(dot(n, v)), 2.5);
        float c1 = snoise(vW * 2.2 + vec3(0.0, -uTime * 1.6, uTime * 0.7));
        float c2 = snoise(vW * 4.5 - vec3(uTime * 1.1, 0.0, 0.0));
        float caustic = pow(max(0.0, 1.0 - abs(c1 + c2 * 0.5)), 6.0);
        vec3 l = normalize(vec3(-0.4, 0.7, 0.6));
        float spec = pow(max(0.0, dot(reflect(-l, n), v)), 40.0);
        vec3 col = mix(uDeep, uRim, fres) + uRim * caustic * 0.5 + vec3(1.4) * spec;
        float a = (uOpacity + fres * 0.45 + caustic * 0.2 + spec) * uAlpha;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// Bark: stretched noise along the length (uv.x), lit by a fixed key light.
export function barkMaterial({ light = [0.47, 0.32, 0.2], dark = [0.16, 0.1, 0.06] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlpha: { value: 1 },
      uLight: { value: new THREE.Color(...light) },
      uDark: { value: new THREE.Color(...dark) },
      uLen: { value: 6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uAlpha, uLen;
      uniform vec3 uLight, uDark;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vec2 p = vec2(vUv.x * uLen * 6.0, vUv.y * 6.0);
        float grain = snoise(vec3(p.x * 0.35, p.y * 2.0, 1.7)) * 0.6 + snoise(vec3(p.x * 1.4, p.y * 6.0, 3.1)) * 0.4;
        vec3 base = mix(uDark, uLight, smoothstep(0.1, 0.7, abs(grain)));
        float lit = 0.35 + 0.75 * max(0.0, dot(normalize(vN), normalize(vec3(-0.5, 0.6, 0.7))));
        gl_FragColor = vec4(base * lit, uAlpha);
      }`,
    transparent: true,
  });
}

// ---------------------------------------------------------------------------
// Pool of billboarded fire or smoke puffs (one InstancedMesh). Fire is
// additive and cools white -> orange -> red; smoke alpha-blends grey and
// swells. Spawn with a velocity; drag and lift shape the plume.
export class Puffs {
  // `smoke` = [dark rgb, light rgb] for smoke mode (default grey).
  constructor({ max = 200, mode = "fire", drag = 2.2, lift = 0.6, smoke = [[0.22, 0.2, 0.19], [0.42, 0.4, 0.38]] } = {}) {
    this.max = max;
    this.drag = drag;
    this.lift = lift;
    const fire = mode === "fire";
    const geo = new THREE.PlaneGeometry(1, 1);
    this.life = new Float32Array(max).fill(-1);
    this.lifeAttr = new THREE.InstancedBufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aLife", this.lifeAttr);
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(max).map(() => Math.random()), 1));
    const shade = fire
      ? `vec3 c = mix(vec3(1.8, 1.5, 1.0), vec3(1.5, 0.6, 0.12), smoothstep(0.0, 0.3, vLife));
         c = mix(c, vec3(0.5, 0.08, 0.02), smoothstep(0.3, 0.8, vLife));
         a *= (1.0 - smoothstep(0.5, 1.0, vLife)) / (1.0 + vLife * 2.0);
         gl_FragColor = vec4(c * a * 0.6 * uAlpha, 1.0);`
      : `vec3 c = mix(vec3(${smoke[0].join(", ")}), vec3(${smoke[1].join(", ")}), n * 0.5 + 0.5);
         a *= smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.4, 1.0, vLife)) * 0.8;
         gl_FragColor = vec4(c, a * uAlpha);`;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
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
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime, uAlpha;
        varying float vLife;
        varying float vSeed;
        varying vec2 vUv;
        void main() {
          if (vLife < 0.0) discard;
          vec2 p = vUv - 0.5;
          float n = snoise(vec3(p * 3.0, uTime * 1.2 + vSeed * 10.0)) * 0.6 + snoise(vec3(p * 7.0, vSeed * 5.0 + uTime)) * 0.3;
          float a = 1.0 - smoothstep(0.3, 1.0, length(p) * 2.0 - n * 0.35);
          if (a < 0.01) discard;
          ${shade}
        }`,
      transparent: true,
      depthWrite: false,
      blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = fire ? 5 : 4;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.maxAge = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.cursor = 0;
    this._m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
  }

  spawn(x, y, z, vx, vy, vz, size, life, grow = 3) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = 0;
    this.maxAge[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
  }

  update(dt, t) {
    const damp = Math.exp(-this.drag * dt);
    const m = this._m;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] < 0) continue;
      this.age[i] += dt;
      const life = this.age[i] / this.maxAge[i];
      if (life >= 1) {
        this.life[i] = -1;
        this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      const j = i * 3;
      this.vel[j] *= damp;
      this.vel[j + 1] = this.vel[j + 1] * damp + this.lift * dt;
      this.vel[j + 2] *= damp;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.life[i] = life;
      const sc = this.size[i] * (1 + life * this.grow[i]);
      m.makeScale(sc, sc, sc).setPosition(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.material.uniforms.uTime.value = t;
  }
}

// One explosion: fireball, smoke plume and a spray of sparks. `s` is the
// blast radius in world units.
export function explode({ fire, smoke, sparks }, at, s) {
  const d = new THREE.Vector3();
  for (let i = 0; i < 26; i++) {
    d.set(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.6).normalize();
    const v = s * (2 + Math.random() * 4);
    fire.spawn(at.x, at.y, at.z + 0.1, d.x * v, d.y * v, d.z * v, s * (0.35 + Math.random() * 0.3), 0.5 + Math.random() * 0.4, 2.5);
  }
  for (let i = 0; smoke && i < 14; i++) {
    d.set(Math.random() - 0.5, Math.random() - 0.3, (Math.random() - 0.5) * 0.4).normalize();
    const v = s * (1 + Math.random() * 2);
    smoke.spawn(at.x, at.y, at.z - 0.05, d.x * v, d.y * v, d.z * v, s * (0.4 + Math.random() * 0.3), 1.4 + Math.random(), 3);
  }
  for (let i = 0; sparks && i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = s * (4 + Math.random() * 7);
    sparks.spawn(at.x, at.y, at.z, Math.cos(a) * v, Math.sin(a) * v, (Math.random() - 0.5) * v * 0.4, 0.3 + Math.random() * 0.5);
  }
}

// ---------------------------------------------------------------------------
// Dark, soft-edged ribbons (shadows, ink). Same API as LightningRibbons.
export class InkRibbons extends LightningRibbons {
  constructor({ maxPoints = 6000, color = new THREE.Color(0.02, 0.015, 0.03) } = {}) {
    super({ maxPoints, color, coreColor: color });
    this.material.dispose();
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uIntensity: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aRib;
        varying vec3 vRib;
        void main() { vRib = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform vec3 uColor;
        uniform float uIntensity, uTime;
        varying vec3 vRib;
        void main() {
          // Smoky edge: the width threshold breathes with noise.
          float n = snoise(vec3(vRib.y * 18.0, vRib.x * 2.0, uTime * 2.0)) * 0.25;
          float a = (1.0 - smoothstep(0.55 + n, 1.0 + n, abs(vRib.x))) * vRib.z * uIntensity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, min(a, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh.material = this.material;
  }
}

// ---------------------------------------------------------------------------
// The player cut out of the frame by the person segmentation, drawn
// full-screen with an offset / scale. Either a frozen copy (snapshot + mask
// taken now) or `live` (the camera feed + the mask updated every frame, so
// the copy moves with you — clones, or redrawing you in front of something
// rendered "behind" you). Grades: none, clay, wood, paper, feral. The
// stage's color grade is applied too so the copy matches the background.
const GRADES = { none: 0, clay: 1, wood: 2, paper: 3, feral: 4 };

export class Cutout {
  constructor(stage, segment, { grade = "none", live = false } = {}) {
    const bg = stage.bg.uniforms;
    this.live = live;
    this.snapshot = live ? null : stage.snapshot();
    this.version = -1;
    this.mask = this._maskTexture(segment);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: live ? stage.videoTex : this.snapshot },
        uMask: { value: this.mask },
        uRes: bg.uRes,
        uVideoSize: bg.uVideoSize,
        uDarken: bg.uDarken,
        uDesat: bg.uDesat,
        uTint: bg.uTint,
        uOffset: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uPivot: { value: new THREE.Vector2(0.5, 0) },
        uAlpha: { value: 0 },
        uReveal: { value: 1 },
        uGrade: { value: GRADES[grade] },
        uMix: { value: 1 },
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform sampler2D uTex, uMask;
        uniform vec2 uRes, uVideoSize, uOffset, uPivot;
        uniform float uScale, uAlpha, uReveal, uGrade, uMix, uDarken, uDesat;
        uniform vec3 uTint;
        varying vec2 vUv;
        ${COVER_GLSL}
        void main() {
          vec2 s = (vUv - uOffset - uPivot) / uScale + uPivot;
          // Reveal sweeps bottom -> top (clones rising out of the ground).
          if (s.y > uReveal) discard;
          vec2 v = coverUv(s);
          if (v.x < 0.0 || v.x > 1.0 || v.y < 0.0 || v.y > 1.0) discard;
          // Mask rows run top-down, the video texture bottom-up.
          float a = smoothstep(0.35, 0.7, texture2D(uMask, vec2(v.x, 1.0 - v.y)).r) * uAlpha;
          if (a < 0.01) discard;
          vec3 src = texture2D(uTex, v).rgb;
          vec3 c = src;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          if (uGrade > 3.5) {
            // Feral: hot, contrasty, a little wild.
            c = clamp((c * vec3(1.18, 0.95, 0.82) - 0.5) * 1.35 + 0.5, 0.0, 1.0);
          } else if (uGrade > 2.5) {
            // Paper: off-white sheet with diagonal folds.
            float fold = smoothstep(0.93, 1.0, abs(fract((s.x + s.y * 0.6) * 9.0) * 2.0 - 1.0));
            c = mix(vec3(0.8, 0.78, 0.74), vec3(0.98, 0.97, 0.94), smoothstep(0.1, 0.8, l)) * (1.0 - fold * 0.18);
          } else if (uGrade > 1.5) {
            float grain = snoise(vec3(s.x * 90.0, s.y * 8.0, 2.0)) * 0.5 + 0.5;
            c = mix(vec3(0.2, 0.12, 0.06), vec3(0.62, 0.43, 0.25), l * 1.2) * (0.8 + 0.35 * grain);
          } else if (uGrade > 0.5) {
            float lumpy = snoise(vec3(s * 30.0, 1.0)) * 0.04;
            c = mix(vec3(0.55, 0.52, 0.47), vec3(0.95, 0.92, 0.86), smoothstep(0.1, 0.8, l + lumpy));
          }
          c = mix(src, c, uMix);
          c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), uDesat) * uTint * (1.0 - uDarken);
          gl_FragColor = vec4(min(c, vec3(0.92)), a);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = live ? 40 : -800;
  }

  _maskTexture(segment) {
    const tex = new THREE.DataTexture(Uint8Array.from(segment.data), segment.width, segment.height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.version = segment.version ?? 0;
    return tex;
  }

  // Live cut-outs: pull in the latest mask (no-op if unchanged).
  update(segment) {
    if (!this.live || !segment.seen || segment.version === this.version) return;
    const img = this.mask.image;
    if (img.width !== segment.width || img.height !== segment.height) {
      this.mask.dispose();
      this.mask = this._maskTexture(segment);
      this.material.uniforms.uMask.value = this.mask;
      return;
    }
    img.data.set(segment.data);
    this.mask.needsUpdate = true;
    this.version = segment.version;
  }

  get uniforms() {
    return this.material.uniforms;
  }

  dispose() {
    this.snapshot?.dispose();
    this.mask.dispose();
  }
}

// Stand-in mask (whole frame) for when segmentation hasn't produced one.
export const FULL_MASK = { seen: false, data: new Uint8Array([255, 255, 255, 255]), width: 2, height: 2, version: 0 };

// Horizontal center of the person in the mask, as a screen fraction (the
// mask is in raw video orientation, so x is mirrored).
export function personCenterX(seg) {
  if (!seg?.seen) return 0.5;
  let sum = 0;
  let wx = 0;
  for (let y = 0; y < seg.height; y += 4) {
    for (let x = 0; x < seg.width; x += 4) {
      const v = seg.data[y * seg.width + x];
      sum += v;
      wx += v * x;
    }
  }
  return sum > 0 ? 1 - wx / sum / seg.width : 0.5;
}

// Scaly skin for snakes: offset rows of rounded scales along the tube
// (uv.x along the body), a paler belly band, lit by a fixed key light.
export function scaleMaterial({ light = [0.55, 0.42, 0.7], dark = [0.18, 0.1, 0.25], belly = [0.85, 0.8, 0.7] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlpha: { value: 1 },
      uLight: { value: new THREE.Color(...light) },
      uDark: { value: new THREE.Color(...dark) },
      uBelly: { value: new THREE.Color(...belly) },
      uLen: { value: 8 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha, uLen;
      uniform vec3 uLight, uDark, uBelly;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vec2 p = vec2(vUv.x * uLen * 10.0, vUv.y * 14.0);
        p.x += floor(p.y) * 0.5;
        vec2 f = fract(p) - 0.5;
        float scale = 1.0 - smoothstep(0.3, 0.5, length(f * vec2(1.0, 1.3)));
        vec3 base = mix(uDark, uLight, 0.35 + 0.65 * scale);
        // Pale belly stripe along one side of the tube.
        base = mix(uBelly * (0.7 + 0.3 * scale), base, smoothstep(0.15, 0.3, abs(vUv.y - 0.75)));
        float lit = 0.35 + 0.8 * max(0.0, dot(normalize(vN), normalize(vec3(-0.5, 0.6, 0.7))));
        gl_FragColor = vec4(base * lit, uAlpha);
      }`,
    transparent: true,
  });
}
