export const VERT_SRC = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Chidori: crackling electric aura anchored to the hand. Rendered with
// mix-blend-mode: screen over the video, so black == "no effect here".
export const CHIDORI_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;   // pixels, GL (bottom-left origin)
uniform float uHandScale; // px radius of the hand bbox
uniform float uActive;    // 0..1 fade for hand presence

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}

// Real lightning doesn't glide smoothly between shapes, it snaps between
// discrete configurations. Quantizing time into fixed steps per bolt is
// what sells the "electric" read instead of a wobbling blob.
float stepTime(float t, float rate) {
  return floor(t * rate) / rate;
}

float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

// Distance-to-a-single-jagged-bolt field. The bolt is a ray from the hand
// center out along dir, displaced sideways by 1D noise that grows from
// the base and tapers at the tip - the midpoint-displacement look of real
// lightning, evaluated analytically instead of walking a polyline.
float boltMask(vec2 p, float angle0, float len, float amp, float seed, float thickness) {
  vec2 dir = vec2(cos(angle0), sin(angle0));
  vec2 perpDir = vec2(-dir.y, dir.x);
  float s = dot(p, dir);
  float perp = dot(p, perpDir);
  if (s < 0.0 || s > len) return 0.0;
  float sn = s / len;

  float wobble = (noise(vec2(s * 5.5 + seed * 17.0, seed)) - 0.5) * 2.0
               + (noise(vec2(s * 14.0 + seed * 31.0, seed + 5.0)) - 0.5) * 0.6;
  float lateral = wobble * amp * smoothstep(0.0, 0.25, sn);

  float dist = abs(perp - lateral);
  float core = exp(-dist * dist / (thickness * thickness));
  float glow = exp(-dist * dist / (thickness * thickness * 10.0)) * 0.35;

  float baseFade = smoothstep(0.0, 0.06, sn);
  float tipFade = smoothstep(1.0, 0.7, sn);
  return (core + glow) * baseFade * tipFade;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);
  float d = length(p);
  float t = uTime;

  float bolts = 0.0;
  const int BOLT_COUNT = 9;
  for (int i = 0; i < BOLT_COUNT; i++) {
    float fi = float(i);
    // Each bolt flickers (re-jitters angle/length) on its own cadence so
    // they don't all snap in sync.
    float rate = mix(5.0, 11.0, hash1(fi * 3.1 + 0.4));
    float seedT = stepTime(t, rate) + fi * 101.7;

    float baseAngle = fi * (6.2831 / float(BOLT_COUNT));
    float angle0 = baseAngle + (hash1(seedT) - 0.5) * 1.1;
    float len = mix(1.3, 2.6, hash1(seedT * 1.37 + fi));
    float amp = mix(0.22, 0.5, hash1(seedT * 2.11 + fi));

    bolts += boltMask(p, angle0, len, amp, seedT + fi * 7.0, 0.045);
  }
  bolts = clamp(bolts, 0.0, 1.6);

  // Tight ambient halo right at the hand only - a wide soft wash is what
  // reads as a "filter", so keep this small and let the bolts carry the
  // rest of the silhouette.
  float haloCore = exp(-d * d * 22.0);
  float haloSoft = exp(-d * d * 5.0) * 0.18;
  float flicker = 0.88 + 0.12 * noise(vec2(t * 26.0, 0.0));

  float intensity = (bolts + haloCore * 2.4 + haloSoft) * flicker;
  intensity *= uActive;

  vec3 white = vec3(0.96, 0.99, 1.0);
  vec3 cyan = vec3(0.4, 0.82, 1.0);
  vec3 deepBlue = vec3(0.1, 0.32, 0.9);

  vec3 color = mix(deepBlue, cyan, clamp(bolts * 1.6, 0.0, 1.0));
  color = mix(color, white, clamp(haloCore * 2.0 + bolts * 0.4, 0.0, 1.0));
  color *= intensity;

  // Alpha here means "occlusion" in the composite pass, not opacity - the
  // bolts are a pure additive glow on top of the video, never blocking it.
  fragColor = vec4(color, 0.0);
}
`;

// Rasengan: fully procedural compressed-chakra sphere. A dense white core,
// sharp high-frequency counter-rotating filaments (not a smooth gradient),
// a hard containment shell, and 2-3 whipping orbital ribbons tearing just
// outside it. White -> cyan -> cobalt ramp.
//
// Sizing: uHandScale is the wrist-to-middle-fingertip span (times 1.6, see
// main.js) - i.e. close to the whole hand's length, not the palm's width.
// A grapefruit-sized Rasengan resting in the palm is a fraction of that
// span, so the radius multiplier below is well under 1, unlike every other
// hand-anchored effect in this file (which size relative to the same
// uHandScale but are meant to loom larger than the hand itself).
export const ORB_FRAG_SRC = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uHandPos;    // bottom-origin GL px
uniform float uHandScale; // px, ~wrist-to-fingertip hand span
uniform float uActive;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// One streak whipping around the perimeter, same analytic-ray trick used by
// the other effects' bolt/debris masks but bent into an arc instead of a
// straight ray.
float ribbon(vec2 p, float radius, float speed, float seed, float thickness) {
  float ang = atan(p.y, p.x) - uTime * speed + seed;
  float wrapped = fract(ang / 6.2831 + 0.5) - 0.5; // -0.5..0.5 arc fraction
  float arcLen = mix(0.12, 0.22, hash(vec2(seed, 1.0)));
  float along = smoothstep(0.0, arcLen, 0.0 - wrapped) * smoothstep(0.0, arcLen, wrapped + arcLen);
  float radialDist = abs(length(p) - radius);
  float core = exp(-radialDist * radialDist / (thickness * thickness));
  return core * along;
}

void main() {
  // Grapefruit-sized: a fraction of the wrist-to-fingertip hand span, not a
  // multiple of it. r == 1.0 is the sphere's hard outer edge.
  const float ORB_RADIUS_MULT = 0.42;
  vec2 p = (gl_FragCoord.xy - uHandPos) / (uHandScale * ORB_RADIUS_MULT);
  float r = length(p);
  float t = uTime;

  if (r > 1.2) {
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // --- Multi-axis swirling filaments: two counter-rotating high-frequency --
  // --- noise fields, multiplied and powered into sharp chaotic strands -----
  float angle = atan(p.y, p.x);
  float swirl1 = noise(vec2(angle * 4.0 / 6.2831 - t * 2.0, r * 7.0 - t * 0.7));
  float swirl2 = noise(vec2(angle * -6.0 / 6.2831 + t * 2.6, r * 9.0 + t * 1.0));
  float filaments = pow(clamp(swirl1 * swirl2 * 1.8, 0.0, 1.0), 1.6) * 2.2;
  filaments *= smoothstep(1.05, 0.2, r); // confined inside the sphere

  // --- Dense white core: tight, fast falloff -----------------------------
  float core = smoothstep(0.32, 0.03, r);

  // --- Containment shell: the sphere's outer boundary, still sharp -------
  float shell = smoothstep(1.0, 0.88, r) * smoothstep(0.75, 0.92, r);

  // --- Whispy orbital ribbons tearing free outside the main sphere -------
  float ribbons = ribbon(p, 1.08, 2.6, 0.0, 0.05)
                + ribbon(p, 1.18, -1.9, 17.3, 0.045)
                + ribbon(p, 1.02, 3.3, 42.1, 0.04);
  ribbons *= smoothstep(1.2, 0.95, r); // only visible near/outside the edge

  // --- Chakra ramp: white core -> electric cyan body -> deep cobalt rim --
  vec3 white = vec3(1.0, 1.0, 1.0) * 2.2; // HDR, blown out for bloom
  vec3 cyan = vec3(0.0, 0.784, 1.0);
  vec3 azure = vec3(0.0, 0.47, 1.0);
  vec3 cobalt = vec3(0.04, 0.1, 0.4);

  vec3 body = mix(cyan, azure, clamp((r - 0.25) / 0.45, 0.0, 1.0));
  body = mix(body, cobalt, clamp((r - 0.7) / 0.3, 0.0, 1.0));

  // The filaments ARE the body here, not a brightness ripple on a filled
  // disc - outside them the body all but disappears, so gaps read as
  // transparent whirl rather than a solid tinted circle.
  vec3 color = body * (filaments * 0.9 + core * 0.3);
  color = mix(color, white, core);
  color += cyan * shell * 0.9;
  color += vec3(0.6, 0.9, 1.0) * ribbons * 1.6;

  float sphereMask = smoothstep(1.2, 1.0, r);
  color *= sphereMask * uActive;

  // Alpha tracks the same filament/core/shell pattern as the color (not a
  // filled disc), so gaps between strands show the video through, not a
  // tinted haze - "transparent whirling strands", not a solid gradient.
  float alpha = clamp(core * 0.9 + filaments * 0.5 + shell * 0.8 + ribbons * 0.4, 0.0, 1.0);
  alpha *= sphereMask * uActive;

  fragColor = vec4(color, alpha);
}
`;

