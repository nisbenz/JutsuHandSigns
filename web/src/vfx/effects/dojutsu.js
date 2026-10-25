// Dōjutsu family: every eye technique is a procedural iris locked onto each
// tracked eye (clipped by the real eye opening, rolled with the head) plus
// an optional world-level extra (Kamui vortex, Tsukuyomi world, waves,
// Byakugan veins).
//
// Rule for this family: never warp the image near the face. The irises are
// placed from tracking, so bending the pixels under them makes the real
// eyes slide out from beneath the overlay.
import * as THREE from "three";
import { NOISE_GLSL, Shockwave, disposeTree, flameMaterial, flameMesh, glowSprite, lerp, smooth, span } from "../kit";

// Quad half-size in iris radii: holds the eye opening (~1.8 iris radii to
// each side of the iris) plus its offset from the iris center.
const QUAD = 2.6;
const VEIN_QUAD = 6.5;

const PATTERN = { tomoe: 0, pinwheel: 1, rinnegan: 2, byakugan: 3 };

// Mangekyō pinwheels: [arms, curl (spiral twist), blade width, center disc].
const WHEELS = {
  itachi: [3, 2.4, 0.2, 0.26],
  obito: [3, 3.4, 0.13, 0.2],
  shisui: [4, 1.5, 0.17, 0.2],
};
function wheelFor(character, fallback) {
  if (character === "itachi-uchiha") return WHEELS.itachi;
  if (character === "shisui-uchiha") return WHEELS.shisui;
  if (character === "obito-uchiha" || character === "kakashi-hatake") return WHEELS.obito;
  return WHEELS[fallback];
}

const RED_GRADE = {
  desat: 0.55,
  tint: [1.05, 0.88, 0.88],
  darken: 0.3,
  vignette: [0.12, 0, 0],
  light: new THREE.Color(1.0, 0.15, 0.1),
  glint: new THREE.Color(2.2, 0.25, 0.15),
};
const SHARINGAN_IRIS = { irisIn: [1.6, 0.05, 0.04], irisOut: [0.5, 0.0, 0.01] };

const SPECS = {
  sharingan: { pattern: "tomoe", duration: 6, ...SHARINGAN_IRIS, grade: RED_GRADE },
  mangekyo: { pattern: "pinwheel", wheel: "obito", duration: 6.5, ...SHARINGAN_IRIS, grade: RED_GRADE, extra: "waves", waveColor: [1.2, 0.1, 0.08] },
  kamui: { pattern: "pinwheel", wheel: "obito", duration: 7, ...SHARINGAN_IRIS, grade: RED_GRADE, extra: "vortex" },
  tsukuyomi: { pattern: "pinwheel", wheel: "itachi", duration: 7, ...SHARINGAN_IRIS, grade: RED_GRADE, extra: "tsukuyomi" },
  amaterasu: { pattern: "pinwheel", wheel: "itachi", duration: 7.5, ...SHARINGAN_IRIS, grade: RED_GRADE, extra: "amaterasu" },
  kotoamatsukami: { pattern: "pinwheel", wheel: "shisui", duration: 6.5, ...SHARINGAN_IRIS, grade: RED_GRADE, extra: "waves", waveColor: [1.4, 0.35, 0.3] },
  rinnegan: {
    pattern: "rinnegan",
    duration: 6.5,
    irisScale: 1.45, // the Rinnegan ripples cover the whole eye
    irisIn: [0.85, 0.7, 1.15],
    irisOut: [0.55, 0.42, 0.85],
    grade: {
      desat: 0.5,
      tint: [0.95, 0.9, 1.12],
      darken: 0.3,
      vignette: [0.06, 0, 0.12],
      light: new THREE.Color(0.6, 0.4, 1.0),
      glint: new THREE.Color(1.4, 1.0, 2.2),
    },
    extra: "waves",
    waveColor: [0.7, 0.45, 1.3],
  },
  byakugan: {
    pattern: "byakugan",
    duration: 6.5,
    irisIn: [0.97, 0.95, 1.02],
    irisOut: [0.78, 0.74, 0.9],
    grade: {
      desat: 0.9,
      tint: [0.86, 0.93, 1.12],
      darken: 0.15,
      vignette: [0, 0.01, 0.06],
      light: new THREE.Color(0.8, 0.8, 1.0),
      glint: new THREE.Color(1.6, 1.6, 2.0),
    },
    extra: "veins",
    waveColor: [0.9, 0.9, 1.4],
  },
};

