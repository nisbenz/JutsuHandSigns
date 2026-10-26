import { PRELUDE, VIDEO } from "./extra.js";

// Signature effects: one-off visuals for jutsu that used to share a generic
// family (clones, mind jutsu, summons, Samehada). Same contract as extra.js:
// rgb is premultiplied glow, alpha is occlusion of the camera feed.

// --- Video clones --------------------------------------------------------------
// Copies of the player, cut out of the live feed with a soft head+torso mask
// and placed either side of them. Anchor: torso.
// 0: Shadow Clone (true copies)   1: Wood Clone (bark-grained copies)
// 2: Beast Human Clone (feral, fur-streaked)   3: Paper Clone (paper mosaic)
export const CLONE_FRAG_SRC = PRELUDE + VIDEO + `
// Rough person silhouette in torso units (see renderer: torso scale is
// ~1.8x shoulder width; head sits ~0.6 units above the torso point).
float personMask(vec2 q) {
  float head = length((q - vec2(0.0, 0.62)) / vec2(0.2, 0.27));
  float body = length((q - vec2(0.0, -0.15)) / vec2(0.42, 0.62));
  float neck = length((q - vec2(0.0, 0.36)) / vec2(0.12, 0.14));
  float m = min(min(head, body), neck);
  m += (fbm(q * 6.0 + uTime * 0.6) - 0.5) * 0.18;
  return smoothstep(1.0, 0.82, m);
}
void main() {
  vec2 p = localP();
  float t = uTime;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1.0 : 1.0;
    float delay = float(i) * 0.25;
    float appear = smoothstep(0.25 + delay, 0.75 + delay, t);
    vec2 off = vec2(side * 0.8, -0.04);
    vec2 q = p - off;
    float m = personMask(q) * appear;
    if (m <= 0.002) continue;
    vec2 srcPx = gl_FragCoord.xy - off * uHandScale;
    vec3 v = sampleVideo(srcPx);
    float l = dot(v, vec3(0.299, 0.587, 0.114));
    vec3 c = v;
    if (uVariant > 0.5 && uVariant < 1.5) {
      float grain = fbm(vec2(q.x * 14.0, q.y * 2.5)) * 0.6 + fbm(q * 30.0) * 0.4;
      vec3 bark = mix(uColA * 0.55, uColA * 1.25, grain);
      c = mix(v, bark * (0.5 + l * 1.1), 0.7);
    } else if (uVariant > 1.5 && uVariant < 2.5) {
      float fur = fbm(vec2(q.x * 40.0, q.y * 8.0 + q.x * 6.0));
      c = mix(v, vec3(l) * uColA * 1.5, 0.65) * (0.75 + 0.5 * fur);
      // Feral red eyes.
      vec2 e = vec2(abs(q.x) - 0.075, q.y - 0.66);
      c += vec3(1.0, 0.15, 0.05) * exp(-dot(e, e) * 6000.0) * 1.5;
    } else if (uVariant > 2.5) {
      vec2 cell = floor(q * 16.0);
      vec2 cf = fract(q * 16.0);
      float h = hash(cell + 3.1);
      // Cells peel away and flutter off over time.
      float lose = step(1.0 - smoothstep(2.5, 6.0, t) * 0.5, h);
      vec2 cellPx = (off + (cell + 0.5) / 16.0) * uHandScale + uHandPos;
      vec3 cv = sampleVideo(cellPx - off * uHandScale);
      float cl = dot(cv, vec3(0.299, 0.587, 0.114));
      float edge = smoothstep(0.0, 0.08, min(min(cf.x, cf.y), min(1.0 - cf.x, 1.0 - cf.y)));
      c = mix(uColA * (0.72 + 0.3 * cl), cv, 0.22) * (0.8 + 0.2 * edge);
      m *= 1.0 - lose;
    } else {
      c = mix(v, vec3(l), 0.15) * 0.95;
    }
    // Chakra rim so the copies read as summoned, not as a glitch.
    float rim = m * (1.0 - smoothstep(0.0, 0.5, m)) * 2.0;
    c += uColB * rim * 0.6;
    col = mix(col, c, m);
    a = max(a, m);
  }
  fragColor = vec4(col * a * uActive, a * uActive);
}
`;