// Susanoo: a giant translucent ribcage/spine figure built from SDF line
// segments (same "distance field over a few primitives" trick as chidori's
// boltMask), looming far larger than the hand-anchored effects. No pose
// model is available in this lab, so it anchors off the single tracked hand
// and treats that point as roughly chest height, scaling way up from there -
// see the main.js comment next to the susanoo branch for the reasoning.
// Alpha is forced to 0 everywhere (same "pure additive glow" contract as
// chidori) so the camera feed is NEVER occluded - this is the whole point:
// the person must stay clearly visible "inside" the ribcage, not hidden
// behind a sprite. Keep per-line brightness modest so it reads as a ghostly
// energy outline, not a solid cutout.
export const SUSANOO_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;    // pixels, GL (bottom-left origin) - treated as chest anchor
uniform float uHandScale; // px radius of the hand bbox
uniform float uActive;    // 0..1 fade for hand presence

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// Distance from p to the segment a-b - the one primitive the whole figure
// (spine, ribs, skull, arms) is built out of.
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float lineMask(vec2 p, vec2 a, vec2 b, float thickness) {
  float d = sdSegment(p, a, b);
  float core = exp(-d * d / (thickness * thickness));
  float glow = exp(-d * d / (thickness * thickness * 14.0)) * 0.3;
  return core + glow;
}

float circleMask(vec2 p, vec2 c, float r, float thickness) {
  float d = abs(length(p - c) - r);
  return exp(-d * d / (thickness * thickness));
}