const PLAIN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const EYE_FRAG = /* glsl */ `
#define TAU 6.2831853
uniform float uRot, uTomoeR, uAlpha, uGlow, uMorph, uPattern;
uniform vec2 uLid;    // eye-opening half extents, in iris radii
uniform vec2 uLidC;   // eye-opening center relative to the iris, in iris radii
uniform vec4 uWheel;  // pinwheel arms, curl, blade width, center disc
uniform vec3 uIrisIn, uIrisOut;
varying vec2 vUv;

float tomoe(vec2 p, float a0, float ringR) {
  vec2 c = ringR * vec2(cos(a0), sin(a0));
  float head = 1.0 - smoothstep(0.11, 0.135, length(p - c));
  float th = atan(p.y, p.x);
  float d = mod(a0 - th + TAU, TAU);
  float tailLen = 1.15;
  float w = 0.105 * (1.0 - d / tailLen);
  float rr = ringR + 0.04 + d * 0.11;
  float tail = d < tailLen ? 1.0 - smoothstep(w * 0.7, w, abs(length(p) - rr)) : 0.0;
  return max(head, tail * step(0.15, ringR));
}

// Curved blades spiralling out from a central disc, tapering to points.
float pinwheel(vec2 p) {
  float r = length(p);
  float th = atan(p.y, p.x);
  float arms = uWheel.x;
  float a = (th - uRot - r * uWheel.y) * arms / TAU;
  float d = abs(fract(a + 0.5) - 0.5) * TAU / arms * max(r, 0.05);
  float w = uWheel.z * pow(sin(clamp(r / 0.9, 0.0, 1.0) * 3.14159), 0.6);
  float blade = 1.0 - smoothstep(w * 0.8, w, d);
  float disc = 1.0 - smoothstep(uWheel.w - 0.02, uWheel.w, r);
  return max(blade, disc);
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * ${QUAD.toFixed(2)};
  float lid = 1.0 - smoothstep(0.82, 1.02, length((p - uLidC) / max(uLid, vec2(1e-3))));
  float r = length(p);
  float iris = 1.0 - smoothstep(0.95, 1.0, r);
  float a = iris * lid * uAlpha;
  if (a < 0.01) discard;

  float th = atan(p.y, p.x);
  vec3 col = mix(uIrisIn, uIrisOut, smoothstep(0.2, 1.0, r));
  col *= (0.85 + 0.15 * sin(th * 46.0 + r * 12.0)) * uGlow;
  vec3 ink = vec3(0.02, 0.0, 0.0);

  if (uPattern < 1.5) {
    col = mix(col, ink, smoothstep(0.84, 0.93, r));
    float ring = (1.0 - smoothstep(0.018, 0.034, abs(r - 0.56))) * smoothstep(0.3, 0.56, uTomoeR);
    float tm = 0.0;
    for (int k = 0; k < 3; k++) tm = max(tm, tomoe(p, uRot + float(k) * TAU / 3.0, uTomoeR));
    float base = max(tm, ring * 0.85);
    float m = uPattern > 0.5 ? mix(base, pinwheel(p), uMorph) : base;
    col = mix(col, ink, m);
    col = mix(col, vec3(0.0), 1.0 - smoothstep(0.16, 0.2, r));
  } else if (uPattern < 2.5) {
    float rings = 0.0;
    for (int i = 1; i <= 4; i++) {
      rings = max(rings, 1.0 - smoothstep(0.012, 0.03, abs(r - float(i) * 0.21)));
    }
    col = mix(col, vec3(0.06, 0.02, 0.1), rings);
    col = mix(col, vec3(0.04, 0.0, 0.06), 1.0 - smoothstep(0.07, 0.09, r));
  } else {
    // Byakugan: pale, pupil-less, just a faint ring hinting at the iris.
    col *= 1.0 - 0.18 * (1.0 - smoothstep(0.015, 0.05, abs(r - 0.62)));
  }

  col += vec3(1.2) * (1.0 - smoothstep(0.0, 0.1, length(p - vec2(-0.32, 0.36)))) * 0.6;
  gl_FragColor = vec4(col, a);
}`;