// --- Yamanaka mind jutsu --------------------------------------------------------
// 0: Mind Body Switch - Ino's diamond hand-seal frame + soul projectile
// 1: Mind Destruction - psychic glitch tearing the picture apart
// 2: Mind Transmission - telepathic network radiating from the head
export const MIND_FRAG_SRC = PRELUDE + VIDEO + `
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = localP();
  float t = uTime;
  float ramp = smoothstep(0.0, 0.8, t) * uActive;
  if (uVariant < 0.5) {
    vec3 col = vec3(0.0);
    // Diamond frame between the hands.
    float dia = abs(abs(p.x) * 0.8 + abs(p.y) - 0.55);
    float frame = exp(-dia * dia * 900.0) * 1.4 + exp(-dia * dia * 60.0) * 0.25;
    col += uColA * frame;
    // Soul projectile: launches from the frame, flies off and repeats.
    float cyc = mod(t, 2.2);
    float k = smoothstep(0.3, 2.0, cyc);
    vec2 dir = normalize(vec2(sin(floor(t / 2.2) * 2.3) * 0.8, 1.0));
    vec2 head = dir * k * 4.0;
    float along = dot(p, dir);
    float perp = length(p - dir * along);
    float trail = exp(-perp * perp * 120.0) * step(0.0, along) * step(along, k * 4.0) * smoothstep(0.0, k * 4.0, along);
    float orb = exp(-dot(p - head, p - head) * 30.0);
    float wisp = fbm(vec2(along * 4.0 - t * 6.0, perp * 10.0));
    col += uColB * (orb * 2.5 + trail * (0.6 + wisp)) * (1.0 - smoothstep(1.8, 2.2, cyc));
    fragColor = vec4(col * ramp, 0.0);
    return;
  }
  if (uVariant < 1.5) {
    // Glitch bands: horizontal slices shoved sideways, RGB split, scanlines;
    // strongest near the anchor and pulsing.
    float r = length(p);
    float pulse = 0.55 + 0.45 * sin(t * 5.0);
    float strength = ramp * exp(-r * 0.35) * pulse;
    float band = floor(frag.y / (uResolution.y * 0.035) + floor(t * 9.0) * 3.7);
    float shove = (hash(vec2(band, floor(t * 9.0))) - 0.5) * step(0.6, hash(vec2(band * 1.3, floor(t * 7.0))));
    vec2 off = vec2(shove * uResolution.x * 0.08 * strength, 0.0);
    float split = 6.0 * strength * (uResolution.y / 720.0);
    vec3 v;
    v.r = sampleVideo(frag + off + vec2(split, 0.0)).r;
    v.g = sampleVideo(frag + off).g;
    v.b = sampleVideo(frag + off - vec2(split, 0.0)).b;
    float scan = 0.85 + 0.15 * sin(frag.y * 1.6 + t * 40.0);
    vec3 col = mix(v, v * uColA * 1.8, 0.35 * strength) * mix(1.0, scan, strength);
    col += uColB * pow(0.5 + 0.5 * sin(r * 6.0 - t * 8.0), 10.0) * strength * 0.5;
    fragColor = vec4(col * ramp, ramp);
    return;
  }
  // Telepathic network: lines from the head out to nodes around the frame,
  // with pulses running outward along them.
  vec3 col = vec3(0.0);
  float aspect = uResolution.x / uResolution.y;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float ang = fi / 9.0 * 6.2831 + 0.35;
    float dist = mix(1.6, 2.8, hash1(fi * 3.3));
    vec2 node = vec2(cos(ang) * aspect, sin(ang)) * dist;
    float grow = smoothstep(fi * 0.08, fi * 0.08 + 0.8, t);
    vec2 end = mix(normalize(node) * 0.6, node, grow);
    // Lines start at the edge of the head so they don't cross the face.
    vec2 root = normalize(node) * 0.6;
    float d = sdSeg(p, root, mix(root, node, grow));
    float line = exp(-d * d * 900.0) * 0.9 + exp(-d * d * 40.0) * 0.12;
    vec2 ab = end - root;
    float along = clamp(dot(p - root, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float pulse = exp(-pow(fract(along - t * 0.9 + hash1(fi)) - 0.5, 2.0) * 200.0) * exp(-d * d * 300.0);
    float nodeGlow = exp(-dot(p - end, p - end) * 50.0) * grow;
    col += uColA * line + uColB * (pulse * 1.6 + nodeGlow * 1.4);
  }
  // Halo ringing the head rather than a blob over the face.
  col += uColB * exp(-pow(length(p) - 0.6, 2.0) * 60.0) * (0.6 + 0.2 * sin(t * 6.0));
  fragColor = vec4(col * ramp, 0.0);
}
`;