void main() {
  // Local space: chest-anchored, scaled WAY beyond the hand radius so the
  // figure looms over the whole body rather than sitting in the palm.
  const float BODY_SCALE = 9.0;
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale * BODY_SCALE, 1.0);
  float t = uTime;

  float lines = 0.0;

  // Spine, running from the skull base down past the bottom of the frame.
  lines += lineMask(p, vec2(0.0, 2.05), vec2(0.0, -3.0), 0.025);

  // Skull: a rough ribcage-topping skull outline (circle + jaw V).
  vec2 skullC = vec2(0.0, 2.55);
  lines += circleMask(p, skullC, 0.42, 0.03) * 0.9;
  lines += lineMask(p, skullC + vec2(0.0, -0.3), skullC + vec2(-0.22, -0.62), 0.028);
  lines += lineMask(p, skullC + vec2(0.0, -0.3), skullC + vec2(0.22, -0.62), 0.028);
  // Horn-like crest, echoing Susanoo's helmet silhouette.
  lines += lineMask(p, skullC + vec2(-0.2, 0.28), skullC + vec2(-0.55, 0.85), 0.022);
  lines += lineMask(p, skullC + vec2(0.2, 0.28), skullC + vec2(0.55, 0.85), 0.022);

  // Ribcage: a handful of paired bracket-shaped ribs bowing out from the
  // spine then back in toward a sternum line, stacked top to bottom.
  const int RIB_COUNT = 6;
  for (int i = 0; i < RIB_COUNT; i++) {
    float fi = float(i);
    float frac = fi / float(RIB_COUNT - 1); // 0 at top rib, 1 at bottom rib
    float yTop = mix(1.55, -0.95, frac);
    float yBot = yTop - mix(0.18, 0.34, frac);
    float outX = mix(0.55, 1.35, sin(frac * 3.14159)); // widest around the middle
    float inX = 0.12;

    // Left side.
    lines += lineMask(p, vec2(0.0, yTop), vec2(-outX, yTop - 0.12), 0.02);
    lines += lineMask(p, vec2(-outX, yTop - 0.12), vec2(-inX, yBot), 0.02);
    // Right side (mirrored).
    lines += lineMask(p, vec2(0.0, yTop), vec2(outX, yTop - 0.12), 0.02);
    lines += lineMask(p, vec2(outX, yTop - 0.12), vec2(inX, yBot), 0.02);
  }

  // Wide, bent arms looming outward - the classic Susanoo wide-armed pose.
  vec2 shoulderL = vec2(-0.62, 1.45);
  vec2 shoulderR = vec2(0.62, 1.45);
  vec2 elbowL = vec2(-2.1, 0.55);
  vec2 elbowR = vec2(2.1, 0.55);
  vec2 handL = vec2(-1.75, -0.75);
  vec2 handR = vec2(1.75, -0.75);
  lines += lineMask(p, shoulderL, elbowL, 0.03);
  lines += lineMask(p, elbowL, handL, 0.03);
  lines += lineMask(p, shoulderR, elbowR, 0.03);
  lines += lineMask(p, elbowR, handR, 0.03);

  lines = clamp(lines, 0.0, 1.8);

  // Faint overall chest-cavity fill so the ribcage reads as an enclosing
  // volume, not just outlines - kept very weak so it never looks solid.
  float torsoFill = exp(-dot(p - vec2(0.0, 0.5), p - vec2(0.0, 0.5)) * 0.35) * 0.08;

  float flicker = 0.9 + 0.1 * noise(vec2(t * 3.0, p.y * 2.0));
  float intensity = (lines + torsoFill) * flicker * uActive;

  vec3 purple = vec3(0.5, 0.22, 0.95);
  vec3 cyan = vec3(0.35, 0.78, 1.0);
  vec3 white = vec3(0.9, 0.95, 1.0);

  vec3 color = mix(purple, cyan, clamp(p.y * 0.3 + 0.5, 0.0, 1.0));
  color = mix(color, white, clamp(lines * 0.5, 0.0, 1.0));
  // Deliberately dim - this is meant to be a translucent ghost overlay, not
  // a bright solid figure; the person standing "inside" it must stay readable.
  color *= intensity * 0.55;

  // Alpha forced to 0: pure additive glow, camera is never occluded. This
  // is what satisfies the "must see myself inside the Susanoo" requirement.
  fragColor = vec4(color, 0.0);
}
`;

// Deidara: Exploding Clay. The bird is REAL 3D geometry - a raymarched SDF
// scene (smooth-min blended sphere/box/capsule primitives), not a flat
// screen-space sprite: it starts as melted spheres and sharpens into a bird
// as blobK tightens, shaded with a computed surface normal (Lambert + rim).
// The palm mouth and the post-detonation fireball stay flat 2D overlays on
// purpose - raymarching a volumetric fire per pixel is far too costly for a
// realtime lab pass, and a 2D radial FBM sells the same read for much less.
export const CLAY_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;
uniform float uHandScale;
uniform float uActive;

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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// One streak of flying debris, same analytic-ray trick as chidori's bolt
// mask: a ray from the blast center, noise-displaced, that grows outward
// over the explosion phase and fades at both ends.
float debrisMask(vec2 p, float angle0, float len, float seed, float thickness) {
  vec2 dir = vec2(cos(angle0), sin(angle0));
  vec2 perpDir = vec2(-dir.y, dir.x);
  float s = dot(p, dir);
  float perp = dot(p, perpDir);
  if (s < 0.0 || s > len || len <= 0.0) return 0.0;
  float sn = s / len;
  float wobble = (noise(vec2(s * 6.0 + seed * 13.0, seed)) - 0.5) * 0.5;
  float dist = abs(perp - wobble);
  float core = exp(-dist * dist / (thickness * thickness));
  float baseFade = smoothstep(0.0, 0.08, sn);
  float tipFade = smoothstep(1.0, 0.55, sn);
  return core * baseFade * tipFade;
}

// --- Raymarched clay bird: smooth-min blended SDF primitives --------------
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Torso + head + wings (flattened boxes that flap) + tail + beak, all
// smooth-min blended - blobK controls how "melted together" they still look.
float birdMap(vec3 p, float blobK, float wingBlend, float flapAngle) {
  float torso = sdSphere(p, 1.0);
  float head = sdSphere(p - vec3(0.0, 0.95, 0.35), 0.48);
  float d = smin(torso, head, blobK);

  float cf = cos(flapAngle);
  float sf = sin(flapAngle);
  vec3 pL = p - vec3(-0.85, 0.05, 0.0);
  pL.xz = mat2(cf, -sf, sf, cf) * pL.xz;
  float wingL = sdRoundBox(pL, vec3(0.95, 0.1, 0.5), 0.08);
  d = smin(d, wingL, wingBlend);

  vec3 pR = p - vec3(0.85, 0.05, 0.0);
  pR.xz = mat2(cf, sf, -sf, cf) * pR.xz;
  float wingR = sdRoundBox(pR, vec3(0.95, 0.1, 0.5), 0.08);
  d = smin(d, wingR, wingBlend);

  float tail = sdRoundBox(p - vec3(0.0, -0.95, -0.05), vec3(0.14, 0.45, 0.14), 0.06);
  d = smin(d, tail, blobK);

  float beak = sdCapsule(p, vec3(0.0, 1.25, 0.35), vec3(0.0, 1.65, 0.35), 0.07);
  d = smin(d, beak, blobK * 0.6);

  return d;
}

vec3 birdNormal(vec3 p, float blobK, float wingBlend, float flapAngle) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    birdMap(p + e.xyy, blobK, wingBlend, flapAngle) - birdMap(p - e.xyy, blobK, wingBlend, flapAngle),
    birdMap(p + e.yxy, blobK, wingBlend, flapAngle) - birdMap(p - e.yxy, blobK, wingBlend, flapAngle),
    birdMap(p + e.yyx, blobK, wingBlend, flapAngle) - birdMap(p - e.yyx, blobK, wingBlend, flapAngle)
  ));
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);

  const float MOUTH_OPEN_END = 0.6;
  const float BIRD_FORM_START = 0.8;
  const float BIRD_FORM_END = 2.0;
  const float MOUTH_CLOSE_START = 1.7;
  const float MOUTH_CLOSE_END = 2.0;
  const float FLASH_START = 2.8;
  const float FLASH_END = 3.0;
  const float CYCLE = 5.4;

  float t = mod(uTime, CYCLE);

  // --- Phase A: a small palm mouth opens (flat, screen-space) ------------
  // Canon-sized: a compact oval slit with teeth and a dark throat, not a
  // wide pair of human lips - the earlier version read as a mouth drawn
  // across the whole hand, which looked wrong at a glance.
  float mouthOpen = smoothstep(0.0, MOUTH_OPEN_END, t)
                   * (1.0 - smoothstep(MOUTH_CLOSE_START, MOUTH_CLOSE_END, t));
  float mouthHalfWidth = 0.3;
  float xw = clamp(p.x / mouthHalfWidth, -1.0, 1.0);
  float parab = 1.0 - xw * xw;
  float mouthHeight = mix(0.012, 0.2, mouthOpen);
  float upperY = mouthHeight * parab;
  float lowerY = -mouthHeight * parab * 0.85;

  float edgeX = smoothstep(mouthHalfWidth + 0.03, mouthHalfWidth - 0.03, abs(p.x));
  float inY = smoothstep(lowerY - 0.025, lowerY + 0.008, p.y)
            * smoothstep(upperY + 0.025, upperY - 0.008, p.y);
  float mouthCavity = edgeX * inY;
  float lipLine = (exp(-pow(p.y - upperY, 2.0) * 420.0)
                 + exp(-pow(p.y - lowerY, 2.0) * 420.0)) * edgeX;
  float seamLine = exp(-p.y * p.y * 420.0) * edgeX * (1.0 - mouthOpen) * 0.6;

  // Small white teeth notches along the gumline once the mouth is open
  // enough to show them.
  float toothPattern = step(0.5, fract(p.x * 12.0 + 0.5));
  float toothBand = (exp(-pow(p.y - (upperY - 0.012), 2.0) * 2200.0)
                    + exp(-pow(p.y - (lowerY + 0.012), 2.0) * 2200.0));
  float teeth = toothBand * toothPattern * edgeX * smoothstep(0.3, 0.6, mouthOpen);

  // Clay-toned mouth, not a vivid human red - a dusty mauve lip and a dark
  // reddish-brown throat.
  vec3 lipColor = vec3(0.5, 0.3, 0.28);
  vec3 cavityColor = vec3(0.1, 0.035, 0.03);
  vec3 teethColor = vec3(0.95, 0.93, 0.88);
  vec3 mouthColor = cavityColor * mouthCavity + lipColor * (lipLine + seamLine) + teethColor * teeth;

  // --- Phase B: raymarch the clay bird, melting from a blob into a -------
  // --- sculpted shape as it forms above the mouth -------------------------
  float formAmt = smoothstep(BIRD_FORM_START, BIRD_FORM_END, t);
  vec2 birdCenter = vec2(0.0, 1.1) * smoothstep(0.0, 1.0, formAmt);
  float birdScale = max(mix(0.025, 0.4, formAmt), 0.001);

  float flapActive = step(BIRD_FORM_END, t) * (1.0 - step(FLASH_START, t));
  float flapAngle = sin(uTime * 13.0) * 0.5 * flapActive;
  float blobK = mix(0.9, 0.22, formAmt);
  float wingBlend = mix(blobK, 0.12, formAmt);

  // birdScale doubles as camera zoom: the object-space blob is fixed size,
  // birdScale controls how much of the screen-space hand-radius it fills.
  vec2 camP = (p - birdCenter) / birdScale;
  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(camP, -2.0));

  float dO = 0.0;
  float dd = 1.0;
  for (int i = 0; i < 40; i++) {
    vec3 pos = ro + rd * dO;
    dd = birdMap(pos, blobK, wingBlend, flapAngle);
    dO += dd;
    if (dd < 0.0015 || dO > 7.0) break;
  }
  float hitMask = 1.0 - smoothstep(0.0, 0.02, dd);

  vec3 birdColor = vec3(0.0);
  if (hitMask > 0.001) {
    vec3 hitP = ro + rd * dO;
    vec3 n = birdNormal(hitP, blobK, wingBlend, flapAngle);
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
    float diff = max(dot(n, lightDir), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    float ripple = fbm(hitP.xy * 3.0 + hitP.z * 2.0 + 7.0) * 0.08;
    // Clay material: off-white diffuse with a warmer shadow tone, faint
    // low-frequency ripple standing in for sculpted vertex noise.
    vec3 base = mix(vec3(0.773, 0.729, 0.635), vec3(0.925, 0.902, 0.847), diff) - ripple;
    birdColor = base + rim * vec3(1.0, 0.95, 0.85) * 0.5;
  }

  // Hidden again once the flash starts - the explosion overlay takes over.
  float birdPresence = formAmt * (1.0 - smoothstep(FLASH_START - 0.1, FLASH_START + 0.1, t));
  float birdMaskTotal = hitMask * birdPresence;

  // --- Phase C: detonation flash + fireball/smoke/debris (flat 2D), --
  // --- centered where the bird was hovering, not the palm -----------------
  vec2 blastCenter = vec2(0.0, 1.1);
  vec2 pe = p - blastCenter;
  float de = length(pe);

  float flashT = smoothstep(FLASH_START, FLASH_START + 0.06, t)
               * (1.0 - smoothstep(FLASH_END, FLASH_END + 0.15, t));
  float flash = exp(-de * de * 3.0) * flashT;

  float boomT = clamp((t - FLASH_END) / (CYCLE - FLASH_END), 0.0, 1.0);
  float fadeOut = 1.0 - smoothstep(0.8, 1.0, boomT);

  // Jagged, animated flame edge (angle-dependent noise on the radius) and
  // internal turbulence instead of a flat solid-color disc - a perfect
  // circle with one flat fill color is what read as "fake" before.
  float ang = atan(pe.y, pe.x);
  float edgeNoise = fbm(vec2(ang * 2.2, boomT * 3.0 + uTime * 0.6) + 10.0);
  float fireRadius = mix(0.12, 0.5, boomT) * (0.7 + 0.6 * edgeNoise);
  float fireCore = smoothstep(fireRadius + 0.06, fireRadius - 0.1, de) * (1.0 - boomT * 0.6) * fadeOut;
  float innerTurb = fbm(pe * 4.0 - uTime * 1.6);
  fireCore *= mix(0.55, 1.0, innerTurb);
  float fireGlow = exp(-de * de * 2.2) * (1.0 - boomT) * fadeOut;

  float smokeRadius = mix(0.18, 2.3, boomT);
  float smokeShell = exp(-pow(de - smokeRadius, 2.0) * 10.0);
  float smokeTexture = fbm(pe * 2.0 + vec2(uTime * 0.3, -uTime * 0.2));
  float smoke = smokeShell * smokeTexture * smoothstep(0.0, 0.3, boomT) * fadeOut;

  // Sparks: tapered (thick at the base, thin at the tip) with a bright
  // ember glow at the flying tip, instead of uniform-width streaks.
  float debris = 0.0;
  const int DEBRIS_COUNT = 14;
  for (int i = 0; i < DEBRIS_COUNT; i++) {
    float fi = float(i);
    float seed = fi * 91.7 + floor(uTime / CYCLE) * 13.0;
    float angle0 = fi * (6.2831 / float(DEBRIS_COUNT)) + (hash1(seed) - 0.5) * 0.4;
    float len = mix(1.0, 2.1, hash1(seed * 1.7)) * boomT;
    float debrisFade = smoothstep(0.0, 0.2, boomT) * (1.0 - smoothstep(0.6, 1.0, boomT));
    if (len <= 0.0) continue;
    vec2 dir = vec2(cos(angle0), sin(angle0));
    vec2 perpDir = vec2(-dir.y, dir.x);
    float s = dot(pe, dir);
    float sn = clamp(s / len, 0.0, 1.0);
    float perp = dot(pe, perpDir);
    float wobble = (noise(vec2(s * 6.0 + seed * 13.0, seed)) - 0.5) * 0.5;
    float taperThick = 0.06 * mix(1.3, 0.3, sn);
    float dist = abs(perp - wobble);
    float core = exp(-dist * dist / (taperThick * taperThick));
    float along = smoothstep(0.0, 0.08, sn) * smoothstep(1.0, 0.55, sn) * step(0.0, len - s);
    float tipGlow = exp(-pow(sn - 0.92, 2.0) * 50.0) * step(s, len);
    debris += (core * along + tipGlow * 1.4) * debrisFade;
  }

  // Fireball color ramp: white core -> electric orange -> dark soot.
  vec3 fireColor = mix(vec3(1.0, 1.0, 0.95), vec3(1.0, 0.541, 0.0), smoothstep(0.0, 0.5, boomT));
  fireColor = mix(fireColor, vec3(0.102), smoothstep(0.5, 1.0, boomT));
  vec3 smokeColor = mix(vec3(0.45, 0.42, 0.4), vec3(0.102), smoothstep(0.3, 1.0, boomT));
  float boomPresence = step(FLASH_END, t);
  vec3 explosionColor = (fireCore + fireGlow + debris) * fireColor + smoke * smokeColor;

  // --- Composite -----------------------------------------------------
  vec3 color = mouthColor;
  color += birdColor * birdMaskTotal;
  color += vec3(1.0, 0.9, 0.7) * flash;
  color += explosionColor * boomPresence;

  // Mouth cavity and the bird's raymarched surface occlude the video a
  // little; the flash/fireball/smoke/debris are pure additive glow, same
  // contract as chidori's bolts, so the person is never hidden by the blast.
  float occlusion = clamp(mouthCavity * 0.6 + birdMaskTotal, 0.0, 1.0);

  fragColor = vec4(color * uActive, occlusion * uActive);
}
`;

