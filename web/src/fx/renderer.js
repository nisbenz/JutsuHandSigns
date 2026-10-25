import * as LAB from "./shaders/lab.js";
import * as EXTRA from "./shaders/extra.js";
import * as SIG from "./shaders/signature.js";

// WebGL2 cast-effect renderer, ported from fx-lab/main.js and generalised:
// any number of effect layers, each drawn once per anchor instance (so a
// "hands" layer appears on both hands), composited over the mirrored camera
// feed with bloom and a heat-shimmer warp.

const FX_SOURCES = {
  chidori: LAB.CHIDORI_FRAG_SRC,
  orb: LAB.ORB_FRAG_SRC,
  susanoo: LAB.SUSANOO_FRAG_SRC,
  clay: LAB.CLAY_FRAG_SRC,
  c4: LAB.C4_KARURA_FRAG_SRC,
  clone: LAB.CLAY_CLONE_FRAG_SRC,
  boulder: LAB.BOULDER_FRAG_SRC,
  wing: LAB.WING_FRAG_SRC,
  eyes: LAB.SHARINGAN_FRAG_SRC,
  steam: LAB.STEAM_FRAG_SRC,
  flame: EXTRA.FLAME_FRAG_SRC,
  aura: EXTRA.AURA_FRAG_SRC,
  wood: EXTRA.WOOD_FRAG_SRC,
  water: EXTRA.WATER_FRAG_SRC,
  paper: EXTRA.PAPER_FRAG_SRC,
  shadow: EXTRA.SHADOW_FRAG_SRC,
  smoke: EXTRA.SMOKE_FRAG_SRC,
  vortex: EXTRA.VORTEX_FRAG_SRC,
  genjutsu: EXTRA.GENJUTSU_FRAG_SRC,
  shock: EXTRA.SHOCK_FRAG_SRC,
  tornado: EXTRA.TORNADO_FRAG_SRC,
  threads: EXTRA.THREADS_FRAG_SRC,
  snakes: EXTRA.SNAKES_FRAG_SRC,
  facemark: EXTRA.FACEMARK_FRAG_SRC,
  copy: SIG.CLONE_FRAG_SRC,
  mind: SIG.MIND_FRAG_SRC,
  sword: SIG.SWORD_FRAG_SRC,
  summon: SIG.SUMMON_FRAG_SRC,
};

// Wraps a fragment shader's main() so every effect can be recolored, which
// is how the FX-lab shaders (baked palettes) get reused for other jutsu.
function withTint(src) {
  const renamed = src.replace(/void\s+main\s*\(\s*\)/, "void fxMain()");
  return `${renamed}
uniform vec3 uTint;
uniform float uTintMix;
uniform float uGain;
uniform vec4 uFaceGuard; // face ellipse: centre px, radii px
uniform float uFaceGuardAmt;
void main() {
  fxMain();
  fragColor.rgb *= uGain;
  if (uTintMix > 0.0) {
    float l = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(fragColor.rgb, uTint * l * 1.7, uTintMix);
  }
  // Fade glow (alpha ~0) and haze over the face; solid parts are untouched.
  // Premultiplied, so scaling rgb and alpha together lets the face through
  // instead of leaving a dark patch.
  if (uFaceGuardAmt > 0.0) {
    vec2 q = (gl_FragCoord.xy - uFaceGuard.xy) / max(uFaceGuard.zw, vec2(1.0));
    float m = 1.0 - smoothstep(0.55, 1.0, length(q));
    fragColor *= 1.0 - m * uFaceGuardAmt * (1.0 - fragColor.a);
  }
}
`;
}