// --- Samehada -------------------------------------------------------------------
// Kisame's sword: a bandaged, scale-covered club blade held along uDir, with
// chakra being drained into it. Anchor: hand.
export const SWORD_FRAG_SRC = PRELUDE + `
void main() {
  vec2 p = dirP(localP());
  float t = uTime;
  float grow = smoothstep(0.0, 0.6, t);
  float len = 2.5 * grow;
  float s = p.x + 0.35;
  // Blade widens toward a rounded head.
  float w = mix(0.17, 0.42, smoothstep(0.2, len, s));
  float body = max(abs(p.y) - w, -s);
  float tip = length(vec2(s - len, p.y) / vec2(0.35, 1.0)) - w;
  float d = s < len ? body : tip;
  float mask = smoothstep(0.02, -0.02, d);
  // Overlapping scales: offset rows of circles.
  vec2 g = vec2(s * 9.0, p.y * 9.0);
  g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
  vec2 cell = fract(g) - 0.5;
  float scale = smoothstep(0.5, 0.2, length(cell + vec2(0.18, 0.0)));
  vec3 col = mix(uColA * 0.45, uColA * 1.1, scale);
  col *= 0.7 + 0.3 * smoothstep(0.0, -w, abs(p.y) - w);
  // Bandage wraps on the lower blade and the hilt.
  float wrap = step(s, len * 0.45) * step(0.5, fract(s * 3.2 + p.y * 1.5));
  col = mix(col, vec3(0.86, 0.84, 0.78) * (0.75 + 0.25 * scale), wrap * 0.9);
  // Spikes poking out of the edges.
  float spikes = smoothstep(0.03, 0.0, abs(p.y) - w - 0.09 * pow(abs(sin(s * 14.0)), 6.0)) * (1.0 - mask) * step(0.2, s) * step(s, len);
  col = mix(col, uColA * 0.6, spikes);
  float a = max(mask, spikes);
  // Chakra drained toward the blade.
  float motes = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float life = fract(t * 0.7 + hash1(fi * 2.7));
    vec2 start = vec2(hash1(fi) * len, (hash1(fi * 5.1) - 0.5) * 3.0);
    vec2 pos = mix(start, vec2(start.x, 0.0), life);
    motes += exp(-dot(p - pos, p - pos) * 300.0) * (1.0 - life);
  }
  vec3 glow = uColB * (motes * 2.0 + exp(-max(d, 0.0) * 12.0) * 0.35 * (0.7 + 0.3 * sin(t * 6.0)));
  fragColor = vec4((col * a + glow * (1.0 - a)) * uActive, a * uActive);
}
`;