// Deidara: C4 Karura. Phases 2 and 3 here (whiteout, shockwave, dissolve)
// are genuinely screen-space/post-process techniques even in full 3D
// engines, so they stay 2D - the upgrade over a single explosion is the
// curled (not dead-straight) spider dispersion, a real chromatic-aberration
// edge fringe during the whiteout, a dissolve-noise break-up on the debris
// with a hot glowing edge, and the white -> orange -> soot color ramp.
export const C4_KARURA_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;
uniform float uHandScale;
uniform float uActive;

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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

float debrisMask(vec2 p, float angle0, float len, float seed, float thickness) {
  vec2 dir = vec2(cos(angle0), sin(angle0));
  vec2 perpDir = vec2(-dir.y, dir.x);
  float s = dot(p, dir);
  float perp = dot(p, perpDir);
  if (s < 0.0 || s > len || len <= 0.0) return 0.0;
  float sn = s / len;
  float wobble = (noise(vec2(s * 6.0 + seed * 13.0, seed)) - 0.5) * 0.5;
  float dist = abs(perp - wobble);
  float core = exp(-dist * dist / (thickness * thickness));
  float baseFade = smoothstep(0.0, 0.08, sn);
  float tipFade = smoothstep(1.0, 0.55, sn);
  return core * baseFade * tipFade;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);
  float d = length(p);

  const float SWARM_END = 1.1;
  const float FLASH_END = 1.4;
  const float CYCLE = 6.0;
  float t = mod(uTime, CYCLE);

  // --- Phase A: micro clay spiders scatter out from the palm, curling as --
  // --- they go instead of flying in dead-straight lines -------------------
  float swarmT = clamp(t / SWARM_END, 0.0, 1.0);
  float spiders = 0.0;
  float vapor = 0.0;
  const int SPIDER_COUNT = 22;
  for (int i = 0; i < SPIDER_COUNT; i++) {
    float fi = float(i);
    float seed = fi * 57.3 + floor(uTime / CYCLE) * 19.0;
    float angle0 = hash1(seed) * 6.2831;
    float speed = mix(1.2, 3.0, hash1(seed * 1.9));
    float curl = (hash1(seed * 2.7) - 0.5) * 3.0;
    float ang = angle0 + curl * swarmT * swarmT;
    vec2 dir = vec2(cos(ang), sin(ang));
    float dist = swarmT * speed;
    vec2 jitter = dir * (noise(vec2(swarmT * 5.0 + seed, 0.0)) - 0.5) * 0.2;
    vec2 pos = dir * dist + jitter;
    float dd2 = dot(p - pos, p - pos);
    spiders += exp(-dd2 * 650.0) * step(t, SWARM_END);
    vapor += exp(-dd2 * 40.0) * step(t, SWARM_END) * 0.15;
  }
  spiders = clamp(spiders, 0.0, 1.5);
  vapor = clamp(vapor, 0.0, 0.5) * (0.5 + 0.5 * fbm(p * 1.5 + uTime * 0.2));
  vec3 spiderColor = vec3(0.925, 0.902, 0.847);
  vec3 vaporColor = vec3(0.6, 0.62, 0.58);

  // --- Phase B: blinding whiteout flash + chromatic edge fringe ----------
  float flashT = smoothstep(SWARM_END, SWARM_END + 0.05, t)
               * (1.0 - smoothstep(FLASH_END, FLASH_END + 0.2, t));
  float flash = mix(exp(-d * d * 0.8), 1.0, 0.4) * flashT;

  vec2 uv = gl_FragCoord.xy / uResolution;
  float edgeDist = length((uv - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0));
  float caFringe = smoothstep(0.35, 0.75, edgeDist) * flashT;
  vec3 caColor = vec3(1.0, 0.3, 0.3) * caFringe * max(uv.x - 0.5, 0.0) * 2.0
               + vec3(0.3, 0.3, 1.0) * caFringe * max(0.5 - uv.x, 0.0) * 2.0;

  // --- Phase C: colossal shockwave + fireball + dust dome -----------------
  float boomT = clamp((t - FLASH_END) / (CYCLE - FLASH_END), 0.0, 1.0);
  float fadeOut = 1.0 - smoothstep(0.85, 1.0, boomT);

  float shockRadius = mix(0.3, 9.0, pow(boomT, 0.6));
  float shockRing = exp(-pow(d - shockRadius, 2.0) * 10.0) * fadeOut;
  // Hot rim right at the dust-dome shell boundary - the disintegration-field
  // edge-glow.
  float domeRim = exp(-pow(d - shockRadius, 2.0) * 60.0) * fadeOut * 1.4;

  float fireRadius = mix(0.2, 3.0, boomT);
  float fireCore = exp(-pow(max(d - fireRadius, 0.0), 2.0) * 10.0) * (1.0 - boomT * 0.7) * fadeOut;
  float fireGlow = exp(-d * d * 0.6) * (1.0 - boomT) * fadeOut;

  float smokeTexture = fbm(p * 1.2 + vec2(uTime * 0.25, -uTime * 0.18));
  float smoke = smokeTexture * smoothstep(0.1, 0.6, boomT) * (1.0 - smoothstep(0.7, 1.0, boomT)) * 0.6;

  // Dissolve-style debris: a noise threshold breaks each streak into
  // cellular chunks instead of one smooth ray, with a hot glowing edge band.
  float debris = 0.0;
  float debrisEdge = 0.0;
  const int DEBRIS_COUNT = 20;
  for (int i = 0; i < DEBRIS_COUNT; i++) {
    float fi = float(i);
    float seed = fi * 73.1 + floor(uTime / CYCLE) * 23.0;
    float angle0 = fi * (6.2831 / float(DEBRIS_COUNT)) + (hash1(seed) - 0.5) * 0.5;
    float len = mix(2.0, 6.0, hash1(seed * 1.3)) * boomT;
    float debrisFade = smoothstep(0.0, 0.2, boomT) * (1.0 - smoothstep(0.6, 1.0, boomT));
    float raw = debrisMask(p, angle0, len, seed, 0.08);
    float dissolve = noise(p * 6.0 + seed);
    debris += raw * step(0.35, dissolve) * debrisFade;
    debrisEdge += raw * smoothstep(0.3, 0.4, dissolve) * (1.0 - smoothstep(0.4, 0.55, dissolve)) * debrisFade;
  }

  // Fireball color ramp: white -> electric orange -> dark soot.
  vec3 fireColor = mix(vec3(1.0, 1.0, 0.95), vec3(1.0, 0.541, 0.0), smoothstep(0.0, 0.5, boomT));
  fireColor = mix(fireColor, vec3(0.102), smoothstep(0.5, 1.0, boomT));
  vec3 smokeColor = mix(vec3(0.6, 0.58, 0.56), vec3(0.102), smoothstep(0.3, 1.0, boomT));
  vec3 hotEdgeColor = vec3(1.0, 0.6, 0.15);

  float boomPresence = step(FLASH_END, t);
  vec3 explosionColor = (fireCore + fireGlow + shockRing + debris) * fireColor
                       + smoke * smokeColor
                       + (domeRim + debrisEdge) * hotEdgeColor;

  vec3 color = spiders * spiderColor + vapor * vaporColor;
  color += vec3(1.0) * flash + caColor;
  color += explosionColor * boomPresence;

  fragColor = vec4(color * uActive, 0.0);
}
`;

// Deidara: Clay Clone. A real raymarched humanoid (smooth-min capsules/
// sphere/box), revealed bottom-up with a height-sweep cutoff as it "grows"
// out of the ground, cracked by a 3D Worley/Voronoi pattern (cylindrically
// unwrapped onto the raymarch hit point) that intensifies as the chakra
// goes critical, then shatters into tumbling 2D chunks (a per-chunk
// raymarch for the shatter would be far too costly for realtime).
export const CLAY_CLONE_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;
uniform float uHandScale;
uniform float uActive;

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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// 2D Worley noise (F1, F2 nearest-feature distances) - the crack pattern on
// the clone's raymarched surface, via a cylindrical UV unwrap of the hit
// point below.
vec2 worley(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(ip + g), hash(ip + g + 17.3));
      vec2 r = g + o - fp;
      float dd = dot(r, r);
      if (dd < f1) { f2 = f1; f1 = dd; }
      else if (dd < f2) { f2 = dd; }
    }
  }
  return vec2(sqrt(f1), sqrt(f2));
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Tapered limbs (upper segment + lower segment + a hand/foot cap) instead
// of uniform-radius capsules - the earlier version read as thick noodle
// limbs on a blocky torso, not a sculpted figure.
float cloneMap(vec3 p, float k) {
  float head = sdSphere(p - vec3(0.0, 1.55, 0.0), 0.3);
  float neck = sdCapsule(p, vec3(0.0, 1.5, 0.0), vec3(0.0, 1.3, 0.0), 0.12);
  float torso = sdRoundBox(p - vec3(0.0, 0.75, 0.0), vec3(0.32, 0.56, 0.2), 0.16);
  float d = smin(head, neck, k * 0.6);
  d = smin(d, torso, k);

  float upperArmL = sdCapsule(p, vec3(-0.34, 1.2, 0.0), vec3(-0.75, 0.6, 0.0), 0.15);
  float foreArmL = sdCapsule(p, vec3(-0.75, 0.6, 0.0), vec3(-0.95, 0.05, 0.05), 0.1);
  float handL = sdSphere(p - vec3(-0.97, -0.05, 0.06), 0.1);
  float armL = smin(smin(upperArmL, foreArmL, k * 0.5), handL, k * 0.4);
  d = smin(d, armL, k);

  float upperArmR = sdCapsule(p, vec3(0.34, 1.2, 0.0), vec3(0.75, 0.6, 0.0), 0.15);
  float foreArmR = sdCapsule(p, vec3(0.75, 0.6, 0.0), vec3(0.95, 0.05, 0.05), 0.1);
  float handR = sdSphere(p - vec3(0.97, -0.05, 0.06), 0.1);
  float armR = smin(smin(upperArmR, foreArmR, k * 0.5), handR, k * 0.4);
  d = smin(d, armR, k);

  float upperLegL = sdCapsule(p, vec3(-0.16, 0.18, 0.0), vec3(-0.2, -0.75, 0.0), 0.18);
  float shinL = sdCapsule(p, vec3(-0.2, -0.75, 0.0), vec3(-0.22, -1.5, 0.0), 0.12);
  float footL = sdRoundBox(p - vec3(-0.24, -1.62, 0.12), vec3(0.1, 0.06, 0.2), 0.05);
  float legL = smin(smin(upperLegL, shinL, k * 0.5), footL, k * 0.4);
  d = smin(d, legL, k);

  float upperLegR = sdCapsule(p, vec3(0.16, 0.18, 0.0), vec3(0.2, -0.75, 0.0), 0.18);
  float shinR = sdCapsule(p, vec3(0.2, -0.75, 0.0), vec3(0.22, -1.5, 0.0), 0.12);
  float footR = sdRoundBox(p - vec3(0.24, -1.62, 0.12), vec3(0.1, 0.06, 0.2), 0.05);
  float legR = smin(smin(upperLegR, shinR, k * 0.5), footR, k * 0.4);
  d = smin(d, legR, k);

  return d;
}

vec3 cloneNormal(vec3 p, float k) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    cloneMap(p + e.xyy, k) - cloneMap(p - e.xyy, k),
    cloneMap(p + e.yxy, k) - cloneMap(p - e.yxy, k),
    cloneMap(p + e.yyx, k) - cloneMap(p - e.yyx, k)
  ));
}

float debrisMask(vec2 p, float angle0, float len, float seed, float thickness) {
  vec2 dir = vec2(cos(angle0), sin(angle0));
  vec2 perpDir = vec2(-dir.y, dir.x);
  float s = dot(p, dir);
  float perp = dot(p, perpDir);
  if (s < 0.0 || s > len || len <= 0.0) return 0.0;
  float sn = s / len;
  float wobble = (noise(vec2(s * 6.0 + seed * 13.0, seed)) - 0.5) * 0.5;
  float dist = abs(perp - wobble);
  float core = exp(-dist * dist / (thickness * thickness));
  float baseFade = smoothstep(0.0, 0.08, sn);
  float tipFade = smoothstep(1.0, 0.55, sn);
  return core * baseFade * tipFade;
}

float chunkMask(vec2 p, vec2 pos, float rot, vec2 size) {
  vec2 lp = p - pos;
  float c = cos(rot);
  float s = sin(rot);
  lp = mat2(c, -s, s, c) * lp;
  vec2 q = abs(lp) - size;
  float dd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return smoothstep(0.03, -0.03, dd);
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);

  const float FORM_END = 1.6;
  const float HOLD_END = 2.4;
  const float FLASH_END = 2.6;
  const float CYCLE = 5.0;
  float t = mod(uTime, CYCLE);

  // Clone stands beside the hand, not on top of it.
  vec2 cloneCenter = vec2(1.6, 0.4);
  vec2 pc = p - cloneCenter;
  float formAmt = smoothstep(0.0, FORM_END, t);
  float cloneScale = max(mix(0.12, 0.42, formAmt), 0.001);

  // Melted and blobby early, sharpens into a defined mannequin by FORM_END -
  // a lower final k gives cleaner limb separation instead of staying fused.
  float blobK = mix(0.75, 0.1, formAmt);
  // Bottom-up reveal: anything above this local-space height hasn't "grown"
  // in yet - a heightmask sweep applied as a raymarch hit cutoff.
  float sweepY = mix(-2.0, 2.1, smoothstep(0.0, FORM_END, t));

  vec2 camP = pc / cloneScale;
  vec3 ro = vec3(0.0, 0.3, 3.4);
  vec3 rd = normalize(vec3(camP, -2.2));

  float dO = 0.0;
  float dd = 1.0;
  for (int i = 0; i < 40; i++) {
    vec3 pos = ro + rd * dO;
    dd = cloneMap(pos, blobK);
    dO += dd;
    if (dd < 0.0015 || dO > 7.0) break;
  }
  vec3 hitP = ro + rd * dO;
  bool hit = dd < 0.02 && hitP.y < sweepY;
  float hitMask = hit ? 1.0 : 0.0;

  vec3 cloneColor = vec3(0.0);
  if (hit) {
    vec3 n = cloneNormal(hitP, blobK);
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
    float diff = max(dot(n, lightDir), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    vec3 base = mix(vec3(0.773, 0.729, 0.635), vec3(0.925, 0.902, 0.847), diff);
    base += rim * 0.12;

    // Cylindrical unwrap of the hit point so a 2D Worley pattern reads as
    // cracks spreading across 3D surface.
    vec2 crackUV = vec2(atan(hitP.x, hitP.z) * 1.6, hitP.y * 2.2);
    vec2 w = worley(crackUV * 3.2);
    float crackDist = w.y - w.x;
    float crackLine = smoothstep(0.07, 0.0, crackDist);

    float intensify = smoothstep(FORM_END, HOLD_END, t);
    float pulse = 0.6 + 0.4 * sin(uTime * 10.0);
    vec3 crackColor = mix(vec3(0.0), mix(vec3(1.0, 0.667, 0.0), vec3(1.0, 1.0, 0.933), pulse), intensify);
    float crackGlowAmt = crackLine * intensify;

    cloneColor = mix(base, crackColor, crackGlowAmt);
  }

  float presence = formAmt * (1.0 - smoothstep(FLASH_END - 0.1, FLASH_END + 0.1, t));
  float cloneMaskTotal = hitMask * presence;

  // --- Detonation flash ---------------------------------------------------
  float de = length(pc);
  float flashT = smoothstep(HOLD_END, HOLD_END + 0.05, t)
               * (1.0 - smoothstep(FLASH_END, FLASH_END + 0.12, t));
  float flash = exp(-de * de * 3.0) * flashT;

  // --- Brittle chunk shatter (2D tumbling boxes, not a per-chunk --
  // --- raymarch - far too costly for realtime) -----------------------------
  float boomT = clamp((t - FLASH_END) / (CYCLE - FLASH_END), 0.0, 1.0);
  float fadeOut = 1.0 - smoothstep(0.8, 1.0, boomT);

  // Chunks were composited with += before: a dozen overlapping pieces near
  // the clone at boomT~0 summed into one blown-out white/orange blob before
  // they'd even separated. mix()-ing each chunk over the last (by its own
  // mask) keeps every chunk its own flat color instead of overflowing, and
  // a fake directional shade + a dark rim gives each piece some depth.
  float chunks = 0.0;
  vec3 chunkColor = vec3(0.0);
  const int CHUNK_COUNT = 12;
  for (int i = 0; i < CHUNK_COUNT; i++) {
    float fi = float(i);
    float seed = fi * 53.1 + floor(uTime / CYCLE) * 11.0;
    float angle0 = fi * (6.2831 / float(CHUNK_COUNT)) + (hash1(seed) - 0.5) * 0.7;
    vec2 size = vec2(mix(0.05, 0.13, hash1(seed * 3.1)), mix(0.04, 0.1, hash1(seed * 4.7)));

    // Real projectile physics, not a decorative radial-slide-plus-fudge:
    // lighter/smaller chunks fly faster and tumble faster, heavier ones
    // lumber and spin slower; the burst direction is biased upward (an
    // explosion throws debris up and out, not straight down) so every
    // chunk arcs over under gravity instead of sliding on rails.
    float massNorm = clamp((size.x * size.y - 0.002) / 0.011, 0.0, 1.0);
    float speed = mix(2.2, 0.8, massNorm);
    vec2 vel0 = normalize(vec2(cos(angle0), sin(angle0) * 0.5 + 0.65)) * speed;
    const float GRAVITY = 3.4;
    float drag = mix(1.0, 0.35, smoothstep(0.0, 1.0, boomT));
    vec2 pos = vec2(vel0.x * boomT * drag, vel0.y * boomT - 0.5 * GRAVITY * boomT * boomT);

    float spinRate = mix(9.0, 2.0, massNorm) * (hash1(seed * 2.3) - 0.5) * 2.0;
    float rot = seed * 6.0 + uTime * spinRate;

    vec2 lp = pc - pos;
    float cr = cos(rot);
    float sr = sin(rot);
    lp = mat2(cr, -sr, sr, cr) * lp;
    vec2 q = abs(lp) - size;
    float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float m = smoothstep(0.03, -0.03, sdf) * fadeOut;
    float edgeDark = smoothstep(-0.015, 0.0, sdf) * smoothstep(0.03, 0.0, sdf);
    float lit = clamp(0.5 + 0.5 * (lp.x / max(size.x, 0.001)), 0.0, 1.0);

    float heat = smoothstep(0.0, 0.25, boomT) * (1.0 - smoothstep(0.35, 0.85, boomT));
    vec3 baseC = mix(vec3(0.42, 0.33, 0.22), vec3(0.58, 0.47, 0.32), lit);
    vec3 hotC = mix(vec3(1.0, 0.667, 0.0), vec3(1.0, 1.0, 0.9), 0.5);
    vec3 c = mix(baseC, hotC, heat) * (1.0 - edgeDark * 0.5);

    chunkColor = mix(chunkColor, c, m);
    chunks = max(chunks, m);
  }

  float dust = fbm(pc * 2.2 + vec2(uTime * 0.2, -uTime * 0.15))
             * exp(-de * de * 0.7) * smoothstep(0.0, 0.4, boomT) * fadeOut * 0.7;
  vec3 dustColor = vec3(0.55, 0.47, 0.4);

  float boomPresence = step(FLASH_END, t);

  // --- Composite -----------------------------------------------------
  vec3 color = cloneColor * cloneMaskTotal;
  color += vec3(1.0, 0.85, 0.6) * flash;
  color += (chunkColor + dust * dustColor) * boomPresence;

  float occlusion = clamp(cloneMaskTotal * 0.85 + chunks * boomPresence * 0.5, 0.0, 1.0);

  fragColor = vec4(color * uActive, occlusion * uActive);
}
`;