// Bulging veins on the skin around the eye (Byakugan). Ridged noise gives
// thin branching lines; masked to a band outside the eye opening.
const VEIN_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uAlpha, uSeed;
uniform vec2 uLid, uLidC;
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * ${VEIN_QUAD.toFixed(2)};
  float inner = length((p - uLidC) / (max(uLid, vec2(0.5)) * vec2(1.05, 1.5)));
  float outer = length((p - uLidC) / vec2(5.5, 3.2));
  float mask = smoothstep(1.0, 1.35, inner) * (1.0 - smoothstep(0.55, 1.0, outer));
  float v1 = pow(1.0 - abs(snoise(vec3(p * 0.55, uSeed))), 14.0);
  float v2 = pow(1.0 - abs(snoise(vec3(p * 1.3, uSeed + 7.0))), 22.0) * 0.7;
  float a = max(v1, v2) * mask * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.22, 0.14, 0.26), a * 0.75);
}`;

// Kamui's space-time vortex: dark spiral arms around a black core.
const VORTEX_FRAG = /* glsl */ `
uniform float uTime, uAlpha;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float th = atan(p.y, p.x);
  float arms = 0.5 + 0.5 * sin(th * 3.0 + log(max(r, 1e-3)) * 7.0 + uTime * 9.0);
  float fall = 1.0 - smoothstep(0.35, 1.0, r);
  float core = 1.0 - smoothstep(0.08, 0.2, r);
  float a = max(smoothstep(0.55, 0.95, arms) * fall * 0.8, core) * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.03, 0.0, 0.05), a);
}`;

// A trickle of blood from the eye that strains the Mangekyō (Amaterasu).
// Quad origin at its top; uv.y = 1 at the eye, 0 at the bottom.
const BLEED_FRAG = /* glsl */ `
uniform float uLen, uAlpha;
varying vec2 vUv;
void main() {
  float y = 1.0 - vUv.y;
  float x = (vUv.x - 0.5) * 2.0;
  float wob = sin(y * 11.0) * 0.12;
  float w = mix(0.5, 0.28, y);
  float line = (1.0 - smoothstep(w * 0.6, w, abs(x - wob))) * step(y, uLen);
  float drop = 1.0 - smoothstep(0.35, 0.6, length(vec2(x - wob, (y - uLen) * 4.0)));
  float a = max(line, drop * step(0.02, uLen)) * uAlpha;
  if (a < 0.01) discard;
  vec3 c = mix(vec3(0.45, 0.0, 0.02), vec3(0.75, 0.05, 0.05), 1.0 - smoothstep(0.0, 0.4, abs(x - wob - 0.15)));
  gl_FragColor = vec4(c, a * 0.9);
}`;

const AMATERASU_FLAMES = 14;

const _v = new THREE.Vector2();

class Dojutsu {
  constructor(stage, { power = 1, character } = {}, spec) {
    this.stage = stage;
    this.power = power;
    this.spec = spec;
    this.morphs = spec.pattern === "pinwheel";
    this.activateAt = this.morphs ? 1.5 : 1.0;
    this.rot = 0;
    this.root = new THREE.Group();

    const wheel = spec.wheel ? wheelFor(character, spec.wheel) : [3, 2, 0.15, 0.2];
    const eyeMat = new THREE.ShaderMaterial({
      uniforms: {
        uRot: { value: 0 },
        uTomoeR: { value: 0 },
        uAlpha: { value: 0 },
        uGlow: { value: 1 },
        uMorph: { value: 0 },
        uPattern: { value: PATTERN[spec.pattern] },
        uLid: { value: new THREE.Vector2(1.8, 1.0) },
        uLidC: { value: new THREE.Vector2() },
        uWheel: { value: new THREE.Vector4(...wheel) },
        uIrisIn: { value: new THREE.Color(...spec.irisIn) },
        uIrisOut: { value: new THREE.Color(...spec.irisOut) },
      },
      vertexShader: PLAIN_VERT,
      fragmentShader: EYE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    this.eyes = [0, 1].map((i) => {
      const mat = eyeMat.clone();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      mesh.renderOrder = 2;
      const glint = glowSprite(spec.grade.glint.clone());
      this.root.add(mesh, glint);
      const eye = { mesh, mat, glint, pos: new THREE.Vector3() };
      if (spec.extra === "veins") {
        eye.veinMat = new THREE.ShaderMaterial({
          uniforms: {
            uAlpha: { value: 0 },
            uSeed: { value: i * 13.7 },
            uLid: { value: new THREE.Vector2() },
            uLidC: { value: new THREE.Vector2() },
          },
          vertexShader: PLAIN_VERT,
          fragmentShader: VEIN_FRAG,
          transparent: true,
          depthWrite: false,
        });
        eye.veins = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), eye.veinMat);
        eye.veins.renderOrder = 1;
        this.root.add(eye.veins);
      }
      return eye;
    });
    eyeMat.dispose();

    if (spec.extra === "waves" || spec.extra === "veins") {
      const color = new THREE.Color(...spec.waveColor);
      this.waves = [0, 1, 2].map(() => {
        const w = new Shockwave(color, 0.02);
        this.root.add(w.mesh);
        return w;
      });
    }

    if (spec.extra === "vortex") {
      this.vortexMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
        vertexShader: PLAIN_VERT,
        fragmentShader: VORTEX_FRAG,
        transparent: true,
        depthWrite: false,
      });
      this.vortex = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.vortexMat);
      this.vortexGlow = glowSprite(new THREE.Color(0.5, 0.1, 0.8));
      this.root.add(this.vortexGlow, this.vortex);
      this.vortexAt = null;
    }

    if (spec.extra === "amaterasu") {
      const black = { core: new THREE.Color(0.01, 0.0, 0.015), edge: new THREE.Color(0.55, 0.08, 0.5), dark: true };
      this.flames = Array.from({ length: AMATERASU_FLAMES }, (_, i) => {
        const mesh = flameMesh(flameMaterial(black));
        mesh.renderOrder = 3;
        // First half cluster on the target, the rest crawl along the floor.
        mesh.userData = { onTarget: i < AMATERASU_FLAMES / 2, slot: Math.random(), h: 0.7 + Math.random() * 0.6, delay: Math.random() * 0.8 };
        this.root.add(mesh);
        return mesh;
      });
      this.bleedMat = new THREE.ShaderMaterial({
        uniforms: { uLen: { value: 0 }, uAlpha: { value: 0 } },
        vertexShader: PLAIN_VERT,
        fragmentShader: BLEED_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, -0.5, 0);
      this.bleed = new THREE.Mesh(geo, this.bleedMat);
      this.bleed.renderOrder = 3;
      this.root.add(this.bleed);
    }

    if (spec.extra === "tsukuyomi") {
      this.moon = new THREE.Mesh(
        new THREE.CircleGeometry(1, 64),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.06, 0.04), transparent: true, toneMapped: false })
      );
      this.moonGlow = glowSprite(new THREE.Color(0.9, 0.05, 0.02));
      this.root.add(this.moonGlow, this.moon);
    }

    stage.scene.add(this.root);
  }

  update(t, dt, track) {
    const st = this.stage;
    const f = track.face;
    const spec = this.spec;
    const g = spec.grade;
    const act = this.activateAt;
    const D = spec.duration;

    const awaken = smooth(span(t, 0.15, 1.0));
    const morph = this.morphs ? smooth(span(t, 1.0, 1.5)) : 0;
    const spin = lerp(16, this.morphs ? 0.6 : 0.9, smooth(span(t, 0.3, act + 0.8)));
    this.rot -= spin * dt;
    const outro = 1 - span(t, D - 0.7, D);
    const flare = t > act ? Math.exp(-(t - act) * 4) : 0;
    const active = smooth(span(t, act - 0.3, act + 0.3)) * outro;
    const extra = smooth(span(t, act + 0.2, act + 1.2)) * outro;
    const presence = f.seen ? f.presence : 0;
    const irisScale = spec.irisScale ?? 1;

    for (let i = 0; i < 2; i++) {
      const e = f.eyes[i];
      const eye = this.eyes[i];
      const rPx = e.r * irisScale * (0.97 + 0.06 * this.power);
      st.toWorld(e.x, e.y, 0.05, eye.pos);
      const r = st.toWorldSize(rPx);
      eye.mesh.position.copy(eye.pos);
      eye.mesh.scale.setScalar(Math.max(1e-4, r * QUAD));
      eye.mesh.rotation.z = -f.roll;

      // Eye-opening center relative to the iris, in the eye's rolled frame
      // (screen y points down, mesh y points up).
      _v.set(e.cx - e.x, -(e.cy - e.y)).rotateAround({ x: 0, y: 0 }, f.roll).divideScalar(Math.max(rPx, 1));
      const lidW = e.halfW / Math.max(rPx, 1);
      const lidH = e.halfH / Math.max(rPx, 1);

      const u = eye.mat.uniforms;
      u.uRot.value = this.rot;
      u.uTomoeR.value = 0.56 * awaken;
      u.uMorph.value = morph;
      u.uAlpha.value = presence * Math.min(1, awaken * 3) * outro;
      u.uGlow.value = 1 + flare * 1.2;
      u.uLid.value.set(lidW, lidH * 1.12);
      u.uLidC.value.copy(_v);

      if (eye.veins) {
        eye.veins.position.copy(eye.pos);
        eye.veins.scale.setScalar(r * VEIN_QUAD);
        eye.veins.rotation.z = -f.roll;
        const vu = eye.veinMat.uniforms;
        vu.uAlpha.value = presence * smooth(span(t, act - 0.4, act + 0.4)) * outro;
        // Vein quad is in iris units of the *unscaled* iris.
        vu.uLid.value.set(lidW, lidH);
        vu.uLidC.value.copy(_v);
      }

      eye.glint.position.copy(eye.pos);
      eye.glint.scale.set(r * (3 + flare * 24), r * (1.2 + flare * 1.6), 1);
      eye.glint.material.rotation = -f.roll;
      eye.glint.material.opacity = presence * (0.15 * active + flare);

      st.setLight(i, e.x, e.y, e.r * 4, g.light, presence * (0.25 * active + 0.9 * flare));
    }

    st.desaturate = g.desat * active;
    st.tint.setRGB(lerp(1, g.tint[0], active), lerp(1, g.tint[1], active), lerp(1, g.tint[2], active));
    st.darken = g.darken * active;
    st.vignette = 0.2 + 0.5 * active;
    st.vignetteColor.setRGB(g.vignette[0] * active, g.vignette[1] * active, g.vignette[2] * active);
    st.aberration = 0.02 + 0.03 * active + flare * 0.2;
    st.bloom.strength = 0.8 + 0.4 * active + flare;
    if (flare > 0.05) {
      const c = g.light;
      st.flash.setRGB(c.r * 0.3 * flare, c.g * 0.3 * flare, c.b * 0.3 * flare);
      st.shake(0.01 * flare);
    }

    const mx = (f.eyes[0].x + f.eyes[1].x) / 2;
    const my = (f.eyes[0].y + f.eyes[1].y) / 2;
    if (this.waves) this._waves(t, act, extra * presence, mx, my, f.span);
    if (this.vortex) this._vortex(t, dt, extra, f, mx, my);
    if (this.moon) this._tsukuyomi(extra);
    if (this.flames) this._amaterasu(t, extra, f, mx, my);
  }

  // Rings rolling outward from between the eyes, one every ~1.2s.
  _waves(t, act, strength, mx, my, spanPx) {
    const st = this.stage;
    const period = 1.2;
    const local = Math.max(0, t - act);
    this.waves.forEach((w, i) => {
      const phase = (local / period - i / this.waves.length) % 1;
      const started = local / period >= i / this.waves.length;
      st.toWorld(mx, my, 0, w.mesh.position);
      w.mesh.scale.setScalar(st.toWorldSize(Math.max(spanPx, 40) * 10));
      w.progress = started && strength > 0.01 ? Math.max(0.001, phase) : 0;
      w.material.uniforms.uColor.value.setRGB(...this.spec.waveColor).multiplyScalar(0.35 * strength);
    });
  }

  // A spot on the roomier side of the frame, clear of the face.
  _besideFace(mx, my) {
    const st = this.stage;
    const side = mx < st.width / 2 ? 1 : -1;
    return {
      x: Math.min(st.width * 0.85, Math.max(st.width * 0.15, mx + side * st.width * 0.34)),
      y: Math.min(st.height * 0.75, my + st.height * 0.08),
    };
  }

  // Amaterasu: black flames ignite where Itachi looks, then spread along
  // the bottom of the frame; his eye bleeds from the strain.
  _amaterasu(t, strength, f, mx, my) {
    const st = this.stage;
    if (!this.burnAt && f.seen && strength > 0) this.burnAt = this._besideFace(mx, my);
    const at = this.burnAt ?? { x: st.width * 0.75, y: st.height * 0.6 };
    const D = this.spec.duration;
    const out = 1 - span(t, D - 0.6, D);
    const local = t - (this.activateAt + 0.2);
    const unit = st.toWorldSize(st.height * 0.16);
    for (const fl of this.flames) {
      const d = fl.userData;
      const grow = smooth(span(local - d.delay - (d.onTarget ? 0 : 0.9), 0, 0.6)) * out;
      const px = d.onTarget ? at.x + (d.slot - 0.5) * st.height * 0.22 : d.slot * st.width;
      const py = d.onTarget ? at.y + st.height * 0.1 : st.height * 1.02;
      st.toWorld(px, py, 0.1, fl.position);
      const h = unit * d.h * (d.onTarget ? 1.4 : 1) * (0.92 + 0.08 * Math.sin(t * 13 + d.slot * 40));
      fl.scale.set(Math.max(1e-4, h * 0.6 * grow), Math.max(1e-4, h * grow), 1);
      fl.material.uniforms.uTime.value = t;
      fl.material.uniforms.uAlpha.value = grow;
    }
    // Blood from the eye on the viewer's right.
    const e = f.eyes[1];
    const bleed = smooth(span(t, this.activateAt - 0.2, this.activateAt + 1.6)) * out * (f.seen ? f.presence : 0);
    st.toWorld(e.cx, e.cy + e.halfH * 0.8, 0.06, this.bleed.position);
    this.bleed.scale.set(Math.max(1e-4, st.toWorldSize(e.r * 0.55)), Math.max(1e-4, st.toWorldSize(f.span * 1.3)), 1);
    this.bleed.rotation.z = -f.roll;
    this.bleedMat.uniforms.uLen.value = bleed * 0.9;
    this.bleedMat.uniforms.uAlpha.value = Math.min(1, bleed * 4) * out;
    if (strength > 0) {
      st.setLight(1, at.x, at.y, st.height * 0.3, new THREE.Color(0.5, 0.1, 0.55), 0.4 * strength);
      st.darken = 0.4 * strength + this.spec.grade.darken * (1 - strength);
    }
  }

  // The vortex opens beside the player — never over the face, since its
  // warp would drag the real eyes away from the irises.
  _vortex(t, dt, strength, f, mx, my) {
    const st = this.stage;
    if (!this.vortexAt && f.seen && strength > 0) this.vortexAt = this._besideFace(mx, my);
    const at = this.vortexAt ?? { x: st.width * 0.75, y: st.height * 0.5 };
    const D = this.spec.duration;
    const collapse = span(t, D - 1.0, D - 0.4);
    const faceDist = Math.hypot(at.x - mx, at.y - my);
    const maxR = Math.max(0, faceDist - Math.max(f.span, 40) * 1.6);
    const R = Math.min(st.height * 0.32, maxR) * strength * (1 - collapse);
    st.setWarp(at.x, at.y, R * 1.25, 0.55 * strength, 9 * strength);
    st.toWorld(at.x, at.y, 0, this.vortex.position);
    this.vortex.scale.setScalar(Math.max(1e-4, st.toWorldSize(R)));
    this.vortexMat.uniforms.uTime.value = t;
    this.vortexMat.uniforms.uAlpha.value = strength * (1 - collapse);
    this.vortexGlow.position.copy(this.vortex.position);
    this.vortexGlow.scale.setScalar(st.toWorldSize(R * 2.6));
    this.vortexGlow.material.opacity = strength * (1 - collapse) * 0.6;
    if (collapse > 0 && collapse < 1) st.shake(0.006);
    const pop = t > D - 0.4 ? Math.exp(-(t - (D - 0.4)) * 8) : 0;
    if (pop > 0.02) st.flash.setRGB(0.25 * pop, 0.1 * pop, 0.35 * pop);
  }

  // Tsukuyomi: the world turns into a red-on-black negative under a red moon.
  _tsukuyomi(strength) {
    const st = this.stage;
    this.moon.material.opacity = strength;
    this.moonGlow.material.opacity = strength;
    if (strength <= 0) return;
    st.desaturate = lerp(this.spec.grade.desat, 1, strength);
    st.invert = strength;
    st.contrast = lerp(1, 2.2, strength);
    st.tint.setRGB(lerp(1.05, 1.0, strength), lerp(0.88, 0.12, strength), lerp(0.88, 0.1, strength));
    st.darken = lerp(0.3, 0.2, strength);
    st.vignette = 0.7 * strength + 0.2;
    st.vignetteColor.setRGB(0, 0, 0);
    st.toWorld(st.width * 0.82, st.height * 0.2, -0.5, this.moon.position);
    const mr = st.toWorldSize(st.height * 0.1);
    this.moon.scale.setScalar(mr);
    this.moonGlow.position.copy(this.moon.position);
    this.moonGlow.scale.setScalar(mr * 6);
  }

  dispose() {
    disposeTree(this.root);
  }
}

export function dojutsu(kind) {
  const spec = SPECS[kind];
  return class extends Dojutsu {
    static needs = ["face"];
    static duration = spec.duration;
    constructor(stage, opts) {
      super(stage, opts, spec);
    }
  };
}