// --- Summoned creatures ----------------------------------------------------------
// Rise out of the summoning seal. Anchor: ground.
// 0: giant toad   1: ninja hounds pack
export const SUMMON_FRAG_SRC = PRELUDE + `
float ellipse(vec2 p, vec2 c, vec2 r) { return length((p - c) / r) - 1.0; }
void main() {
  vec2 p = localP();
  float t = uTime;
  float rise = smoothstep(0.5, 1.7, t);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uVariant < 0.5) {
    vec2 q = p - vec2(0.0, mix(-2.4, 0.0, rise));
    float body = ellipse(q, vec2(0.0, 0.95), vec2(1.45, 0.95));
    float eyeL = ellipse(q, vec2(-0.6, 1.72), vec2(0.32, 0.3));
    float eyeR = ellipse(q, vec2(0.6, 1.72), vec2(0.32, 0.3));
    float d = min(body, min(eyeL, eyeR));
    float m = smoothstep(0.02, -0.02, d);
    float warts = smoothstep(0.62, 0.75, fbm(q * 5.0));
    vec3 skin = mix(uColA, uColA * 0.55, warts);
    skin = mix(skin, uColB, smoothstep(0.4, 0.0, q.y) * 0.6);
    skin *= 0.7 + 0.3 * smoothstep(-0.6, 0.6, q.y - 0.6);
    // Eyes: yellow with horizontal slit pupils.
    vec2 el = (q - vec2(-0.6, 1.74)) / 0.2;
    vec2 er = (q - vec2(0.6, 1.74)) / 0.2;
    float irisL = step(length(el), 1.0);
    float irisR = step(length(er), 1.0);
    vec3 eyeCol = vec3(1.0, 0.82, 0.2);
    skin = mix(skin, eyeCol, max(irisL, irisR));
    skin = mix(skin, vec3(0.02), max(irisL * step(abs(el.y), 0.22), irisR * step(abs(er.y), 0.22)));
    // Wide mouth line.
    float mouth = smoothstep(0.035, 0.0, abs(q.y - 1.05 + 0.25 * q.x * q.x)) * step(abs(q.x), 1.05);
    skin = mix(skin, vec3(0.08, 0.02, 0.02), mouth);
    float outline = smoothstep(-0.06, -0.01, d) * m;
    col = mix(skin, vec3(0.05), outline) * m;
    a = m;
  } else {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float x = (fi - 1.0) * 1.15;
      float sz = i == 1 ? 1.0 : 0.82;
      float r2 = smoothstep(0.5 + fi * 0.2, 1.4 + fi * 0.2, t);
      vec2 q = (p - vec2(x, mix(-2.0, 0.55, r2))) / sz;
      float head = ellipse(q, vec2(0.0, 0.5), vec2(0.42, 0.4));
      float snout = ellipse(q, vec2(0.0, 0.25), vec2(0.24, 0.2));
      vec2 ea = vec2(abs(q.x) - 0.3, q.y - 0.88);
      float ear = max(abs(ea.x) * 1.4 + ea.y * 0.7 - 0.12, -ea.y - 0.12);
      float neck = ellipse(q, vec2(0.0, -0.25), vec2(0.34, 0.6));
      float d = min(min(head, snout), min(ear, neck));
      float m = smoothstep(0.02, -0.02, d);
      if (m <= 0.0) continue;
      vec3 fur = mix(uColA, uColA * 0.6, fi * 0.4) * (0.75 + 0.25 * fbm(q * 10.0));
      fur = mix(fur, vec3(0.92, 0.88, 0.8), smoothstep(0.0, -0.1, snout) * 0.6);
      // Forehead protector band with a metal plate.
      float band = step(abs(q.y - 0.68), 0.06) * step(head, 0.0);
      fur = mix(fur, uColB, band);
      fur = mix(fur, vec3(0.75, 0.78, 0.82), band * step(abs(q.x), 0.12));
      vec2 eye = vec2(abs(q.x) - 0.16, q.y - 0.5);
      fur = mix(fur, vec3(0.02), smoothstep(0.05, 0.035, length(eye)));
      fur = mix(fur, vec3(0.02), smoothstep(0.06, 0.045, length(q - vec2(0.0, 0.33))));
      float outline = smoothstep(-0.05, -0.01, d) * m;
      fur = mix(fur, vec3(0.04), outline);
      col = mix(col, fur, m);
      a = max(a, m);
    }
    col *= step(0.001, a);
  }
  fragColor = vec4(col * uActive, a * uActive);
}
`;