// Partial Expansion Jutsu - Approach B: a real stylized 3D mesh (a tapered
// forearm cylinder + a squashed-sphere fist, see buildFistMesh() in
// main.js), not a 2D video warp. Rendered with its own vertex shader (real
// depth test + backface culling, not a fullscreen triangle) and cel-shaded
// here: a hard two-tone diffuse ramp, a procedural diagonal bandage/tape
// stripe on the forearm, and a thin rim light - the stylized-anime look the
// lore calls for, instead of trying to fake it by distorting the live feed.
export const FIST_VERT_SRC = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
in float aBandageMask;

uniform vec2 uAnchorPx;   // wrist position, GL px (bottom-origin)
uniform float uAngle;     // screen-space wrist->hand direction, radians
uniform float uScalePx;   // local mesh units -> px
uniform vec2 uCanvasSize;
uniform float uZRange;    // depth normalization, px
uniform float uInflate;   // local-space push along the normal, for the
                           // inverted-hull outline pass (0 for the real mesh)

out vec3 vNormal;
out vec2 vUv;
out float vBandageMask;

void main() {
  vec3 inflated = aPosition + aNormal * uInflate;

  // A single rotation about the depth axis orients the whole rigid mesh
  // (arm axis + its circular cross-sections) to the tracked 2D direction.
  // There's no real depth/tilt signal from a monocular hand tracker, so the
  // arm is treated as lying in the screen plane - the same class of
  // judgment call as Susanoo's "anchor on the hand, scale way up" approach
  // elsewhere in this lab.
  float ca = cos(uAngle);
  float sa = sin(uAngle);
  vec3 rotated = vec3(
    inflated.x * ca - inflated.y * sa,
    inflated.x * sa + inflated.y * ca,
    inflated.z
  );
  vec3 worldLocal = rotated * uScalePx;
  vec2 worldPx = uAnchorPx + worldLocal.xy;

  vec3 nRotated = vec3(
    aNormal.x * ca - aNormal.y * sa,
    aNormal.x * sa + aNormal.y * ca,
    aNormal.z
  );
  vNormal = normalize(nRotated);
  vUv = aUv;
  vBandageMask = aBandageMask;

  gl_Position = vec4(
    (worldPx.x / uCanvasSize.x) * 2.0 - 1.0,
    (worldPx.y / uCanvasSize.y) * 2.0 - 1.0,
    clamp(worldLocal.z / uZRange, -1.0, 1.0),
    1.0
  );
}
`;

export const FIST_FRAG_SRC = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec2 vUv;
in float vBandageMask;

uniform float uActive;

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  // Fixed camera-attached key light, as is typical for stylized VFX where
  // the light doesn't need to track the scene's real lighting.
  vec3 lightDir = normalize(vec3(0.4, 0.6, 0.6));
  float diffuse = dot(n, lightDir);

  // Two-tone cel shadow ramp: a tight transition (not a smooth gradient) is
  // what sells the anime-shading look.
  float ramp = smoothstep(0.38, 0.44, diffuse);

  // Warm, saturated Akimichi skin tone - deliberately NOT pale, so the
  // enlarged limb reads as flesh rather than a bleached/inked silhouette.
  vec3 skinLit = vec3(0.86, 0.6, 0.42);
  vec3 skinShadow = vec3(0.5, 0.32, 0.24);
  vec3 skin = mix(skinShadow, skinLit, ramp);

  // Bandage/tape wraps: a diagonal stripe pattern along the forearm only
  // (vBandageMask is 1 on the forearm, 0 on the fist).
  float stripe = step(0.5, fract(vUv.x * 2.0 + vUv.y * 7.0));
  vec3 bandageLit = vec3(0.88, 0.84, 0.74);
  vec3 bandageShadow = vec3(0.5, 0.47, 0.42);
  vec3 bandage = mix(bandageShadow, bandageLit, ramp);
  vec3 color = mix(skin, bandage, stripe * vBandageMask * 0.85);

  // Thin rim light along the silhouette edge, kept weak and hard-clamped so
  // grazing angles can't blow the surface out toward white.
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 4.0) * 0.22;
  color += vec3(1.0, 0.95, 0.85) * rim;
  color = clamp(color, 0.0, 1.0);

  fragColor = vec4(color * uActive, uActive);
}
`;