const COMPOSITE_SRC = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uVideo;
uniform float uBloomStrength;
uniform vec2 uCanvasSize;
uniform vec2 uVideoOffset;
uniform vec2 uVideoExtent;
uniform vec4 uWarp[2]; // x, y (GL px), scale px, strength
uniform float uTime;
uniform float uFlash;
in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x)
       + (hash(i + vec2(0.0, 1.0)) - hash(i)) * u.y * (1.0 - u.x)
       + (hash(i + vec2(1.0, 1.0)) - hash(i + vec2(1.0, 0.0))) * u.x * u.y;
}
vec3 sampleVideo(vec2 fragPx) {
  vec2 topOrigin = vec2(fragPx.x, uCanvasSize.y - fragPx.y);
  vec2 frac = (topOrigin - uVideoOffset) / uVideoExtent;
  vec2 uv = vec2(1.0 - frac.x, 1.0 - frac.y);
  return texture(uVideo, clamp(uv, 0.0, 1.0)).rgb;
}
void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 warpPx = vec2(0.0);
  float ab = 0.0;
  float darken = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 w = uWarp[i];
    if (w.w <= 0.0) continue;
    vec2 p = (fragPx - w.xy) / max(w.z, 1.0);
    float d2 = dot(p, p);
    float fall = exp(-d2 * 0.9) * w.w;
    float n1 = noise(p * 2.2 + uTime * 1.6) - 0.5;
    float n2 = noise(p * 2.2 + 11.0 - uTime * 1.3) - 0.5;
    warpPx += vec2(n1, n2) * fall * 10.0 * (w.z / 90.0);
    ab += fall * 2.5;
    darken = max(darken, exp(-d2 * 3.0) * w.w);
  }
  vec3 video;
  video.r = sampleVideo(fragPx + warpPx + vec2(ab, 0.0)).r;
  video.g = sampleVideo(fragPx + warpPx).g;
  video.b = sampleVideo(fragPx + warpPx - vec2(ab, 0.0)).b;
  video *= mix(1.0, 0.55, darken);

  vec4 scene = texture(uScene, vUv);
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 color = video * (1.0 - scene.a) + scene.rgb + bloom * uBloomStrength;
  color += vec3(uFlash);
  fragColor = vec4(color, 1.0);
}
`;

// Bloom only what glows: solid effect pixels (alpha = occlusion) like the
// Expansion fist, wood or the Sharingan iris would otherwise smear to white.
const BRIGHT_SRC = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 c = texture(uScene, vUv);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(uThreshold, uThreshold + 0.3, l) * (1.0 - 0.9 * c.a);
  fragColor = vec4(c.rgb * k, 1.0);
}
`;

