// Effect families added on top of the FX-lab shaders (lab.js). Every shader
// here is a fullscreen-triangle pass that follows the same contract as the
// lab: rgb is premultiplied glow added over the video, alpha is occlusion
// (0 = pure glow, 1 = this pixel hides the video). Each family is
// parameterised by uColA/uColB/uVariant so one shader covers many jutsu.

export const PRELUDE = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;      // seconds since the jutsu was cast
uniform vec2 uHandPos;    // anchor, GL px (bottom-left origin)
uniform float uHandScale; // anchor size, px
uniform float uActive;
uniform vec2 uDir;        // unit direction (e.g. wrist -> palm), GL space
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uVariant;
uniform float uSeed;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// Local anchor space: 1 unit == uHandScale px.
vec2 localP() { return (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0); }
// Same, rotated so +x runs along uDir.
vec2 dirP(vec2 p) {
  vec2 d = normalize(uDir + vec2(1e-5, 0.0));
  return vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
}
`;

export const VIDEO = `
uniform sampler2D uVideoTex;
uniform vec2 uCanvasSize;
uniform vec2 uVideoOffset;
uniform vec2 uVideoExtent;
vec3 sampleVideo(vec2 fragPx) {
  vec2 topOrigin = vec2(fragPx.x, uCanvasSize.y - fragPx.y);
  vec2 frac = (topOrigin - uVideoOffset) / uVideoExtent;
  vec2 uv = vec2(1.0 - frac.x, 1.0 - frac.y);
  return texture(uVideoTex, clamp(uv, 0.0, 1.0)).rgb;
}
`;

// --- Flames ---------------------------------------------------------------
// 0: hand/body ablaze (fire rising off the anchor)   1: breath jet along uDir
// colA = outer flame, colB = core. Dark palettes (Amaterasu) occlude
// instead of glowing, since black can't be added on top of the video.
export const FLAME_FRAG_SRC = PRELUDE + `
void main() {
  vec2 p = localP();
  float t = uTime;
  float dark = 1.0 - smoothstep(0.08, 0.35, max(uColA.r, max(uColA.g, uColA.b)));
  float shape;
  float n;
  if (uVariant < 0.5) {
    vec2 q = p + vec2(0.0, 0.35);
    float width = mix(0.75, 0.15, clamp(q.y / 2.4, 0.0, 1.0));
    n = fbm(vec2(q.x * 2.6, q.y * 1.8 - t * 3.6) + uSeed);
    float body = exp(-q.x * q.x / (width * width)) * smoothstep(-0.55, 0.0, q.y) * smoothstep(2.6, 0.4, q.y);
    shape = body * 1.5 - n * (0.55 + q.y * 0.35);
  } else {
    vec2 q = dirP(p);
    float grow = min(1.0, t * 0.9) * 7.0;
    float width = 0.25 + max(q.x, 0.0) * 0.32;
    n = fbm(vec2(q.x * 1.6 - t * 6.0, q.y * 2.4 / width) + uSeed);
    float body = exp(-q.y * q.y / (width * width)) * smoothstep(-0.2, 0.3, q.x) * smoothstep(grow, grow - 1.6, q.x);
    shape = body * 1.6 - n * 0.75;
  }
  shape = clamp(shape, 0.0, 1.0);
  float core = smoothstep(0.45, 0.95, shape);
  vec3 col = mix(uColA, uColB, core) * (0.6 + shape * 1.6);
  float flicker = 0.9 + 0.1 * noise(vec2(t * 18.0, uSeed));
  float a = smoothstep(0.02, 0.35, shape) * uActive;
  if (dark > 0.5) {
    // Black flame: occlude with near-black, rim lit with colB.
    float rim = smoothstep(0.05, 0.25, shape) * (1.0 - smoothstep(0.25, 0.6, shape));
    fragColor = vec4(uColA * a + uColB * rim * 0.9 * uActive, a * 0.92);
  } else {
    fragColor = vec4(col * a * flicker, a * 0.25);
  }
}
`;

// --- Aura / cloak -----------------------------------------------------------
// 0: flame cloak (Sage Mode, Eight Gates, Gentle Fist...)  1: lightning armor
// 2: soft healing glow with rising motes  3: chakra blade along uDir
export const AURA_FRAG_SRC = PRELUDE + `
float stepT(float t, float r) { return floor(t * r) / r; }
void main() {
  vec2 p = localP();
  float t = uTime;
  float ramp = smoothstep(0.0, 0.8, t);
  if (uVariant > 2.5) {
    vec2 q = dirP(p) - vec2(0.55, 0.0);
    float len = 1.5 * ramp;
    float s = clamp(q.x / max(len, 0.01), 0.0, 1.0);
    float w = mix(0.13, 0.015, s);
    float d = abs(q.y) - w;
    float edge = (q.x < 0.0 || q.x > len) ? 1e3 : d;
    float blade = exp(-max(edge, 0.0) * 30.0) * step(-0.05, q.x);
    float glow = exp(-max(edge, 0.0) * 6.0) * 0.5 * step(-0.1, q.x) * step(q.x, len + 0.2);
    float hum = 0.85 + 0.15 * sin(t * 40.0 + q.x * 12.0);
    vec3 col = mix(uColA, vec3(1.0), smoothstep(0.4, 1.0, blade)) * (blade * 1.8 + glow) * hum;
    fragColor = vec4(col * uActive, 0.0);
    return;
  }
  vec2 e = p * vec2(1.0, 0.62);
  float d = length(e);
  float ang = atan(e.y, e.x);
  if (uVariant > 1.5) {
    float glow = exp(-d * d * 1.6) * 0.8;
    float motes = 0.0;
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      float life = fract(t * 0.45 + hash1(fi * 7.1));
      vec2 mp = vec2((hash1(fi * 3.3) - 0.5) * 1.6, -0.6 + life * 2.2);
      motes += exp(-dot(p - mp, p - mp) * 400.0) * sin(life * 3.1416);
    }
    float pulse = 0.8 + 0.2 * sin(t * 4.0);
    vec3 col = uColA * glow * pulse + mix(uColA, vec3(1.0), 0.5) * motes * 2.0;
    fragColor = vec4(col * ramp * uActive, 0.0);
    return;
  }
  // Flame cloak: a licking shell around the anchor ellipse.
  // Noise keyed on |x| keeps the cloak balanced left/right (keying it on
  // the angle left a seam and a lopsided flare on one side).
  float n = fbm(vec2(abs(p.x) * 2.0 + uSeed, d * 2.0 - t * 2.4));
  float n2 = fbm(vec2(abs(p.x) * 2.5, p.y * 1.4 - t * 3.0) + uSeed * 3.0);
  float up = clamp(p.y * 0.25 + 0.5, 0.0, 1.0);
  float outer = 1.0 + n * 0.55 + up * 0.45 * n2;
  float shell = smoothstep(outer, outer - 0.25, d) * smoothstep(0.55, 0.95, d);
  float inner = exp(-d * d * 1.2) * 0.12;
  vec3 col = mix(uColA, uColB, smoothstep(0.2, 0.8, n2)) * (shell * 0.8 + inner);
  if (uVariant > 0.5) {
    float arcs = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float st = stepT(t, mix(7.0, 13.0, hash1(fi)));
      float a0 = hash1(st + fi * 13.1) * 6.2831;
      float da = abs(fract((ang - a0) / 6.2831 + 0.5) - 0.5) * 6.2831;
      float jag = (noise(vec2(ang * 9.0 + st * 31.0, fi)) - 0.5) * 0.25;
      float band = abs(d - (1.0 + jag));
      arcs += exp(-band * band * 2500.0) * smoothstep(0.9, 0.0, da);
    }
    col = col * 0.7 + mix(uColB, vec3(1.0), 0.6) * arcs * 2.2;
  }
  fragColor = vec4(col * ramp * uActive, 0.0);
}
`;

// --- Wood Release -----------------------------------------------------------
// 0: branches erupting from the anchor along uDir   1: forest rising from the
// ground across the frame   2: four-pillar prison (pillars + beams)
export const WOOD_FRAG_SRC = PRELUDE + `
// Distance to a wobbling, tapering branch from o along angle a.
float branch(vec2 p, vec2 o, float a, float len, float seed, float thick, out float along) {
  vec2 dir = vec2(cos(a), sin(a));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 rel = p - o;
  float s = dot(rel, dir);
  along = s / max(len, 1e-3);
  if (s < -thick || s > len + thick) return 1e3;
  float off = (noise(vec2(s * 1.3 + seed * 7.0, seed)) - 0.5) * 0.7 * s / (1.0 + s);
  float w = thick * mix(1.0, 0.25, clamp(along, 0.0, 1.0));
  return abs(dot(rel, perp) - off) - w;
}
void main() {
  vec2 p = localP();
  float t = uTime;
  float d = 1e3;
  float alongBest = 0.0;
  float tipLeaf = 0.0;
  float grow = smoothstep(0.0, 2.2, t);
  if (uVariant < 0.5) {
    float base = atan(uDir.y, uDir.x);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float a = base + (hash1(fi * 5.7 + uSeed) - 0.5) * 1.7;
      float len = mix(2.2, 4.4, hash1(fi * 2.3 + uSeed)) * grow;
      float al;
      float bd = branch(p, vec2(0.0), a, len, fi + uSeed, 0.2, al);
      if (bd < d) { d = bd; alongBest = al; }
      vec2 tip = vec2(cos(a), sin(a)) * len;
      tipLeaf += exp(-dot(p - tip, p - tip) * 6.0) * grow;
      float sa = a + (hash1(fi * 9.1) > 0.5 ? 0.7 : -0.7);
      vec2 so = vec2(cos(a), sin(a)) * len * 0.45;
      float sb = branch(p, so, sa, len * 0.45, fi * 3.0 + 1.0, 0.11, al);
      if (sb < d) { d = sb; alongBest = al; }
    }
  } else if (uVariant < 1.5) {
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      vec2 o = vec2((fi - 4.0) * 0.95 + (hash1(fi) - 0.5) * 0.4, -0.2);
      float len = mix(3.0, 6.0, hash1(fi * 4.1)) * smoothstep(fi * 0.12, fi * 0.12 + 2.0, t);
      float a = 1.5708 + (hash1(fi * 1.9) - 0.5) * 0.5;
      float al;
      float bd = branch(p, o, a, len, fi, 0.32, al);
      if (bd < d) { d = bd; alongBest = al; }
      float sb = branch(p, o + vec2(cos(a), sin(a)) * len * 0.55, a + (hash1(fi * 7.0) - 0.5) * 2.0, len * 0.4, fi + 9.0, 0.16, al);
      if (sb < d) { d = sb; alongBest = al; }
    }
  } else {
    float h = 3.4 * grow;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float x = (fi - 1.5) * 1.05;
      float pd = abs(p.x - x) - 0.14;
      pd = max(pd, max(-0.2 - p.y, p.y - h));
      if (pd < d) { d = pd; alongBest = (p.y + 0.2) / 3.6; }
    }
    for (int j = 0; j < 4; j++) {
      float y = 0.4 + float(j) * 0.85;
      float bd = max(abs(p.y - y) - 0.08, abs(p.x) - 1.75);
      bd = max(bd, y - h);
      if (bd < d) { d = bd; alongBest = 0.5; }
    }
  }
  float mask = smoothstep(0.03, -0.03, d);
  float bark = fbm(vec2(p.x * 3.0, p.y * 12.0 + alongBest * 6.0));
  vec3 woodCol = mix(uColA * 0.55, uColA * 1.2, bark);
  woodCol *= 0.75 + 0.35 * smoothstep(-0.25, 0.0, d);
  vec3 leaves = uColB * tipLeaf * (0.6 + 0.4 * fbm(p * 8.0));
  float leafMask = smoothstep(0.35, 0.6, tipLeaf * fbm(p * 6.0 + 3.0) * 1.6);
  vec3 col = woodCol * mask + leaves * leafMask * (1.0 - mask);
  float a = clamp(mask + leafMask * 0.9, 0.0, 1.0);
  fragColor = vec4(col * uActive, a * uActive);
}
`;

// --- Water ------------------------------------------------------------------
// 0: Water Dragon - serpent body snaking along uDir with a horned head
// 1: water sphere (Water Prison)   2: Shark Bomb - water shark charging out
export const WATER_FRAG_SRC = PRELUDE + VIDEO + `
float ell(vec2 p, vec2 r) { return length(p / r) - 1.0; }
void main() {
  vec2 p = localP();
  float t = uTime;
  float mask;
  vec2 normal;
  float foam;
  float eyes = 0.0;
  if (uVariant < 0.5) {
    vec2 q = dirP(p);
    float len = 3.0 * smoothstep(0.0, 1.6, t);
    float s = q.x;
    float bend = 0.55 * smoothstep(0.0, 2.0, s);
    float center = sin(s * 1.3 - t * 3.5) * bend;
    float w = mix(0.22, 0.5, smoothstep(0.0, len, s));
    float dy = q.y - center;
    float body = smoothstep(w, w - 0.08, abs(dy)) * smoothstep(-0.2, 0.2, s) * step(s, len - 0.3);
    // Head at the leading end, following the body's sway.
    float hc = sin(len * 1.3 - t * 3.5) * 0.55 * smoothstep(0.0, 2.0, len);
    vec2 h = vec2(s - len, q.y - hc);
    float skull = ell(h - vec2(-0.15, 0.0), vec2(0.62, 0.42));
    float snout = ell(h - vec2(0.35, -0.05), vec2(0.45, 0.24));
    // Open jaw: carve a wedge out of the front.
    float jaw = h.x > 0.1 ? abs(h.y + 0.05) - (h.x - 0.1) * 0.35 : 1.0;
    float headD = max(min(skull, snout), -jaw);
    vec2 hornA = h - vec2(-0.35, 0.3);
    float horns = min(sdSeg(h, vec2(-0.3, 0.3), vec2(-1.0, 0.75)), sdSeg(h, vec2(-0.3, -0.3), vec2(-1.0, -0.75))) - 0.06;
    float headM = smoothstep(0.03, -0.03, min(headD, horns)) * step(0.3, len);
    mask = max(body, headM);
    normal = headM > body ? normalize(h + vec2(0.0, 1e-3)) * 0.8 : vec2(0.0, dy / w);
    float flow = fbm(vec2(s * 3.0 - t * 7.0, dy * 4.0));
    foam = smoothstep(0.62, 0.85, flow) + smoothstep(0.7, 1.0, abs(dy) / w) * 0.6 * body;
    foam += smoothstep(0.0, -0.05, -abs(headD)) * headM * 0.0;
    eyes = smoothstep(0.08, 0.04, length(vec2(h.x + 0.05, abs(h.y) - 0.2))) * headM;
    foam += exp(-abs(min(headD, horns)) * 25.0) * headM * 0.5;
  } else if (uVariant < 1.5) {
    float r = length(p);
    float rad = 1.0 + 0.04 * sin(t * 3.0 + atan(p.y, p.x) * 5.0);
    rad *= smoothstep(0.0, 0.6, t);
    mask = smoothstep(rad, rad - 0.04, r);
    normal = p / max(rad, 0.01);
    float caust = fbm(p * 3.0 + vec2(t * 0.6, -t * 0.4));
    foam = smoothstep(0.88, 1.0, r / max(rad, 0.01)) * 0.8 + smoothstep(0.62, 0.8, caust) * 0.4;
  } else {
    // Shark launched from the hand along uDir, re-launching every 2.4s.
    vec2 q = dirP(p);
    float cyc = mod(t, 2.4);
    float x0 = mix(0.3, 5.5, smoothstep(0.0, 2.2, cyc));
    vec2 h = vec2(q.x - x0, q.y - sin(cyc * 6.0) * 0.08);
    float tailWag = sin(t * 14.0) * 0.12;
    float bodyD = ell(h, vec2(1.15, 0.36 - 0.12 * smoothstep(0.0, -1.1, h.x)));
    // Dorsal fin (on the +y side) and forked tail.
    float fin = max(max(-(h.y - 0.25), h.x * 0.9 + (h.y - 0.25) * 0.75 - 0.15), -(h.x + 0.45) - (h.y - 0.25) * 0.2);
    vec2 tl = h - vec2(-1.15, tailWag);
    float tail = max(abs(tl.y) - 0.05 - max(-tl.x, 0.0) * 0.7, max(tl.x - 0.05, -tl.x - 0.5));
    float d = min(bodyD, min(fin, tail));
    mask = smoothstep(0.03, -0.03, d) * smoothstep(0.0, 0.3, cyc) * (1.0 - smoothstep(2.1, 2.4, cyc));
    normal = normalize(h * vec2(0.5, 1.0) + vec2(0.0, 1e-3));
    float teeth = step(0.75, h.x) * step(abs(h.y + 0.05), 0.06) * step(0.5, fract(h.y * 0.0 + h.x * 14.0));
    foam = teeth * 2.0 + exp(-abs(d) * 30.0) * 0.6;
    eyes = smoothstep(0.05, 0.03, length(h - vec2(0.62, 0.12))) * mask;
    // Spray trail behind it.
    float trail = exp(-q.y * q.y * 18.0) * step(q.x, x0 - 1.0) * step(0.0, q.x) * fbm(vec2(q.x * 6.0 - t * 10.0, q.y * 8.0));
    mask = max(mask, trail * 0.6 * (1.0 - smoothstep(2.1, 2.4, cyc)));
    foam += trail;
  }
  vec2 refr = normal * uHandScale * 0.25;
  vec3 seen = sampleVideo(gl_FragCoord.xy - refr);
  vec3 col = mix(seen, uColA, 0.45) + uColB * foam;
  float spec = pow(max(0.0, 1.0 - length(normal - vec2(-0.4, 0.5))), 6.0);
  col += vec3(1.0) * spec * 0.6;
  col = mix(col, vec3(0.02, 0.05, 0.12), eyes);
  fragColor = vec4(col * mask * uActive, mask * uActive);
}
`;

// --- Paper ------------------------------------------------------------------
// 0: paper sheets swarming the anchor   1: paper butterflies / shikigami
// 2: explosive tags that detonate
export const PAPER_FRAG_SRC = PRELUDE + `
void main() {
  vec2 p = localP();
  float t = uTime;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float fire = 0.0;
  const int N = 22;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float h1 = hash1(fi * 3.17 + uSeed);
    float h2 = hash1(fi * 7.31 + uSeed);
    float orbit = mix(0.9, 2.6, h1);
    float ang = h2 * 6.2831 + t * mix(0.6, 1.4, h1) * (h2 > 0.5 ? 1.0 : -1.0);
    vec2 c = vec2(cos(ang) * orbit, sin(ang) * orbit * 0.55 + sin(t * 1.3 + fi) * 0.3);
    if (uVariant > 1.5) {
      // Tags fly out from the anchor then hang in the air.
      float out_ = smoothstep(0.0, 1.0, t - h1 * 0.4);
      c = mix(vec2(0.0), vec2(cos(h2 * 6.2831), sin(h2 * 6.2831)) * orbit * 1.2, out_);
      c.y += sin(t * 2.0 + fi) * 0.08;
    }
    vec2 q = p - c;
    float flip = cos(t * mix(3.0, 7.0, h2) + fi);
    q = rot(fi + t * 0.7 * (h1 - 0.5)) * q;
    float shape;
    float inside;
    if (uVariant > 0.5 && uVariant < 1.5) {
      // Butterfly: two lobes mirrored across the body axis.
      vec2 b = vec2(abs(q.x) / max(abs(flip), 0.15), q.y);
      float lobe = length((b - vec2(0.17, 0.08)) * vec2(1.0, 1.3)) - 0.15;
      float lobe2 = length((b - vec2(0.12, -0.1)) * vec2(1.0, 1.4)) - 0.1;
      shape = min(lobe, lobe2);
      inside = smoothstep(0.01, -0.01, shape);
    } else {
      vec2 sz = uVariant > 1.5 ? vec2(0.11, 0.3) : vec2(0.22, 0.3);
      sz.x *= max(abs(flip), 0.12);
      vec2 dd = abs(q) - sz;
      shape = max(dd.x, dd.y);
      inside = smoothstep(0.01, -0.01, shape);
    }
    if (inside > 0.0) {
      float shade = 0.78 + 0.22 * abs(flip);
      vec3 pc = uColA * shade;
      if (uVariant > 1.5) {
        // Ink seal stripes down the tag.
        float ink = step(abs(q.x), 0.03 * max(abs(flip), 0.12)) * step(abs(q.y), 0.22);
        ink = max(ink, step(abs(abs(q.y) - 0.18), 0.02));
        pc = mix(pc, uColB, ink);
      }
      col = mix(col, pc, inside);
      a = max(a, inside);
    }
    if (uVariant > 1.5) {
      float boom = t - 2.4 - h1 * 0.8;
      if (boom > 0.0 && boom < 1.4) {
        float r = length(p - c);
        float rad = boom * 1.4;
        float n = fbm((p - c) * 3.0 + fi);
        fire += smoothstep(rad, rad * 0.3, r + n * 0.4 * rad) * (1.0 - boom / 1.4);
      }
    }
  }
  if (uVariant > 1.5 && t > 2.4) a *= 0.0;
  vec3 fireCol = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.95, 0.7), clamp(fire - 0.5, 0.0, 1.0)) * fire * 1.8;
  fragColor = vec4((col + fireCol) * uActive, clamp(a, 0.0, 1.0) * uActive);
}
`;

// --- Shadow -----------------------------------------------------------------
// 0: Shadow Possession (shadow creeps along the ground and up to the anchor)
// 1: Shadow Strangle (shadow hands climbing up)   2: Shadow Sewing (needles)
export const SHADOW_FRAG_SRC = PRELUDE + `
void main() {
  vec2 p = localP();
  float t = uTime;
  float d = 1e3;
  float grow = smoothstep(0.0, 2.0, t);
  int count = uVariant < 0.5 ? 5 : (uVariant < 1.5 ? 7 : 14);
  float bottom = -uHandPos.y / max(uHandScale, 1.0);
  for (int i = 0; i < 14; i++) {
    if (i >= count) break;
    float fi = float(i);
    vec2 start = vec2((fi - float(count - 1) * 0.5) * (uVariant > 1.5 ? 0.55 : 0.9), bottom);
    vec2 target = vec2((hash1(fi * 3.7) - 0.5) * 1.2, (hash1(fi * 5.3) - 0.5) * 1.4);
    vec2 cur = mix(start, target, grow);
    if (uVariant > 1.5) {
      float sd = sdSeg(p, start, cur);
      vec2 ab = cur - start;
      float along = clamp(dot(p - start, ab) / dot(ab, ab), 0.0, 1.0);
      d = min(d, sd - mix(0.07, 0.005, along));
      continue;
    }
    // Wiggly tendril, sampled as a short polyline.
    vec2 prev = start;
    for (int k = 1; k <= 8; k++) {
      float u = float(k) / 8.0;
      vec2 pt = mix(start, cur, u);
      vec2 ab = cur - start;
      vec2 nrm = normalize(vec2(-ab.y, ab.x) + 1e-5);
      pt += nrm * sin(u * 7.0 + t * 3.0 + fi) * 0.25 * u * (1.0 - u) * 2.0;
      float w = mix(uVariant < 0.5 ? 0.3 : 0.18, 0.05, u);
      d = min(d, sdSeg(p, prev, pt) - w);
      prev = pt;
    }
    if (uVariant > 0.5) {
      // Shadow hand at the tip: a palm blob with stubby fingers.
      d = min(d, length(p - prev) - 0.16);
    }
  }
  if (uVariant < 0.5) {
    // Pool of shadow on the ground under the anchor.
    vec2 g = vec2(p.x * 0.9, (p.y - bottom) * 2.6);
    d = min(d, length(g) - 0.9 * grow);
  }
  d += (fbm(p * 5.0 + t) - 0.5) * 0.06;
  float mask = smoothstep(0.03, -0.03, d);
  float rim = exp(-abs(d) * 30.0) * 0.6;
  vec3 col = uColA * mask + uColB * rim;
  fragColor = vec4(col * uActive, mask * 0.93 * uActive);
}
`;

// --- Smoke / summoning ------------------------------------------------------
// 0: clone poof   1: summoning seal on the ground + smoke
// 2: Body Flicker (afterimage streaks + leaf swirl)   3: Flying Thunder God
export const SMOKE_FRAG_SRC = PRELUDE + `
void main() {
  vec2 p = localP();
  float t = uTime;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float cyc = mod(t, 4.0);
  if (uVariant > 0.5 && uVariant < 1.5) {
    // Seal circle drawn flat on the ground (squashed ellipse).
    vec2 g = vec2(p.x, p.y * 3.2);
    float r = length(g);
    float draw = smoothstep(0.0, 0.8, t);
    float ring = exp(-pow(r - 1.6, 2.0) * 300.0) + exp(-pow(r - 1.3, 2.0) * 500.0);
    float ang = atan(g.y, g.x);
    float spokes = step(abs(fract(ang / 6.2831 * 12.0) - 0.5), 0.06) * step(0.4, r) * step(r, 1.3);
    float seal = (ring + spokes * 0.7) * draw;
    col += uColA * seal * 1.5;
  }
  if (uVariant > 2.5) {
    float flash = exp(-cyc * 3.0);
    float r = length(p);
    col += uColB * (exp(-r * r * 2.0) * flash * 2.5 + exp(-pow(r - cyc * 2.5, 2.0) * 20.0) * (1.0 - cyc / 4.0));
    // Kunai seal formula strokes around the anchor.
    float ang = atan(p.y, p.x);
    float strokes = step(abs(fract(ang / 6.2831 * 8.0) - 0.5), 0.04) * smoothstep(0.7, 0.75, r) * smoothstep(1.2, 1.15, r);
    col += uColA * strokes * (0.5 + flash);
    fragColor = vec4(col * uActive, 0.0);
    return;
  }
  if (uVariant > 1.5) {
    // Speed streaks + whirling leaves.
    float streak = 0.0;
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      float y = (hash1(fi) - 0.5) * 2.4;
      float x0 = fract(t * 1.8 + hash1(fi * 3.0)) * 6.0 - 3.0;
      streak += exp(-pow(p.y - y, 2.0) * 900.0) * smoothstep(x0 - 1.4, x0, p.x) * smoothstep(x0 + 0.05, x0, p.x);
    }
    col += uColB * streak * 1.2;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float ang = t * 4.0 + fi * 0.524;
      vec2 c = vec2(cos(ang), sin(ang) * 0.6) * (1.0 + 0.3 * sin(fi));
      vec2 q = rot(ang * 2.0) * (p - c);
      float leaf = smoothstep(0.01, -0.01, length(q * vec2(1.0, 2.2)) - 0.1);
      col = mix(col, uColA, leaf);
      a = max(a, leaf);
    }
  }
  // Smoke puff, re-triggered every cycle so the jutsu keeps "popping".
  // Puff grows fast then stops, so it never veils the whole frame.
  float rad = (0.4 + smoothstep(0.0, 1.2, cyc) * 1.6) * (uVariant > 1.5 ? 0.6 : 1.0);
  vec2 sp = p - vec2(0.0, uVariant > 0.5 && uVariant < 1.5 ? 0.6 : 0.0);
  float n = fbm(sp * 2.2 + vec2(0.0, -t * 0.8) + uSeed);
  float puff = smoothstep(rad, rad * 0.35, length(sp) + (n - 0.5) * rad * 0.9);
  float fade = 1.0 - smoothstep(1.2, 3.4, cyc);
  float dens = puff * fade;
  vec3 smokeCol = mix(vec3(0.62), vec3(0.98), n);
  col = mix(col, smokeCol * dens, clamp(dens * 1.2, 0.0, 1.0));
  a = max(a, clamp(dens * 1.1, 0.0, 0.95));
  fragColor = vec4(col * uActive, a * uActive);
}
`;

// --- Kamui vortex (space-time swirl that drags the real video in) ----------
export const VORTEX_FRAG_SRC = PRELUDE + VIDEO + `
void main() {
  vec2 p = localP();
  float t = uTime;
  float r = length(p);
  float rad = 1.6;
  if (r > rad) { fragColor = vec4(0.0); return; }
  float strength = smoothstep(0.0, 1.5, t) * 5.0;
  float fall = pow(1.0 - r / rad, 2.0);
  float ang = strength * fall + t * 2.5 * fall;
  vec2 src = rot(ang) * p * mix(1.0, 0.35, fall * smoothstep(0.0, 2.0, t));
  vec3 seen = sampleVideo(uHandPos + src * uHandScale);
  float arms = 0.5 + 0.5 * sin(atan(p.y, p.x) * 3.0 - log(r + 0.05) * 6.0 + t * 6.0);
  float core = smoothstep(0.35, 0.0, r) * smoothstep(0.2, 1.0, t);
  vec3 col = mix(seen, seen * uColA * 2.0, fall * 0.6) * (1.0 - core);
  col += uColB * arms * fall * 0.35;
  float mask = smoothstep(rad, rad * 0.8, r);
  fragColor = vec4(col * mask * uActive, mask * uActive);
}
`;

// --- Fullscreen genjutsu ------------------------------------------------------
// 0: Tsukuyomi (red negative world + red moon)   1: mind jutsu (psychic
// ripples from the anchor)   2: Edo Tensei (ashen skin, cracks, dark mist)
// 3: Kotoamatsukami (shimmering light veil)
export const GENJUTSU_FRAG_SRC = PRELUDE + VIDEO + `
float voronoiEdge(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 7.7));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return d2 - d1;
}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = localP();
  float t = uTime;
  float ramp = smoothstep(0.0, 1.0, t) * uActive;
  vec3 v = sampleVideo(frag);
  float l = dot(v, vec3(0.299, 0.587, 0.114));
  vec3 col = v;
  if (uVariant < 0.5) {
    float inv = smoothstep(0.25, 0.65, 1.0 - l);
    col = mix(vec3(0.02, 0.0, 0.0), uColA, inv);
    vec2 uv = frag / uResolution;
    vec2 moonC = vec2(0.78, 0.8);
    vec2 mp = (uv - moonC) * vec2(uResolution.x / uResolution.y, 1.0);
    float moon = smoothstep(0.13, 0.125, length(mp));
    col = mix(col, uColB * (0.85 + 0.15 * fbm(mp * 20.0)), moon);
    col += uColB * exp(-length(mp) * 9.0) * 0.4;
    col *= 0.85 + 0.15 * noise(vec2(uv.y * 400.0, t * 30.0));
  } else if (uVariant < 1.5) {
    float r = length(p);
    float rings = 0.5 + 0.5 * sin(r * 7.0 - t * 6.0);
    vec2 warp = normalize(p + 1e-4) * sin(r * 7.0 - t * 6.0) * 4.0 * exp(-r * 0.3);
    vec3 vw = sampleVideo(frag + warp);
    float lw = dot(vw, vec3(0.299, 0.587, 0.114));
    col = mix(vw, vec3(lw) * uColA * 1.6, 0.55);
    col += uColB * pow(rings, 8.0) * exp(-r * 0.25) * 0.6;
  } else if (uVariant < 2.5) {
    float r = length(p);
    vec3 ash = vec3(l) * vec3(0.92, 0.9, 0.96);
    col = mix(v, ash, 0.8);
    float cracks = smoothstep(0.06, 0.0, voronoiEdge(p * 3.5)) * smoothstep(1.6, 0.4, r);
    col = mix(col, vec3(0.08, 0.05, 0.08), cracks * 0.85);
    float mist = fbm(frag / uResolution.y * 4.0 + vec2(0.0, -t * 0.4));
    float low = smoothstep(0.55, 0.0, frag.y / uResolution.y);
    col = mix(col, uColA, mist * low * 0.8);
  } else {
    vec2 uv = frag / uResolution;
    float veil = fbm(vec2(uv.x * 3.0 + t * 0.2, uv.y * 3.0 - t * 0.3));
    vec2 cell = floor(frag / 18.0);
    vec2 cf = fract(frag / 18.0) - 0.5;
    float star = step(0.97, hash(cell)) * (0.5 + 0.5 * sin(t * 6.0 + hash(cell + 3.0) * 40.0));
    float sparkle = star * exp(-dot(cf, cf) * 60.0) * 2.0;
    col = v + uColA * veil * 0.35 + uColB * sparkle;
    col = mix(col, vec3(l) * uColA * 1.4, 0.15);
  }
  fragColor = vec4(col * ramp, ramp);
}
`;

// --- Shockwaves / domes -------------------------------------------------------
// 0: punch impact (rings + ground cracks)   1: Eight Trigrams Palm Rotation
// dome   2: Shinra Tensei push   3: trigram field on the ground
// 4: Cherry Blossom Impact (impact + petals)
export const SHOCK_FRAG_SRC = PRELUDE + VIDEO + `
void main() {
  vec2 p = localP();
  float t = uTime;
  float r = length(p);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uVariant > 0.5 && uVariant < 1.5) {
    vec2 e = p * vec2(1.0, 0.85);
    float re = length(e);
    float rad = 1.7 * smoothstep(0.0, 0.6, t);
    float shell = smoothstep(rad, rad - 0.08, re);
    float ang = atan(e.y, e.x);
    float swirl = 0.5 + 0.5 * sin(ang * 10.0 + re * 6.0 - t * 14.0);
    float band = pow(swirl, 3.0) * shell * smoothstep(0.2, rad, re);
    vec2 warp = e * band * 12.0;
    vec3 seen = sampleVideo(gl_FragCoord.xy + warp);
    col = mix(seen, seen + uColA * 0.6, band) + uColB * exp(-pow(re - rad, 2.0) * 120.0);
    a = shell * 0.95;
    fragColor = vec4(col * uActive, a * uActive);
    return;
  }
  if (uVariant > 2.5 && uVariant < 3.5) {
    vec2 g = vec2(p.x, p.y * 3.0);
    float rg = length(g);
    float ang = atan(g.y, g.x);
    float ring = exp(-pow(rg - 2.0, 2.0) * 200.0) + exp(-pow(rg - 0.7, 2.0) * 300.0);
    float bars = 0.0;
    for (int i = 0; i < 8; i++) {
      float aa = float(i) * 0.7854;
      vec2 c = vec2(cos(aa), sin(aa)) * 1.4;
      vec2 q = rot(-aa) * (g - c);
      float gap = step(abs(q.x), 0.03) * 0.0;
      for (int k = 0; k < 3; k++) {
        float y = (float(k) - 1.0) * 0.12;
        bars += step(abs(q.x - y), 0.035) * step(abs(q.y), 0.22) * step(0.04, abs(q.y) + gap + hash1(float(i * 3 + k)) * 0.06);
      }
    }
    float yin = step(rg, 0.7) * step(0.0, sin(ang + rg * 3.0));
    float draw = smoothstep(0.0, 1.0, t);
    col = uColA * (ring + bars + yin * 0.4) * draw;
    float hits = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float ph = fract(t * 2.5 + hash1(fi));
      vec2 c = vec2(hash1(fi * 2.0) - 0.5, hash1(fi * 5.0) - 0.2) * 1.6;
      hits += exp(-pow(length(p - c) - ph * 0.3, 2.0) * 600.0) * (1.0 - ph);
    }
    col += uColB * hits * 0.6;
    fragColor = vec4(col * uActive, 0.0);
    return;
  }
  if (uVariant > 1.5 && uVariant < 2.5) {
    // Shinra Tensei: a refracting dome of force bursts outward from the
    // body, shoving the picture away from its centre, with debris thrown out.
    float cyc = mod(t, 2.4);
    float rad = 1.7 * (1.0 - exp(-cyc * 2.2));
    float fade = 1.0 - smoothstep(1.4, 2.4, cyc);
    float inside = smoothstep(rad, rad - 0.06, r);
    float push = inside * (1.0 - r / max(rad, 0.01)) * 0.5;
    vec3 seen = sampleVideo(gl_FragCoord.xy - normalize(p + 1e-4) * push * uHandScale);
    float rim = exp(-pow(r - rad, 2.0) * 60.0);
    col = mix(seen, seen * 1.15 + uColA * 0.15, inside) + uColB * rim * 1.2 + uColA * exp(-r * r * 6.0) * exp(-cyc * 3.0) * 1.5;
    a = max(inside, rim) * fade;
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      float ang = hash1(fi * 4.7) * 6.2831;
      vec2 dpos = vec2(cos(ang), sin(ang)) * (rad + 0.15 + hash1(fi) * 0.3);
      vec2 q = rot(cyc * 6.0 + fi) * (p - dpos);
      float rock = smoothstep(0.01, -0.01, max(abs(q.x), abs(q.y)) - mix(0.04, 0.09, hash1(fi * 9.0)));
      col = mix(col, vec3(0.22, 0.2, 0.18), rock);
      a = max(a, rock * fade);
    }
    fragColor = vec4(col * a * uActive, a * uActive);
    return;
  }
  float period = 1.6;
  float speed = 3.0;
  float ph = mod(t, period);
  float rad = ph * speed;
  float ringBand = exp(-pow(r - rad, 2.0) * 18.0) * (1.0 - ph / period);
  vec2 warp = normalize(p + 1e-4) * ringBand * uHandScale * 0.12;
  vec3 seen = sampleVideo(gl_FragCoord.xy - warp);
  col = seen + uColA * ringBand * 0.8;
  a = clamp(ringBand * 3.0, 0.0, 1.0);
  if (uVariant < 0.5 || uVariant > 3.5) {
    // Radial ground cracks glowing from the impact point.
    float ang = atan(p.y, p.x);
    float crack = 0.0;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float ca = hash1(fi * 3.3) * 6.2831;
      float da = abs(fract((ang - ca) / 6.2831 + 0.5) - 0.5) * 6.2831 * r;
      float jag = (noise(vec2(r * 5.0, fi)) - 0.5) * 0.15;
      crack += smoothstep(0.04, 0.0, abs(da - jag)) * smoothstep(2.6 * smoothstep(0.0, 0.5, t), 0.0, r);
    }
    col = mix(col, uColB * 1.4, clamp(crack, 0.0, 1.0));
    a = max(a, clamp(crack, 0.0, 1.0));
    float flash = exp(-ph * 5.0) * exp(-r * r * 1.5);
    col += vec3(1.0) * flash;
    a = max(a, flash);
  }
  if (uVariant > 3.5) {
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float life = fract(t * 0.35 + hash1(fi * 1.7));
      vec2 c = vec2(hash1(fi) - 0.5, hash1(fi * 9.0) - 0.5) * 2.0 * (0.5 + life * 2.5);
      c.y -= life * 1.2;
      vec2 q = rot(t * 2.0 + fi) * (p - c);
      float petal = smoothstep(0.01, -0.01, length(q * vec2(1.0, 1.8)) - 0.09);
      col = mix(col, uColB, petal);
      a = max(a, petal);
    }
  }
  fragColor = vec4(col * a * uActive, a * uActive);
}
`;

// --- Tornado / drilling spin --------------------------------------------------
// 0: Fang Over Fang drill   1: Leaf Hurricane sweep
// 2: Twin Wolf Fang - two drills corkscrewing around each other
// 3: Primary Lotus - head-first plunging drill wrapped in bandages
export const TORNADO_FRAG_SRC = PRELUDE + `
// One spinning cone, apex at q.y = 0 widening upward; returns premult rgb + a.
vec4 drill(vec2 q, float spin, vec3 dark, vec3 light) {
  float h = q.y;
  float radius = 0.3 + max(h, 0.0) * 0.36;
  float inside = smoothstep(radius, radius - 0.1, abs(q.x)) * smoothstep(-0.1, 0.2, h) * smoothstep(3.0, 2.4, h);
  float u = q.x / max(radius, 0.01);
  float spiral = fract(asin(clamp(u, -1.0, 1.0)) / 3.1416 * 2.0 + h * 1.6 - spin);
  float bands = smoothstep(0.0, 0.15, spiral) * smoothstep(0.55, 0.25, spiral);
  float depth = sqrt(max(0.0, 1.0 - u * u));
  vec3 col = mix(dark * 0.5, light, bands) * (0.4 + 0.6 * depth);
  col += light * smoothstep(0.65, 0.9, fbm(vec2(spiral * 6.0, h * 3.0))) * 0.6;
  float a = inside * (0.45 + 0.4 * bands);
  return vec4(col * a, a * 0.8);
}
void main() {
  vec2 p = localP();
  float t = uTime;
  if (uVariant > 0.5 && uVariant < 1.5) {
    float r = length(p * vec2(1.0, 1.6));
    float ang = atan(p.y * 1.6, p.x);
    float arcs = pow(0.5 + 0.5 * sin(ang * 2.0 - t * 12.0 + r * 4.0), 6.0) * exp(-pow(r - 1.3, 2.0) * 4.0);
    vec3 col = uColA * arcs * 1.2;
    float a = 0.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float la = t * 7.0 + fi * 0.39;
      vec2 c = vec2(cos(la), sin(la) / 1.6) * (1.0 + hash1(fi) * 0.8);
      vec2 q = rot(la * 3.0) * (p - c);
      float leaf = smoothstep(0.01, -0.01, length(q * vec2(1.0, 2.4)) - 0.09);
      col = mix(col, uColB * (0.7 + 0.3 * hash1(fi * 2.0)), leaf);
      a = max(a, leaf);
    }
    fragColor = vec4(col * uActive, a * uActive);
    return;
  }
  if (uVariant > 1.5 && uVariant < 2.5) {
    // Two drills orbiting a shared axis; the one "in front" draws on top.
    float orbit = t * 5.0;
    vec4 outC = vec4(0.0);
    for (int i = 0; i < 2; i++) {
      float ph = orbit + float(i) * 3.1416;
      vec2 q = vec2(p.x - sin(ph) * 0.55, p.y + 1.1);
      vec4 d = drill(q * 1.15, t * 7.0 + float(i), i == 0 ? uColA : uColB * 0.8, i == 0 ? vec3(0.95, 0.9, 0.85) : uColB);
      float front = cos(ph);
      d *= 0.75 + 0.25 * front;
      outC = front > 0.0 ? d + outC * (1.0 - d.a) : outC + d * (1.0 - outC.a);
    }
    fragColor = outC * uActive;
    return;
  }
  if (uVariant > 2.5) {
    // Plunging drill (apex pointing down) + bandage strips spiralling round.
    vec4 d = drill(vec2(p.x, -(p.y - 1.4)), t * 9.0, uColA, vec3(1.0, 0.75, 0.6));
    vec3 col = d.rgb;
    float a = d.a;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float y = 0.2 + fi * 0.45 + 0.28 * sin(p.x * 2.6 + t * 9.0 + fi * 2.1);
      float strip = smoothstep(0.07, 0.05, abs(p.y - y)) * smoothstep(1.15, 0.9, abs(p.x));
      float shade = 0.7 + 0.3 * cos(p.x * 2.6 + t * 9.0 + fi * 2.1);
      vec3 sc = uColB * shade * (0.9 + 0.1 * step(0.5, fract(p.x * 10.0)));
      col = mix(col, sc, strip);
      a = max(a, strip);
    }
    // Vertical speed lines.
    float lines = step(0.92, hash(vec2(floor(p.x * 30.0), 0.0))) * fract(-p.y * 0.6 + t * 3.0 + hash(vec2(floor(p.x * 30.0), 1.0)));
    col += vec3(1.0) * lines * 0.35 * smoothstep(2.2, 0.5, abs(p.x));
    fragColor = vec4(col * uActive, a * uActive);
    return;
  }
  fragColor = drill(vec2(p.x, p.y + 1.2), t * 6.0, uColA, uColB) * uActive;
}
`;

// --- Chakra threads / iron sand -----------------------------------------------
// 0: threads from each fingertip (Puppet Technique)   1: many threads fanning
// up to a hundred puppets   2: Iron Sand cloud with spikes
export const THREADS_FRAG_SRC = PRELUDE + `
uniform vec3 uFingers[10]; // GL px x, y, active
void main() {
  vec2 frag = gl_FragCoord.xy;
  float t = uTime;
  if (uVariant > 1.5) {
    vec2 p = localP();
    float r = length(p);
    float ang = atan(p.y, p.x);
    float n = fbm(p * 2.5 + vec2(t * 0.5, -t * 0.3));
    float spikes = pow(0.5 + 0.5 * sin(ang * 9.0 + n * 3.0), 12.0) * smoothstep(0.0, 1.5, t) * 1.2;
    float body = 1.0 + spikes + (n - 0.5) * 0.6;
    float grains = step(0.55, hash(floor(frag * 0.5) + floor(t * 12.0)));
    float mask = smoothstep(body, body - 0.25, r) * (0.75 + 0.25 * grains);
    vec3 col = uColA * (0.4 + 0.6 * n) + uColB * pow(n, 4.0) * 0.8;
    fragColor = vec4(col * mask * uActive, mask * 0.92 * uActive);
    return;
  }
  // Widths below are tuned at 720p; keep them proportional to the canvas.
  float k = uResolution.y / 720.0;
  float glow = 0.0;
  int fan = uVariant > 0.5 ? 3 : 1;
  for (int i = 0; i < 10; i++) {
    vec3 f = uFingers[i];
    if (f.z < 0.5) continue;
    for (int k_ = 0; k_ < 3; k_++) {
      if (k_ >= fan) break;
      float fk = float(k_) - float(fan - 1) * 0.5;
      vec2 top = vec2(f.x + (float(i) - 4.5) * uResolution.x * 0.035 + fk * uResolution.x * 0.08 + sin(t * 1.3 + float(i)) * 20.0 * k, uResolution.y * 1.05);
      float s = clamp((frag.y - f.y) / max(top.y - f.y, 1.0), 0.0, 1.0);
      float x = mix(f.x, top.x, s) + sin(s * 3.1416) * 25.0 * k * sin(t * 2.0 + float(i + k_));
      float dist = abs(frag.x - x) / k;
      float on = step(f.y, frag.y);
      glow += (exp(-dist * dist * 0.35) + exp(-dist * 0.12) * 0.15) * on;
    }
    float dot_ = length(frag - f.xy) / k;
    glow += exp(-dot_ * dot_ / 60.0) * 1.5;
  }
  float pulse = 0.85 + 0.15 * sin(t * 5.0 + frag.y * 0.02);
  vec3 col = mix(uColA, vec3(1.0), clamp(glow - 0.8, 0.0, 1.0)) * glow * pulse * smoothstep(0.0, 0.8, t);
  fragColor = vec4(col * uActive, 0.0);
}
`;

// --- Snakes ---------------------------------------------------------------------
// Snakes slithering out of the anchor along uDir. uVariant = snake count
// bias (0: a few, 1: many, 2: one giant summon).
export const SNAKES_FRAG_SRC = PRELUDE + `
void main() {
  vec2 p = dirP(localP());
  float t = uTime;
  vec3 col = vec3(0.0);
  float a = 0.0;
  int count = uVariant < 0.5 ? 3 : (uVariant < 1.5 ? 5 : 1);
  float scale = uVariant > 1.5 ? 1.7 : 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= count) break;
    float fi = float(i);
    float spread = count == 1 ? 0.0 : (fi / float(count - 1) - 0.5) * 1.5;
    vec2 q = rot(-spread * 0.7) * p / scale;
    float len = mix(2.2, 3.2, hash1(fi + uSeed)) * smoothstep(0.0, 1.4, t - fi * 0.12) * (count == 1 ? 0.55 : 1.0);
    if (len < 0.05) continue;
    float s = q.x;
    float ph = t * 5.0 + fi * 2.0;
    float amp = 0.24 * smoothstep(0.0, 1.0, s) * smoothstep(len + 0.2, len - 0.6, s);
    float wave = sin(s * 2.8 - ph) * amp;
    float w = 0.16 * smoothstep(-0.1, 0.35, s) * mix(1.0, 0.75, s / max(len, 0.01));
    float dy = q.y - wave;
    float bodyD = max(abs(dy) - w, max(-s, s - len));
    // Wedge-shaped head, aimed along the body's last heading.
    float headY = sin(len * 2.8 - ph) * 0.24 * smoothstep(0.0, 1.0, len) * 0.4;
    vec2 hp = vec2(s - len, q.y - headY);
    float headD = length(hp / vec2(0.34, 0.2 - hp.x * 0.12)) - 1.0;
    headD *= 0.18;
    float d = min(bodyD, headD);
    float m = smoothstep(0.012, -0.012, d);
    // Forked tongue flicking in and out.
    float flick = step(0.5, fract(t * 1.6 + fi * 0.37));
    vec2 tp = hp - vec2(0.33, 0.0);
    float tongue = flick * step(0.0, tp.x) * step(tp.x, 0.28) *
      smoothstep(0.018, 0.0, abs(abs(tp.y) - max(tp.x - 0.18, 0.0) * 0.6));
    if (m <= 0.0 && tongue <= 0.0) continue;
    // Diamond scale pattern along the back, pale belly.
    vec2 sg = vec2(s * 9.0, dy / max(w, 0.01) * 2.0);
    float diamond = smoothstep(0.55, 0.45, abs(fract(sg.x + sg.y * 0.5) - 0.5) + abs(fract(sg.x - sg.y * 0.5) - 0.5));
    float belly = smoothstep(0.1, -0.7, dy / max(w, 0.01));
    vec3 sc = mix(uColA, uColA * 0.55, diamond * 0.55);
    sc = mix(sc, uColB, belly * 0.8 * step(bodyD, headD));
    sc *= 0.65 + 0.35 * cos(dy / max(w, 0.01) * 1.4);
    // Head: eyes with slit pupils.
    vec2 eyeP = vec2(hp.x - 0.06, abs(hp.y) - 0.1);
    float eye = smoothstep(0.045, 0.03, length(eyeP)) * step(headD, bodyD);
    sc = mix(sc, vec3(1.0, 0.82, 0.1), eye);
    sc = mix(sc, vec3(0.0), eye * smoothstep(0.012, 0.004, abs(eyeP.x)));
    // Ink outline.
    sc = mix(sc, vec3(0.03), smoothstep(-0.03, -0.006, d) * m);
    sc = mix(sc, vec3(0.85, 0.08, 0.1), tongue * (1.0 - m));
    m = max(m, tongue);
    col = mix(col, sc, m);
    a = max(a, m);
  }
  fragColor = vec4(col * uActive, a * uActive);
}
`;

// --- Face markings ----------------------------------------------------------------
// 0: Sage Mode (toad pigment + toad eyes)   1: Byakugo seal (forehead diamond
// + spreading lines)   2: Snake Sage (purple eye markings)   3: Byakugan veins
export const FACEMARK_FRAG_SRC = PRELUDE + `
uniform vec3 uEyeL;      // GL px x, y, eye width
uniform vec3 uEyeR;
uniform vec3 uForehead;  // GL px x, y, face width
void main() {
  vec2 frag = gl_FragCoord.xy;
  float t = uTime;
  float ramp = smoothstep(0.0, 1.0, t) * uActive;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int k = 0; k < 2; k++) {
    vec3 eye = k == 0 ? uEyeL : uEyeR;
    vec2 d = (frag - eye.xy) / max(eye.z, 1.0);
    if (uVariant < 0.5 || (uVariant > 1.5 && uVariant < 2.5)) {
      // Pigment patch above/around the eye (toad) or swept outward (snake).
      vec2 q = d - vec2(0.0, 0.35);
      if (uVariant > 1.5) q = d - vec2(sign(d.x) * 0.3, 0.2);
      float patch_ = smoothstep(1.0, 0.85, length(q * vec2(0.9, 1.5)));
      float eyeHole = smoothstep(0.42, 0.55, length(d * vec2(1.0, 1.8)));
      float m = patch_ * eyeHole;
      col = mix(col, uColA, m * 0.85);
      a = max(a, m * 0.75);
      // Horizontal toad / slit snake pupil glow on the iris.
      float iris = smoothstep(0.24, 0.18, length(d));
      float pupil = uVariant < 0.5 ? smoothstep(0.05, 0.02, abs(d.y)) : smoothstep(0.05, 0.02, abs(d.x));
      vec3 ic = mix(uColB, vec3(0.0), pupil);
      col = mix(col, ic, iris);
      a = max(a, iris * 0.9);
    } else if (uVariant > 2.5) {
      // Bulging veins radiating toward the temples.
      float ang = atan(d.y, d.x);
      float r = length(d);
      float outward = sign(d.x) * (k == 0 ? 1.0 : 1.0);
      float veins = 0.0;
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        float va = (fi / 6.0 - 0.5) * 2.4 + (d.x > 0.0 ? 0.0 : 3.1416);
        float wig = (noise(vec2(r * 6.0, fi + float(k) * 9.0)) - 0.5) * 0.35;
        float da = abs(fract((ang - va - wig) / 6.2831 + 0.5) - 0.5) * 6.2831 * r;
        veins += smoothstep(0.07, 0.02, da) * smoothstep(0.45, 0.6, r) * smoothstep(1.7, 0.9, r);
      }
      // Only toward the temples, never across the nose.
      float side = sign(eye.x - uForehead.x);
      veins *= smoothstep(-0.2, 0.25, d.x * side / max(r, 1e-3)) * abs(outward);
      col = mix(col, uColA, clamp(veins, 0.0, 1.0) * 0.8);
      a = max(a, clamp(veins, 0.0, 1.0) * 0.85);
    }
  }
  if (uVariant > 0.5 && uVariant < 1.5) {
    vec2 f = (frag - uForehead.xy) / max(uForehead.z, 1.0);
    vec2 fd = abs(f);
    float diamond = smoothstep(0.075, 0.06, fd.x + fd.y * 0.75);
    col = mix(col, uColA, diamond);
    a = max(a, diamond * 0.95);
    // Seal lines spreading down and out across the face.
    float spread = smoothstep(0.0, 2.5, t);
    float lines = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 dir = normalize(vec2((fi / 5.0 - 0.5) * 2.0, -1.0 + abs(fi / 5.0 - 0.5)));
      vec2 end = dir * 0.9 * spread;
      lines += smoothstep(0.012, 0.0, sdSeg(f, vec2(0.0), end) - 0.0);
    }
    lines *= smoothstep(0.06, 0.09, length(f));
    col = mix(col, uColA * 0.8, clamp(lines, 0.0, 1.0));
    a = max(a, clamp(lines, 0.0, 1.0) * 0.8);
  }
  fragColor = vec4(col * ramp, a * ramp);
}
`;