// Anime ink outline for the fist mesh: the classic inverted-hull trick -
// draw the same mesh again, front-face culled (so only the inside-out
// backfaces render) and pushed outward along the normal (see FIST_VERT_
// SRC's uInflate), flat near-black. With depth testing on, the regular
// mesh (drawn after, at the true surface) covers this everywhere except
// right at the silhouette edge, where the inflated shell pokes out as a
// clean dark rim - exactly what reads as anime cel-shading's ink line.
export const OUTLINE_FRAG_SRC = `#version 300 es
precision highp float;

uniform float uActive;

out vec4 fragColor;

void main() {
  fragColor = vec4(vec3(0.03), uActive);
}
`;

// Yang-release vapor: wispy steam rising off the fist/forearm surface,
// representing rapid calorie-to-chakra burning. A fullscreen-triangle
// additive overlay (same "pure glow, alpha 0" contract as the other 2D
// effects), anchored partway up the mesh from JS.
export const STEAM_FRAG_SRC = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uHandPos;
uniform float uHandScale;
uniform float uActive;

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.1;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);

  // Wisps drift upward and dissipate sideways via fbm advected by time;
  // each octave scrolls at a different rate so it doesn't read as one
  // rigid texture sliding.
  vec2 q = p - vec2(0.0, -uTime * 0.6);
  float wisp = fbm(q * 1.4 + vec2(0.0, uTime * 0.3));
  wisp *= fbm(q * 2.6 - vec2(uTime * 0.15, 0.0));

  // Wisps only exist in a column rising off the surface, scrolling upward
  // and looping, fading near the seams instead of popping.
  float rise = fract(p.y * 0.4 - uTime * 0.6);
  float vertical = smoothstep(0.0, 0.15, rise) * smoothstep(1.0, 0.6, rise);
  float horizontal = exp(-p.x * p.x * 0.8);

  // Subtle wisps, not a wash: kept low so it never competes with the
  // mesh's own shading for "what makes the limb look white".
  float intensity = wisp * vertical * horizontal * 0.22 * uActive;

  vec3 steamColor = vec3(0.85, 0.95, 1.0);
  fragColor = vec4(steamColor * intensity, 0.0);
}
`;

// Human Boulder: a solid rolling sphere (signed distance to a circle, not a
// glow blob) with a fleshy/armored surface texture that visibly streaks past
// as it spins, a motion-blur edge, and a ground-contact dust puff. Occludes
// the video where the sphere is solid (same contract as the clay sculpture
// before it detonates), pure additive glow only for the dust outside it.
export const BOULDER_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;
uniform float uHandScale;
uniform float uActive;

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Flattened slightly and shifted down so the sphere reads as resting on
  // the ground rather than floating at the pose anchor.
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);
  vec2 ps = vec2(p.x, p.y * 1.05 + 0.08);
  float t = uTime;
  float spin = t * 10.0;

  float radius = 1.0;
  float sphereD = length(ps) - radius;
  float sphereMask = smoothstep(0.04, -0.04, sphereD);

  // Rotate the surface-texture sample so fbm detail streaks past as it
  // spins, selling "rolling" instead of "a static painted ball".
  float ca = cos(spin), sa = sin(spin);
  vec2 rp = vec2(ps.x * ca - ps.y * sa, ps.x * sa + ps.y * ca);
  float tex = fbm(rp * 2.6 + 4.0);

  // Cheap fake-Lambert shading from a fixed light direction using the
  // sphere's implied normal, so it reads as a lit solid, not a flat disc.
  float nz = sqrt(max(0.0, 1.0 - dot(ps, ps)));
  float lightDir = clamp(dot(normalize(vec3(-ps, nz)), normalize(vec3(-0.4, 0.5, 0.8))), 0.0, 1.0);

  vec3 skin = mix(vec3(0.55, 0.33, 0.2), vec3(0.7, 0.45, 0.28), tex);
  vec3 armor = vec3(0.65, 0.12, 0.08);
  float armorBand = smoothstep(0.03, 0.0, abs(fract(rp.y * 1.5 + 0.5) - 0.5) - 0.06);
  vec3 sphereColor = mix(skin, armor, armorBand * 0.6) * (0.35 + 0.75 * lightDir);

  // Motion-blur streak spokes trailing the spin direction, concentrated at
  // the silhouette edge.
  float edge = smoothstep(0.0, 0.25, sphereD + 0.25) * smoothstep(0.08, -0.08, sphereD);
  float streaks = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = spin + fi * (6.2831 / 6.0);
    vec2 dir = vec2(cos(ang), sin(ang));
    float along = dot(ps, dir);
    float perp = dot(ps, vec2(-dir.y, dir.x));
    float inSeg = step(0.5, along) * step(along, 1.15);
    streaks += exp(-perp * perp * 140.0) * inSeg;
  }
  sphereColor += vec3(1.0, 0.95, 0.85) * streaks * 0.5 * edge;

  // Ground dust puff sitting under the sphere, same fbm field so it visually
  // matches the surface texture kicking it up.
  vec2 dustP = (p - vec2(0.0, 0.95)) / vec2(1.6, 0.35);
  float dustD = length(dustP);
  float dustTex = fbm(p * 1.8 + vec2(t * 0.6, 0.0));
  float dust = smoothstep(1.0, 0.0, dustD) * (0.4 + 0.6 * dustTex);
  vec3 dustColor = vec3(0.55, 0.47, 0.38);

  vec3 color = sphereColor * sphereMask;
  color += dustColor * dust * (1.0 - sphereMask) * 0.8;

  float occlusion = sphereMask * uActive;
  fragColor = vec4(color * uActive, occlusion);
}
`;