const BLOOM_SCALE = 0.5;
const BLOOM_ITERATIONS = 3;
const BLOOM_THRESHOLD = 0.45;
const BLOOM_STRENGTH = 1.3;
const FIST_SCALE = 0.85;
// How much body-anchored glow is dimmed over the face (see withTint).
const FACE_GUARD = 0.75;
const BODY_ANCHORS = ["torso", "back", "ground"];

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class FxRenderer {
  constructor(canvas, source) {
    this.canvas = canvas;
    this.source = source; // <video> or <canvas>
    const gl = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.programs = {};
    this.uniformCache = new Map();
    this.smooth = { hands: {}, face: null, body: null };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.videoTex = this.createTexture();
    this.brightProgram = this.build(LAB.VERT_UV_SRC, BRIGHT_SRC);
    this.blurProgram = this.build(LAB.VERT_UV_SRC, LAB.BLUR_FRAG_SRC);
    this.compositeProgram = this.build(LAB.VERT_UV_SRC, COMPOSITE_SRC);
    this.fbos = null;
    this.size = [0, 0];
  }

  // --- GL plumbing ----------------------------------------------------------
  compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("shader compile failed: " + log);
    }
    return sh;
  }

  build(vertSrc, fragSrc, mesh = false) {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fragSrc));
    if (mesh) {
      gl.bindAttribLocation(prog, 0, "aPosition");
      gl.bindAttribLocation(prog, 1, "aNormal");
      gl.bindAttribLocation(prog, 2, "aUv");
      gl.bindAttribLocation(prog, 3, "aBandageMask");
    } else {
      gl.bindAttribLocation(prog, 0, "aPos");
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("program link failed: " + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  program(fx) {
    if (!this.programs[fx]) {
      this.programs[fx] = this.build(LAB.VERT_SRC, withTint(FX_SOURCES[fx]));
    }
    return this.programs[fx];
  }

  u(prog, name) {
    let m = this.uniformCache.get(prog);
    if (!m) {
      m = {};
      this.uniformCache.set(prog, m);
    }
    if (!(name in m)) m[name] = this.gl.getUniformLocation(prog, name);
    return m[name];
  }

  set(prog, name, ...vals) {
    const loc = this.u(prog, name);
    if (loc === null) return;
    const gl = this.gl;
    if (vals.length === 1) gl.uniform1f(loc, vals[0]);
    else if (vals.length === 2) gl.uniform2f(loc, vals[0], vals[1]);
    else if (vals.length === 3) gl.uniform3f(loc, vals[0], vals[1], vals[2]);
    else gl.uniform4f(loc, vals[0], vals[1], vals[2], vals[3]);
  }

  createTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  createFBO(w, h, withDepth) {
    const gl = this.gl;
    const tex = this.createTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (withDepth) {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (w === this.size[0] && h === this.size[1] && this.fbos) return;
    this.size = [w, h];
    this.canvas.width = w;
    this.canvas.height = h;
    const bw = Math.max(1, Math.round(w * BLOOM_SCALE));
    const bh = Math.max(1, Math.round(h * BLOOM_SCALE));
    this.fbos = {
      scene: this.createFBO(w, h, true),
      a: this.createFBO(bw, bh),
      b: this.createFBO(bw, bh),
    };
  }

  drawQuad() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- Coordinate mapping ---------------------------------------------------
  sourceSize() {
    const s = this.source;
    return [s.videoWidth || s.width || this.size[0], s.videoHeight || s.height || this.size[1]];
  }

  cover() {
    const [cw, ch] = this.size;
    const [vw, vh] = this.sourceSize();
    const scale = Math.max(cw / vw, ch / vh);
    return { cw, ch, extentX: vw * scale, extentY: vh * scale, offX: (cw - vw * scale) / 2, offY: (ch - vh * scale) / 2 };
  }

  // Normalized landmark -> GL px (mirrored selfie view, bottom-left origin).
  toPx(nx, ny) {
    const c = this.cover();
    return { x: c.offX + (1 - nx) * c.extentX, y: c.ch - (c.offY + ny * c.extentY) };
  }

  // --- Anchors from tracking --------------------------------------------------
  updateAnchors(track) {
    const S = this.smooth;
    const now = performance.now();
    const [w, h] = this.size;
    const minDim = Math.min(w, h);

    // Hands are matched to the ones already being tracked by position, not
    // by MediaPipe's Left/Right label: the label flips now and then, which
    // made effects jump between hands or fade out and back in.
    const targets = track.hands.map(({ lm }) => {
      const palmN = { x: (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4, y: (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4 };
      const palm = this.toPx(palmN.x, palmN.y);
      const wrist = this.toPx(lm[0].x, lm[0].y);
      const tip = this.toPx(lm[12].x, lm[12].y);
      // Clamped so a hand right up against the lens doesn't blow effects
      // up past the frame, and a far-away hand still shows something.
      const scale = clamp(Math.hypot(tip.x - wrist.x, tip.y - wrist.y) * 1.6, minDim * 0.12, minDim * 0.4);
      let dx = palm.x - wrist.x;
      let dy = palm.y - wrist.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const fingers = [4, 8, 12, 16, 20].map((i) => this.toPx(lm[i].x, lm[i].y));
      return { x: palm.x, y: palm.y, scale, dirX: dx, dirY: dy, wristX: wrist.x, wristY: wrist.y, fingers };
    });
    const tracked = S.hands;
    const free = new Set(Object.keys(tracked));
    for (const target of targets) {
      let bestId = null;
      let bestD = Infinity;
      for (const id of free) {
        const d = Math.hypot(tracked[id].x - target.x, tracked[id].y - target.y);
        if (d < bestD) {
          bestD = d;
          bestId = id;
        }
      }
      if (bestId !== null && bestD < minDim * 0.35) {
        free.delete(bestId);
        const cur = tracked[bestId];
        cur.x = lerp(cur.x, target.x, 0.5);
        cur.y = lerp(cur.y, target.y, 0.5);
        cur.scale = lerp(cur.scale, target.scale, 0.25);
        cur.dirX = lerp(cur.dirX, target.dirX, 0.3);
        cur.dirY = lerp(cur.dirY, target.dirY, 0.3);
        cur.wristX = lerp(cur.wristX, target.wristX, 0.5);
        cur.wristY = lerp(cur.wristY, target.wristY, 0.5);
        cur.fingers = target.fingers;
        cur.lastSeen = now;
      } else {
        const id = String((this.nextHandId = (this.nextHandId || 0) + 1));
        tracked[id] = { ...target, active: 0, lastSeen: now };
      }
    }
    for (const [id, hand] of Object.entries(tracked)) {
      // Short grace period: a few dropped tracking frames shouldn't make
      // the effect flicker out.
      const present = now - hand.lastSeen < 300;
      hand.active = lerp(hand.active, present ? 1 : 0, present ? 0.25 : 0.15);
      if (!present && hand.active < 0.01) {
        delete tracked[id];
        if (this.primaryHand === id) this.primaryHand = null;
      }
    }

    if (track.face) {
      const lm = track.face;
      const eye = (iris, a, b, top, bot) => {
        const c = this.toPx(lm[iris].x, lm[iris].y);
        const pa = this.toPx(lm[a].x, lm[a].y);
        const pb = this.toPx(lm[b].x, lm[b].y);
        const pt = this.toPx(lm[top].x, lm[top].y);
        const pbt = this.toPx(lm[bot].x, lm[bot].y);
        const w = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        return { x: c.x, y: c.y, w, r: Math.max(6, w * 0.28), halfW: w / 2, halfH: Math.hypot(pt.x - pbt.x, pt.y - pbt.y) / 2 };
      };
      const l = eye(468, 362, 263, 386, 374);
      const r = eye(473, 33, 133, 159, 145);
      const fh = this.toPx(lm[151].x, lm[151].y);
      const mid = this.toPx(lm[168].x, lm[168].y);
      const sideA = this.toPx(lm[234].x, lm[234].y);
      const sideB = this.toPx(lm[454].x, lm[454].y);
      const width = Math.hypot(sideA.x - sideB.x, sideA.y - sideB.y);
      const target = { l, r, fh, mid, width };
      if (!S.face) S.face = { ...structuredClone(target), active: 0 };
      const f = S.face;
      for (const k of ["l", "r"]) {
        for (const key of ["x", "y"]) f[k][key] = lerp(f[k][key], target[k][key], 0.45);
        for (const key of ["w", "r", "halfW"]) f[k][key] = lerp(f[k][key], target[k][key], 0.3);
        f[k].halfH = lerp(f[k].halfH, target[k].halfH, 0.5);
      }
      for (const k of ["fh", "mid"]) {
        f[k].x = lerp(f[k].x, target[k].x, 0.45);
        f[k].y = lerp(f[k].y, target[k].y, 0.45);
      }
      f.width = lerp(f.width, target.width, 0.3);
      f.active = lerp(f.active, 1, 0.2);
    } else if (S.face) {
      S.face.active = lerp(S.face.active, 0, 0.1);
    }

    if (track.pose) {
      const lm = track.pose;
      const ls = this.toPx(lm[11].x, lm[11].y);
      const rs = this.toPx(lm[12].x, lm[12].y);
      const span = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      const sx = (ls.x + rs.x) / 2;
      const sy = (ls.y + rs.y) / 2;
      // Webcam users are usually seated and cropped at the chest, so the
      // hips are rarely trustworthy: torso sits a bit below the shoulders.
      const hipsOk = (lm[23].visibility ?? 0) > 0.6 && (lm[24].visibility ?? 0) > 0.6;
      let tx = sx;
      let ty = sy - span * 0.55;
      if (hipsOk) {
        const lh = this.toPx(lm[23].x, lm[23].y);
        const rh = this.toPx(lm[24].x, lm[24].y);
        tx = (sx + (lh.x + rh.x) / 2) / 2;
        ty = (sy + (lh.y + rh.y) / 2) / 2;
      }
      // Seated close to the camera the shoulders can span the whole frame
      // (or leave it); keep body effects sized and placed on screen.
      const target = {
        tx: clamp(tx, w * 0.1, w * 0.9),
        ty: clamp(ty, h * 0.12, h * 0.85),
        bx: clamp(sx, w * 0.1, w * 0.9),
        // Wings root at the shoulder line, not the neck, so they don't glow
        // over the face.
        by: clamp(sy - span * 0.1, h * 0.2, h * 0.92),
        scale: clamp(span * 1.8, minDim * 0.35, minDim * 0.75),
      };
      if (!S.body) S.body = { ...target, active: 0 };
      const b = S.body;
      for (const k of ["tx", "ty", "bx", "by"]) b[k] = lerp(b[k], target[k], 0.3);
      b.scale = lerp(b.scale, target.scale, 0.15);
      b.active = lerp(b.active, 1, 0.15);
    } else if (S.body) {
      S.body.active = lerp(S.body.active, 0, 0.1);
    }
  }

  // Resolve a layer's anchor into draw instances. Anchors that need a hand,
  // a body or a face return nothing until that is actually tracked - an
  // effect floating in mid-air with no hand under it looks broken.
  instances(layer) {
    const [w, h] = this.size;
    const S = this.smooth;
    const scaleMul = layer.scale ?? 1;
    const hands = Object.entries(S.hands)
      .filter(([, x]) => x.active > 0.02)
      .map(([id, x]) => ({ ...x, id }));
    const face = S.face && S.face.active > 0.05 ? S.face : null;
    const body = S.body && S.body.active > 0.05 ? S.body : null;

    // Body point, falling back to "below the face" when pose is lost.
    const bodyPoint = (which) => {
      if (body) {
        return which === "back"
          ? { x: body.bx, y: body.by, scale: body.scale, active: body.active }
          : { x: body.tx, y: body.ty, scale: body.scale, active: body.active };
      }
      if (face) {
        const minDim = Math.min(w, h);
        const s = clamp(face.width * 2.4, minDim * 0.35, minDim * 0.75);
        const y = face.mid.y - face.width * (which === "back" ? 1.6 : 2.0);
        return { x: face.mid.x, y: clamp(y, h * 0.12, h * 0.85), scale: s, active: face.active };
      }
      return null;
    };

    let out = [];
    switch (layer.anchor) {
      case "hands":
        out = hands;
        break;
      case "hand": {
        // Sticky: stay on the same hand unless it's gone or the other one is
        // clearly more prominent, instead of hopping every frame.
        const score = (x) => x.active * x.scale;
        let pick = hands.find((x) => x.id === this.primaryHand);
        const best = hands.slice().sort((a, b) => score(b) - score(a))[0];
        if (!pick || (best && best.id !== pick.id && score(best) > score(pick) * 1.4)) pick = best;
        this.primaryHand = pick ? pick.id : null;
        out = pick ? [pick] : [];
        break;
      }
      case "between": {
        if (hands.length >= 2) {
          const [a, b] = hands;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          out = [{
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            scale: clamp(dist * 0.6, (a.scale + b.scale) / 2, Math.min(w, h) * 0.5),
            dirX: 0,
            dirY: 1,
            active: Math.min(a.active, b.active),
          }];
        } else {
          out = hands.slice(0, 1);
        }
        break;
      }
      case "torso":
      case "back": {
        const bp = bodyPoint(layer.anchor);
        out = bp ? [bp] : [];
        break;
      }
      case "ground": {
        const bp = bodyPoint("torso");
        out = bp ? [{ x: bp.x, y: h * 0.03, scale: bp.scale, active: bp.active }] : [];
        break;
      }
      case "face":
      case "eyes":
        out = face ? [{ x: face.mid.x, y: face.mid.y, scale: face.width, active: face.active, face }] : [];
        break;
      default:
        out = [{ x: w / 2, y: h / 2, scale: Math.min(w, h) * 0.5, active: 1 }];
    }
    return out.map((inst) => {
      const off = layer.offset || [0, 0];
      const s = inst.scale * scaleMul;
      const dir = layer.dir || [inst.dirX ?? 0, inst.dirY ?? 1];
      return { ...inst, x: inst.x + off[0] * s, y: inst.y + off[1] * s, scale: s, dirX: dir[0], dirY: dir[1] };
    });
  }

  // What the current spec is waiting on (for the "raise your hand" hint).
  missing(spec) {
    const need = new Set();
    for (const layer of spec.layers) {
      if (this.instances(layer).length) continue;
      if (["hands", "hand", "between"].includes(layer.anchor) || layer.fx === "threads") need.add("hands");
      else if (BODY_ANCHORS.includes(layer.anchor)) need.add("body");
      else if (["face", "eyes"].includes(layer.anchor)) need.add("face");
    }
    // Chakra threads are screen-anchored but hang off the fingertips.
    if (spec.layers.some((l) => l.fx === "threads") && !Object.keys(this.smooth.hands).length) need.add("hands");
    return need;
  }

  // --- Mesh (Partial Expansion) ----------------------------------------------
  ensureFist() {
    if (this.fist) return this.fist;
    const gl = this.gl;
    const mesh = buildFistMesh();
    const program = this.build(LAB.FIST_VERT_SRC, LAB.FIST_FRAG_SRC, true);
    const outline = this.build(LAB.FIST_VERT_SRC, LAB.OUTLINE_FRAG_SRC, true);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attrib = (loc, data, size) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attrib(0, mesh.positions, 3);
    attrib(1, mesh.normals, 3);
    attrib(2, mesh.uvs, 2);
    attrib(3, mesh.bandageMask, 1);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.fist = { program, outline, vao, count: mesh.indices.length };
    return this.fist;
  }

  drawFist(inst, t) {
    const gl = this.gl;
    const fist = this.ensureFist();
    const angle = Math.atan2(inst.dirY, inst.dirX);
    const breathe = 0.85 + 0.15 * (0.65 + 0.35 * Math.sin((t * 2 * Math.PI) / 1.8));
    const scalePx = inst.scale * FIST_SCALE * breathe;
    const wx = inst.wristX ?? inst.x - inst.dirX * inst.scale * 0.4;
    const wy = inst.wristY ?? inst.y - inst.dirY * inst.scale * 0.4;
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(fist.vao);
    for (const [prog, inflate, face] of [[fist.outline, 0.05, gl.FRONT], [fist.program, 0.0, gl.BACK]]) {
      gl.cullFace(face);
      gl.useProgram(prog);
      this.set(prog, "uAnchorPx", wx, wy);
      this.set(prog, "uAngle", angle);
      this.set(prog, "uScalePx", scalePx);
      this.set(prog, "uCanvasSize", this.size[0], this.size[1]);
      this.set(prog, "uZRange", Math.max(this.size[0], this.size[1]));
      this.set(prog, "uActive", inst.active);
      this.set(prog, "uInflate", inflate);
      gl.drawElements(gl.TRIANGLES, fist.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // Steam rising off the enlarged limb.
    this.enableLayerBlend();
    const steam = this.program("steam");
    gl.useProgram(steam);
    this.set(steam, "uTime", t);
    this.set(steam, "uHandPos", wx + Math.cos(angle) * scalePx * 1.6, wy + Math.sin(angle) * scalePx * 1.6);
    this.set(steam, "uHandScale", scalePx);
    this.set(steam, "uActive", inst.active);
    this.set(steam, "uTintMix", 0);
    this.set(steam, "uGain", 1);
    this.set(steam, "uFaceGuardAmt", 0);
    this.drawQuad();
  }

  enableLayerBlend() {
    const gl = this.gl;
    // Premultiplied "over": glow (alpha 0) adds, occluders cover what's below.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  // --- Frame ----------------------------------------------------------------
  render(spec, track, t) {
    const gl = this.gl;
    this.resize();
    this.updateAnchors(track);
    const [w, h] = this.size;
    const cp = this.cover();

    const src = this.source;
    const ready = src.tagName === "VIDEO" ? src.readyState >= 2 : true;
    if (ready) {
      gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }

    // 1. Effect layers -> scene FBO.
    const F = this.fbos;
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const warps = [];
    spec.layers.forEach((layer, li) => {
      const insts = this.instances(layer);
      insts.forEach((inst, ii) => {
        if (inst.active < 0.01) return;
        if (layer.warp && warps.length < 2) warps.push([inst.x, inst.y, inst.scale, layer.warp * inst.active]);
        if (layer.fx === "threads" && !Object.values(this.smooth.hands).some((x) => x.active > 0.3)) return;
        if (layer.fx === "expansion") {
          this.drawFist(inst, t);
          return;
        }
        this.enableLayerBlend();
        const prog = this.program(layer.fx);
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
        this.setLayerUniforms(prog, layer, inst, t, cp, li * 7 + ii * 17.3);
        this.drawQuad();
      });
    });
    gl.disable(gl.BLEND);

    // 2-3. Bloom: bright pass + ping-pong blur at half res.
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.a.fbo);
    gl.viewport(0, 0, F.a.w, F.a.h);
    gl.useProgram(this.brightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, F.scene.tex);
    this.set(this.brightProgram, "uThreshold", BLOOM_THRESHOLD);
    gl.uniform1i(this.u(this.brightProgram, "uScene"), 0);
    this.drawQuad();
    let s = F.a;
    let d = F.b;
    gl.useProgram(this.blurProgram);
    gl.uniform1i(this.u(this.blurProgram, "uTex"), 0);
    for (let i = 0; i < BLOOM_ITERATIONS * 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
      gl.viewport(0, 0, d.w, d.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      if (i % 2 === 0) this.set(this.blurProgram, "uTexelStep", 1 / s.w, 0);
      else this.set(this.blurProgram, "uTexelStep", 0, 1 / s.h);
      this.drawQuad();
      [s, d] = [d, s];
    }

    // 4. Composite over the mirrored camera feed.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const cprog = this.compositeProgram;
    gl.useProgram(cprog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, F.scene.tex);
    gl.uniform1i(this.u(cprog, "uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.uniform1i(this.u(cprog, "uBloom"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.uniform1i(this.u(cprog, "uVideo"), 2);
    this.set(cprog, "uBloomStrength", spec.bloom ?? BLOOM_STRENGTH);
    this.set(cprog, "uCanvasSize", w, h);
    this.set(cprog, "uVideoOffset", cp.offX, cp.offY);
    this.set(cprog, "uVideoExtent", cp.extentX, cp.extentY);
    this.set(cprog, "uTime", t);
    this.set(cprog, "uFlash", Math.max(0, 0.55 * (1 - t / 0.35)));
    const warpArr = new Float32Array(8);
    warps.forEach((wp, i) => warpArr.set(wp, i * 4));
    gl.uniform4fv(this.u(cprog, "uWarp[0]") ?? this.u(cprog, "uWarp"), warpArr);
    gl.activeTexture(gl.TEXTURE0);
    this.drawQuad();
  }

  setLayerUniforms(prog, layer, inst, t, cp, seed) {
    const gl = this.gl;
    const [w, h] = this.size;
    this.set(prog, "uResolution", w, h);
    this.set(prog, "uTime", t);
    this.set(prog, "uHandPos", inst.x, inst.y);
    this.set(prog, "uHandScale", inst.scale);
    this.set(prog, "uActive", inst.active);
    this.set(prog, "uDir", inst.dirX, inst.dirY);
    const colA = layer.colA || [1, 1, 1];
    const colB = layer.colB || [1, 1, 1];
    this.set(prog, "uColA", ...colA);
    this.set(prog, "uColB", ...colB);
    this.set(prog, "uVariant", layer.variant ?? 0);
    this.set(prog, "uSeed", seed);
    this.set(prog, "uTint", ...(layer.tint || [1, 1, 1]));
    this.set(prog, "uTintMix", layer.tintMix ?? 0);
    this.set(prog, "uGain", layer.gain ?? 1);
    // Body glows (auras, wings, Susanoo, steam) are big enough to sit over
    // the head and wash the face out; effects aimed at the face opt out.
    const guard = layer.faceGuard ?? (BODY_ANCHORS.includes(layer.anchor) ? FACE_GUARD : 0);
    const sf = this.smooth.face;
    if (guard > 0 && sf && sf.active > 0.05) {
      // face.mid is the bridge of the nose; the face extends more below it.
      this.set(prog, "uFaceGuard", sf.mid.x, sf.mid.y - sf.width * 0.15, sf.width * 0.62, sf.width * 0.9);
      this.set(prog, "uFaceGuardAmt", guard * sf.active);
    } else {
      this.set(prog, "uFaceGuardAmt", 0);
    }
    const vt = this.u(prog, "uVideoTex");
    if (vt !== null) gl.uniform1i(vt, 0);
    this.set(prog, "uCanvasSize", w, h);
    this.set(prog, "uVideoOffset", cp.offX, cp.offY);
    this.set(prog, "uVideoExtent", cp.extentX, cp.extentY);

    if (layer.fx === "threads") {
      const arr = new Float32Array(30);
      let n = 0;
      const hands = Object.values(this.smooth.hands).filter((x) => x.active > 0.3);
      for (const hnd of hands) {
        const k = hnd.active;
        for (const f of hnd.fingers) {
          if (n >= 10) break;
          arr.set([f.x, f.y, k > 0.5 ? 1 : 0], n * 3);
          n++;
        }
      }
      gl.uniform3fv(this.u(prog, "uFingers[0]") ?? this.u(prog, "uFingers"), arr);
    }

    const face = inst.face || this.smooth.face;
    if (layer.fx === "facemark" && face) {
      this.set(prog, "uEyeL", face.l.x, face.l.y, face.l.w);
      this.set(prog, "uEyeR", face.r.x, face.r.y, face.r.w);
      this.set(prog, "uForehead", face.fh.x, face.fh.y, face.width);
    }
    if (layer.fx === "eyes") {
      const f = face || { l: { x: 0, y: 0, r: 1, halfW: 1, halfH: 1 }, r: { x: 0, y: 0, r: 1, halfW: 1, halfH: 1 } };
      this.set(prog, "uLeftEyePos", f.l.x, f.l.y);
      this.set(prog, "uLeftEyeR", f.l.r);
      this.set(prog, "uLeftHalfW", f.l.halfW);
      this.set(prog, "uLeftHalfH", f.l.halfH);
      this.set(prog, "uRightEyePos", f.r.x, f.r.y);
      this.set(prog, "uRightEyeR", f.r.r);
      this.set(prog, "uRightHalfW", f.r.halfW);
      this.set(prog, "uRightHalfH", f.r.halfH);
      // Ignite ramps in over the first ~1.5s of the cast.
      this.set(prog, "uIgnite", Math.min(1, t / 1.5));
    }
  }

  dispose() {
    // The context belongs to the canvas and is reused if the component
    // remounts on it (React StrictMode does this), so just drop programs.
    for (const prog of Object.values(this.programs)) this.gl.deleteProgram(prog);
    this.programs = {};
  }
}

// Procedural low-poly fist/forearm mesh (same geometry as fx-lab).
function buildFistMesh() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const bandageMask = [];
  const indices = [];
  const add = (x, y, z, nx, ny, nz, u, v, m) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    bandageMask.push(m);
    return positions.length / 3 - 1;
  };
  const RADIAL = 12;
  const LEN = 8;
  const FOREARM_LEN = 1.5;
  const rings = [];
  for (let j = 0; j <= LEN; j++) {
    const tt = j / LEN;
    const r = 0.38 + (0.55 - 0.38) * Math.pow(tt, 0.7);
    const row = [];
    for (let i = 0; i <= RADIAL; i++) {
      const th = (i / RADIAL) * Math.PI * 2;
      row.push(add(tt * FOREARM_LEN, Math.cos(th) * r, Math.sin(th) * r, 0, Math.cos(th), Math.sin(th), i / RADIAL, tt, 1));
    }
    rings.push(row);
  }
  for (let j = 0; j < LEN; j++) {
    for (let i = 0; i < RADIAL; i++) {
      const a = rings[j][i], b = rings[j][i + 1], c = rings[j + 1][i], d = rings[j + 1][i + 1];
      indices.push(a, c, b, b, c, d);
    }
  }
  const CX = FOREARM_LEN + 0.55;
  const R = 0.95;
  const LAT = 10;
  const LON = 14;
  const rows = [];
  for (let la = 0; la <= LAT; la++) {
    const v = la / LAT;
    const phi = v * Math.PI;
    const row = [];
    for (let lo = 0; lo <= LON; lo++) {
      const u = lo / LON;
      const th = u * Math.PI * 2;
      const sx = -Math.cos(phi);
      const rr = Math.sin(phi);
      const sy = Math.cos(th) * rr;
      const sz = Math.sin(th) * rr;
      row.push(add(CX + sx * R * 1.15, sy * R, sz * R, sx, sy, sz, u, v, 0));
    }
    rows.push(row);
  }
  for (let la = 0; la < LAT; la++) {
    for (let lo = 0; lo < LON; lo++) {
      const a = rows[la][lo], b = rows[la][lo + 1], c = rows[la + 1][lo], d = rows[la + 1][lo + 1];
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    bandageMask: new Float32Array(bandageMask),
    indices: new Uint16Array(indices),
  };
}