// Butterfly Mode: two pointed wing lobes per side (an upper sweep + a
// smaller lower sweep), built from a petal distance-field rather than a
// single blurred blob, so the silhouette actually reads as wings. Ethereal
// indigo/cyan chakra with vein filigree and flaking embers, pure additive
// glow with a soft falloff throughout (no hard-clipped white core).
export const WING_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;
uniform float uHandScale;
uniform float uActive;

out vec4 fragColor;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }

// A lobe is the region swept by a line of length len from the origin at
// angle, whose half-width follows a half-sine profile - zero at both the
// root and the tip, widest at the middle, giving a soft pointed petal
// instead of a blurred ellipse. curve bows the lobe sideways as it
// extends, for the wing's characteristic sweep.
float wingLobe(vec2 p, float angle, float len, float width, float curve) {
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);
  float u = dot(p, dir);
  float v = dot(p, perp);
  if (u < 0.0 || u > len) return 0.0;
  float un = u / len;
  float profile = sin(un * 3.14159);
  float bow = profile * curve;
  float w = width * pow(max(profile, 0.0001), 0.6);
  float dd = abs(v - bow) / max(w, 0.0001);
  return smoothstep(1.15, 0.0, dd);
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);
  float t = uTime;
  float flutter = sin(t * 5.0) * 0.12;

  // Mirror across the spine so one lobe computation covers both wings.
  vec2 mp = vec2(abs(p.x), p.y);

  float upperAngle = radians(58.0) + flutter;
  float lowerAngle = radians(-18.0) - flutter * 0.6;
  float upper = wingLobe(mp, upperAngle, 2.3, 0.85, 0.55);
  float lower = wingLobe(mp, lowerAngle, 1.3, 0.55, 0.28);
  float wings = max(upper, lower * 0.85);

  // Vein filigree: angular bands radiating from the root, masked to the
  // wing silhouette so they read as internal structure, not noise.
  float veinAngle = atan(mp.y, mp.x);
  float veins = pow(0.5 + 0.5 * sin(veinAngle * 14.0 + t * 1.5), 6.0) * wings;

  // Flaking embers drifting off the wingtips.
  vec2 upperDir = vec2(cos(upperAngle), sin(upperAngle));
  float sparkle = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float seed = fi * 19.3;
    float life = fract(t * 0.4 + hash1(seed));
    float side = hash1(seed * 1.7) > 0.5 ? 1.0 : -1.0;
    float along = mix(0.3, 1.1, hash1(seed * 2.3));
    vec2 base = vec2(side, 1.0) * upperDir * along * 2.3;
    vec2 pos = base + vec2(side, 1.0) * life * 0.5;
    float dd = length(p - pos);
    sparkle += exp(-dd * dd * 160.0) * (1.0 - life);
  }

  float core = exp(-dot(p, p) * 2.0) * 0.35;

  float intensity = (wings * 0.75 + veins * 0.5 + core + sparkle) * uActive;

  vec3 indigo = vec3(0.25, 0.35, 0.9);
  vec3 cyan = vec3(0.35, 0.85, 1.0);
  vec3 white = vec3(0.85, 0.95, 1.0);

  vec3 color = mix(indigo, cyan, clamp(wings * 1.2, 0.0, 1.0));
  color = mix(color, white, clamp(veins + sparkle, 0.0, 1.0));
  color *= intensity;

  fragColor = vec4(color, 0.0);
}
`;

// Extracts the bright parts of the scene texture for blurring.
export const BRIGHT_PASS_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float lum = max(c.r, max(c.g, c.b));
  float w = smoothstep(uThreshold, uThreshold + 0.25, lum);
  fragColor = vec4(c * w, 1.0);
}
`;

// Separable gaussian blur, one direction per draw call.
export const BLUR_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexelStep;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float weights[5];
  weights[0] = 0.227027;
  weights[1] = 0.1945946;
  weights[2] = 0.1216216;
  weights[3] = 0.054054;
  weights[4] = 0.016216;
  vec3 result = texture(uTex, vUv).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uTexelStep * float(i);
    result += texture(uTex, vUv + off).rgb * weights[i];
    result += texture(uTex, vUv - off).rgb * weights[i];
  }
  fragColor = vec4(result, 1.0);
}
`;

// Sharingan: two tomoe-patterned red irises replacing the real eyes - a
// solid occlusion mask like the Rasengan orb (not a glow overlay), since
// this is meant to visibly BE the eye, not float on top of it. Face-
// anchored via uLeftEyePos/uRightEyePos (set from FaceLandmarker iris
// landmarks in main.js, not hand tracking).
export const SHARINGAN_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uLeftEyePos;
uniform float uLeftEyeR;
uniform float uLeftHalfW;
uniform float uLeftHalfH;
uniform vec2 uRightEyePos;
uniform float uRightEyeR;
uniform float uRightHalfW;
uniform float uRightHalfH;
uniform float uIgnite;
uniform float uVariant;
uniform float uTime;
uniform float uActive;

uniform sampler2D uVideoTex;
uniform vec2 uCanvasSize;
uniform vec2 uVideoOffset;
uniform vec2 uVideoExtent;

out vec4 fragColor;

// Same cover-fit + mirror mapping the composite pass uses, duplicated here
// because this effect needs to read the real eye underneath it (to blend
// into, and to keep its corneal highlights) instead of just gating an
// occlusion flag for the composite pass to deal with later.
vec3 sampleVideo(vec2 fragPx) {
  vec2 topOrigin = vec2(fragPx.x, uCanvasSize.y - fragPx.y);
  vec2 frac = (topOrigin - uVideoOffset) / uVideoExtent;
  vec2 uv = vec2(1.0 - frac.x, 1.0 - frac.y);
  return texture(uVideoTex, clamp(uv, 0.0, 1.0)).rgb;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// One tomoe (comma) shape as an actual signed distance field - a chain of
// smin-blended tapered capsules curving from near the pupil out to a round
// head, thresholded to a hard silhouette. The earlier version summed
// overlapping glow blobs (right technique for lightning, wrong for a solid
// shape) and came out as a lumpy smear instead of a clean comma.
float tomoeSDF(vec2 p, float ang) {
  float headDist = 0.52;
  vec2 headPos = vec2(cos(ang), sin(ang)) * headDist;
  float d = length(p - headPos) - 0.15;

  vec2 prev = vec2(cos(ang), sin(ang)) * 0.03;
  const int SEGS = 5;
  for (int s = 1; s <= SEGS; s++) {
    float u = float(s) / float(SEGS);
    float curveAng = ang - u * 1.55;
    float curveR = 0.08 + u * (headDist - 0.08);
    vec2 cur = vec2(cos(curveAng), sin(curveAng)) * curveR;
    float segR = mix(0.018, 0.13, u);
    float segD = sdCapsule(p, prev, cur, segR);
    d = smin(d, segD, 0.045);
    prev = cur;
  }
  return d;
}
float tomoeMask(vec2 p, float ang) {
  return smoothstep(0.018, -0.018, tomoeSDF(p, ang));
}

vec4 eyeColor(vec2 fragPx, vec2 eyePos, float eyeR, float halfW, float halfH, float ignite) {
  // Strict uniform circle: raw pixel-space distance divided by one scalar
  // radius, both axes together - not a per-axis bounding-box normalize.
  vec2 dPx = fragPx - eyePos;
  float dist = length(dPx) / max(eyeR, 1.0);
  if (dist > 1.3) return vec4(0.0);
  vec2 p = dPx / max(eyeR, 1.0);

  // Eyelid clip, in its own independent ellipse space - NOT reused for the
  // circle above. Given generous headroom (1.45x the tracked eyelid gap):
  // a relaxed open eye's natural lid gap is often shorter than a realistic
  // iris diameter, and without that slack this clip was flattening a truly
  // circular iris into what read as a squashed oval. It still collapses to
  // nothing on a real blink, since halfH itself shrinks toward 0 then.
  float apertureSlack = 1.45;
  vec2 pAperture = vec2(dPx.x / max(halfW * apertureSlack, 1.0), dPx.y / max(halfH * apertureSlack, 1.0));
  float dAperture = length(pAperture);
  float apertureMask = smoothstep(1.05, 0.88, dAperture);
  if (apertureMask <= 0.002) return vec4(0.0);

  // Spin decelerates into a near-stop as the eye "activates" instead of
  // spinning at a constant rate from the first frame.
  float spinSpeed = mix(4.5, 0.5, ignite);
  float spin = uTime * spinSpeed;
  float tomoe = max(tomoeMask(p, spin), max(tomoeMask(p, spin + 2.094), tomoeMask(p, spin + 4.189)));
  // Variants: 0 tomoe Sharingan, 1 Itachi-style Mangekyo pinwheel,
  // 2 Shisui/Obito-style bent shuriken, 3 Rinnegan rings, 4 Byakugan.
  float ang = atan(p.y, p.x) - spin;
  float rr = length(p);
  if (uVariant > 0.5 && uVariant < 1.5) {
    float blade = abs(sin(1.5 * (ang + rr * 2.6))) - 0.62 * (1.0 - rr);
    tomoe = smoothstep(0.06, -0.02, blade) * smoothstep(0.86, 0.8, rr);
    tomoe = max(tomoe, smoothstep(0.3, 0.26, rr));
  } else if (uVariant > 1.5 && uVariant < 2.5) {
    float blade = abs(sin(2.0 * (ang - rr * 3.2))) - 0.5 * (1.0 - rr * 0.8);
    tomoe = smoothstep(0.05, -0.03, blade) * smoothstep(0.82, 0.76, rr) * smoothstep(0.16, 0.24, rr);
  } else if (uVariant > 2.5 && uVariant < 3.5) {
    tomoe = smoothstep(0.035, 0.0, abs(fract(rr * 4.2) - 0.5) - 0.44) * smoothstep(0.95, 0.85, rr);
  } else if (uVariant > 3.5) {
    tomoe = 0.0;
  }

  // Hard stop at the iris boundary - nothing past this point touches the
  // sclera at all, not even a soft falloff into it.
  float irisAlpha = smoothstep(1.0, 0.92, dist);
  if (irisAlpha <= 0.002) return vec4(0.0);

  float pupilMask = smoothstep(0.26, 0.2, dist);
  float limbal = smoothstep(0.8, 1.0, dist);

  vec3 brightRed = vec3(1.0, 0.08, 0.04);
  vec3 deepCrimson = vec3(0.65, 0.01, 0.01);
  if (uVariant > 2.5 && uVariant < 3.5) { brightRed = vec3(0.78, 0.68, 0.98); deepCrimson = vec3(0.45, 0.36, 0.72); }
  if (uVariant > 3.5) { brightRed = vec3(0.93, 0.92, 0.98); deepCrimson = vec3(0.78, 0.74, 0.9); pupilMask = 0.0; }
  vec3 irisCol = mix(brightRed, deepCrimson, smoothstep(0.1, 0.85, dist));
  irisCol = mix(irisCol, vec3(0.02), tomoe);
  irisCol = mix(irisCol, vec3(0.02), pupilMask);
  irisCol = mix(irisCol, vec3(0.02), limbal);
  // Ramp red saturation in with ignite (not a flat opacity fade) - a dim,
  // near-natural iris tone eases toward the full Sharingan red.
  vec3 neutralIris = vec3(0.3, 0.25, 0.21);
  irisCol = mix(neutralIris, irisCol, ignite);

  vec3 cam = sampleVideo(fragPx);
  float luma = dot(cam, vec3(0.299, 0.587, 0.114));

  // Luminance-only shading (not a full RGB multiply by the real eye's skin-
  // toned pixel) so room shadows fall across the iris without muddying its
  // hue toward brown.
  vec3 shaded = irisCol * (0.35 + 0.65 * luma);

  // Fake-cornea specular dome: treat the iris disc as the equator of a unit
  // sphere bulging toward the camera, so it catches a fixed "supernatural"
  // glint independent of the real room lighting, on top of the real-glint
  // pass below.
  vec2 nXY = p;
  float nZ = sqrt(max(0.0, 1.0 - dot(nXY, nXY)));
  vec3 eyeNormal = normalize(vec3(nXY, nZ));
  vec3 lightDir = normalize(vec3(0.1, 0.6, 0.8));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(eyeNormal, halfVec), 0.0), 32.0);
  shaded += spec * 0.6;

  // Real room-light glint from the actual camera feed, on top of that.
  float glint = smoothstep(0.88, 0.99, luma);
  shaded = mix(shaded, vec3(1.0), glint * 0.5);

  float mask = irisAlpha * apertureMask * ignite;
  // Premultiply by mask before returning: the composite pass does
  // video*(1-a) + scene.rgb with NO extra weighting of scene.rgb by a, so
  // an un-premultiplied color here would add full brightness on top of
  // nearly-full video at soft edges - a source of bright fringing bleeding
  // into the sclera, on top of the bloom issue fixed earlier.
  return vec4(clamp(shaded, 0.0, 1.0) * mask, mask);
}

void main() {
  vec4 left = eyeColor(gl_FragCoord.xy, uLeftEyePos, uLeftEyeR, uLeftHalfW, uLeftHalfH, uIgnite);
  vec4 right = eyeColor(gl_FragCoord.xy, uRightEyePos, uRightEyeR, uRightHalfW, uRightHalfH, uIgnite);
  vec4 result = left.a > right.a ? left : right;
  fragColor = vec4(result.rgb * uActive, result.a * uActive);
}
`;

// Composites bolts + bloom over the LIVE VIDEO, sampled with a heat-shimmer
// warp and chromatic aberration near the hand so the effect reads as
// something distorting the air in the scene, not a sticker laid on top.
export const COMPOSITE_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uVideo;
uniform float uBloomStrength;
uniform vec2 uCanvasSize;
uniform vec2 uVideoOffset; // top-origin px, where the cover-fit video starts
uniform vec2 uVideoExtent; // top-origin px, cover-fit video width/height
uniform vec2 uHandPos;     // bottom-origin GL px (matches the scene pass)
uniform float uHandScale;
uniform float uActive;
uniform float uTime;
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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

vec3 sampleVideo(vec2 fragPx) {
  vec2 topOrigin = vec2(fragPx.x, uCanvasSize.y - fragPx.y);
  vec2 frac = (topOrigin - uVideoOffset) / uVideoExtent;
  vec2 uv = vec2(1.0 - frac.x, 1.0 - frac.y); // mirror selfie-style, flip Y
  return texture(uVideo, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 p = (fragPx - uHandPos) / max(uHandScale, 1.0);
  float d = length(p);

  // Heat-shimmer: push video sample positions outward/sideways near the
  // hand, strongest close in, faded out by ~2.5 hand-radii.
  float warpFalloff = exp(-d * d * 0.9) * uActive;
  float n1 = noise(p * 2.2 + uTime * 1.6) - 0.5;
  float n2 = noise(p * 2.2 + 11.0 - uTime * 1.3) - 0.5;
  vec2 warp = vec2(n1, n2) * warpFalloff * 10.0; // px, scaled below by hand size

  vec2 warpPx = warp * (uHandScale / 90.0);
  float ab = warpFalloff * 2.5; // chromatic aberration spread, px

  vec3 video;
  video.r = sampleVideo(fragPx + warpPx + vec2(ab, 0.0)).r;
  video.g = sampleVideo(fragPx + warpPx).g;
  video.b = sampleVideo(fragPx + warpPx - vec2(ab, 0.0)).b;

  // Slightly darken the video right around the hand so the bolts pop with
  // more contrast, like the anime's darkened backdrop around the jutsu.
  video *= mix(1.0, 0.55, exp(-d * d * 3.0) * uActive);

  vec4 scene = texture(uScene, vUv);
  vec3 bloom = texture(uBloom, vUv).rgb;

  // scene.a is occlusion, not opacity: 0 means "pure glow on top of video"
  // (chidori bolts), >0 means "this pixel is solid effect, hide the video
  // behind it" (rasengan's orb surface).
  vec3 color = video * (1.0 - scene.a) + scene.rgb + bloom * uBloomStrength;
  fragColor = vec4(color, 1.0);
}
`;

// Fullscreen-triangle vertex shader that also emits a 0..1 UV, used by the
// bloom passes (the main chidori pass only needs clip-space position).
export const VERT_UV_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
