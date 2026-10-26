// Susanoo: a towering armored chakra avatar standing behind the player.
// Each user gets a downloaded model (susanoo-models.js) rendered with the
// chakra skin; while it loads (or if it fails) a sculpted stand-in is shown.
// The stand-in's body and each user's head are *sculpted* (signed-distance shapes
// melted together, then baked into one smooth mesh — see sculpt.js), so
// muscles flow into each other and every Susanoo has its own face:
//   Itachi  — long tengu nose inside a hooded cowl, small forehead horns
//   Madara  — tengu nose, fangs, two huge horns sweeping up and back, crest
//   Sasuke  — armored jaw guard, crescent horns curving forward, crown spike
//   Indra   — long horns swept back, three-pronged crown, fangs
// The player is redrawn on top from the live person mask, so the avatar is
// *behind* you. It materializes bottom-up, then the eyes ignite.
import * as THREE from "three";
import { fallbackBody } from "../tracking";
import { ADDITIVE, NOISE_GLSL, Sparks, flameMaterial, flameMesh, glowSprite, lerp, pxPerUnit, smooth, span } from "../kit";
import { Cutout } from "../elements";
import { bake, box, chain, cone, ellipsoid, mirrorX, sphere, subtract, union } from "../sculpt";
import { sfx } from "../../sfx";
import { instanceSusanoo, loadSusanooModel } from "./susanoo-models";

const DURATION = 7;

const VARIANTS = {
  "itachi-uchiha": { color: [1.45, 0.32, 0.18], head: "itachi", model: "darko" },
  "madara-uchiha": { color: [0.25, 0.55, 1.45], head: "madara", model: "madara" },
  "sasuke-uchiha": { color: [0.6, 0.3, 1.35], head: "sasuke", model: "sasuke" },
  "indra-otsutsuki": { color: [0.75, 0.35, 1.3], head: "indra", model: "sasuke" },
};
const DEFAULT_VARIANT = VARIANTS["sasuke-uchiha"];

// ---------------------------------------------------------------------------
// Sculpts. Body in "shoulder units" (origin = shoulder midpoint, 1 unit =
// shoulder width, +z toward the camera). Heads in head units (cranium
// radius ~0.5, face toward +z), placed on the neck later.

function sculptBody() {
  const torso = union(
    [
      ellipsoid([0, 0.55, -0.5], [0.92, 0.68, 0.46]), // chest
      mirrorX(ellipsoid([0.38, 0.72, -0.2], [0.42, 0.3, 0.24])), // pecs
      ellipsoid([0, 0.02, -0.42], [0.62, 0.55, 0.4]), // ribcage / belly
      ellipsoid([0, -0.55, -0.45], [0.5, 0.45, 0.38]), // waist
      ...[0.26, 0.02, -0.22].map((y) => mirrorX(ellipsoid([0.15, y, -0.1], [0.14, 0.1, 0.09]))), // abs
      mirrorX(cone([0.05, 1.22, -0.52], [0.82, 1.02, -0.5], 0.24, 0.2)), // traps
      cone([0, 0.95, -0.5], [0, 1.5, -0.46], 0.26, 0.22), // neck
    ],
    0.12
  );
  const arms = union(
    [
      mirrorX(ellipsoid([1.0, 0.95, -0.45], [0.4, 0.37, 0.42])), // deltoids
      mirrorX(ellipsoid([1.04, 1.12, -0.45], [0.46, 0.13, 0.42])), // armored shoulder flare
      mirrorX(cone([1.04, 0.85, -0.45], [1.3, 0.02, 0.0], 0.25, 0.2)), // upper arm
      mirrorX(sphere([1.3, 0.0, 0.0], 0.2)), // elbow
      mirrorX(cone([1.3, 0.0, 0.0], [0.2, 0.62, 0.62], 0.2, 0.14)), // forearm
      mirrorX(ellipsoid([0.09, 0.8, 0.68], [0.075, 0.3, 0.19])), // hands in prayer
      mirrorX(cone([0.07, 0.95, 0.7], [0.05, 1.2, 0.68], 0.06, 0.035)), // fingertips
    ],
    0.08
  );
  let body = union([torso, arms], 0.1);
  // Ribcage carved into the chest as relief.
  for (let i = 0; i < 4; i++) {
    const y = 0.42 - i * 0.16;
    body = subtract(body, mirrorX(cone([0.06, y, 0.0], [0.62, y - 0.08, -0.18], 0.028)), 0.03);
  }
  return body;
}

// Shared skull: cranium, cheekbones, chin, neck, a scowling brow; eye
// sockets and the mouth slit carved in.
function skull(extra = []) {
  let s = union(
    [
      ellipsoid([0, 0.12, -0.02], [0.48, 0.6, 0.52]),
      mirrorX(ellipsoid([0.26, -0.08, 0.28], [0.16, 0.12, 0.16])),
      ellipsoid([0, -0.36, 0.14], [0.3, 0.2, 0.3]),
      mirrorX(cone([0.03, 0.12, 0.44], [0.4, 0.27, 0.32], 0.09, 0.07)),
      cone([0, -0.3, -0.1], [0, -0.95, -0.15], 0.25, 0.28),
      ...extra,
    ],
    0.07
  );
  s = subtract(s, mirrorX(ellipsoid([0.18, 0.03, 0.46], [0.12, 0.055, 0.1])), 0.03);
  return subtract(s, box([0, -0.3, 0.42], [0.16, 0.014, 0.12]), 0.02);
}

const HEADS = {
  itachi: () => {
    const head = skull([
      cone([0, 0.05, 0.45], [0, -0.14, 1.05], 0.09, 0.025), // tengu nose
      mirrorX(cone([0.12, 0.5, 0.3], [0.2, 0.78, 0.22], 0.05, 0.012)),
      cone([0, -0.42, 0.25], [0, -0.62, 0.3], 0.1, 0.035), // pointed chin
    ]);
    // Hooded cowl: a shell around the head, open at the face.
    const cowl = subtract(ellipsoid([0, 0.22, -0.2], [0.74, 0.88, 0.76]), ellipsoid([0, 0.16, 0.14], [0.6, 0.8, 0.8]), 0.04);
    return union([head, cowl], 0.05);
  },
  madara: () =>
    skull([
      cone([0, 0.05, 0.45], [0, -0.12, 0.8], 0.085, 0.025),
      mirrorX(chain([[0.3, 0.35, 0.15], [0.55, 0.75, 0.05], [0.62, 1.2, -0.25], [0.47, 1.55, -0.62]], [0.12, 0.09, 0.055, 0.012])),
      mirrorX(cone([0.12, -0.27, 0.4], [0.11, -0.47, 0.42], 0.035, 0.006)), // fangs
      ...[0, 1, 2].map((i) => cone([0, 0.62 - i * 0.05, -0.1 - i * 0.18], [0, 0.85 - i * 0.05, -0.55 - i * 0.22], 0.08, 0.01)),
    ]),
  sasuke: () =>
    skull([
      ellipsoid([0, -0.3, 0.32], [0.31, 0.19, 0.2]), // armored jaw guard
      cone([0, 0.05, 0.45], [0, -0.06, 0.62], 0.07, 0.025),
      mirrorX(chain([[0.34, 0.35, 0.1], [0.6, 0.6, 0.14], [0.63, 0.95, 0.3], [0.5, 1.22, 0.56]], [0.1, 0.08, 0.05, 0.012])),
      cone([0, 0.62, 0.22], [0, 1.05, 0.08], 0.07, 0.01), // crown spike
    ]),
  indra: () =>
    skull([
      cone([0, 0.05, 0.45], [0, -0.1, 0.72], 0.08, 0.025),
      mirrorX(chain([[0.32, 0.38, 0.05], [0.56, 0.55, -0.25], [0.72, 0.64, -0.7], [0.82, 0.58, -1.15]], [0.11, 0.08, 0.05, 0.01])),
      cone([0, 0.62, 0.15], [0, 1.15, 0.05], 0.07, 0.01),
      mirrorX(cone([0.18, 0.6, 0.12], [0.3, 1.0, 0.0], 0.06, 0.01)),
      mirrorX(cone([0.12, -0.27, 0.4], [0.11, -0.45, 0.42], 0.03, 0.006)),
    ]),
};

const BODY_BOUNDS = [[-1.75, -1.1, -1.05], [1.75, 1.6, 1.0]];
const HEAD_BOUNDS = [[-1.0, -1.0, -1.3], [1.0, 1.7, 1.15]];

const bodyGeometry = () => bake("susanoo-body", sculptBody, BODY_BOUNDS, 112);
const headGeometry = (name) => bake(`susanoo-head-${name}`, HEADS[name], HEAD_BOUNDS, 112);

// ---------------------------------------------------------------------------
// Chakra skin: body fill shaded by key + fill lights, fresnel rim, flames
// flowing up through the surface, and a bottom-up reveal with a bright
// leading edge. On downloaded models the original texture's brightness is
// kept as surface detail (armor plates, folds, faces); sculpts get faint
// procedural seams instead.
const SKIN_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vObj = position;
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SKIN_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uAlpha, uReveal, uSeams, uHasMap;
uniform vec3 uColor;
uniform sampler2D uMap;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
varying vec3 vW;
varying vec2 vUv;
void main() {
  float edge = uReveal - vW.y;
  if (edge < 0.0) discard;
  vec3 n = normalize(vN);
  float ndv = abs(dot(n, normalize(vV)));
  float rim = pow(1.0 - ndv, 2.4);
  float key = max(0.0, dot(n, normalize(vec3(-0.4, 0.6, 0.7))));
  float fill = max(0.0, dot(n, normalize(vec3(0.6, -0.2, 0.5))));
  float ridge = 1.0 - abs(snoise(vObj * 2.6));
  float seams = smoothstep(0.93, 0.98, ridge) * uSeams;
  float flow = snoise(vW * 1.3 + vec3(0.0, -uTime * 1.8, 0.0)) * 0.5 + 0.5;
  float lead = 1.0 - smoothstep(0.0, 0.35, edge);
  float detail = 0.55;
  if (uHasMap > 0.5) {
    detail = dot(texture2D(uMap, vUv).rgb, vec3(0.299, 0.587, 0.114));
    seams = 0.0;
  }
  float c = 0.16 + key * 0.5 * (0.45 + detail) + fill * 0.1 + rim * (0.7 + 0.6 * flow) + seams * 0.5 + lead * 1.5
          + (detail - 0.5) * 0.35 * uHasMap;
  gl_FragColor = vec4(uColor * c * uAlpha, 1.0);
}`;

function skinMaterial(color, map = null) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 1 },
      uReveal: { value: -100 },
      uSeams: { value: 0.6 },
      uColor: { value: color },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
    },
    vertexShader: SKIN_VERT,
    fragmentShader: SKIN_FRAG,
    ...ADDITIVE,
  });
}

// Shoulder width of downloaded models, in player shoulder widths.
const MODEL_SHOULDERS = 2.1;

// Eye socket position in head units (mirrored in x), for the glowing eyes.
const EYES_AT = [0.18, 0.03, 0.47];

export default class Susanoo {
  static needs = ["pose", "segment"];
  static duration = DURATION;

  // Bake the sculpts ahead of time (called while the player does hand signs).
  static prebake(character) {
    const variant = VARIANTS[character] ?? DEFAULT_VARIANT;
    loadSusanooModel(variant.model).catch(() => {});
    bodyGeometry();
    headGeometry(variant.head);
  }

  constructor(stage, { power = 1, character } = {}) {
    this.stage = stage;
    this.power = power;
    const variant = VARIANTS[character] ?? DEFAULT_VARIANT;
    this.color = new THREE.Color(...variant.color);
    this.lightColor = new THREE.Color(...variant.color).multiplyScalar(1 / Math.max(...variant.color));
    this.root = new THREE.Group();

    this.skin = skinMaterial(this.color.clone().multiplyScalar(0.55));
    this.mats = [this.skin];
    this.avatar = new THREE.Group();
    this.sculpt = new THREE.Mesh(bodyGeometry(), this.skin);
    this.avatar.add(this.sculpt);
    const head = new THREE.Group();
    this.sculptHead = head;
    head.position.set(0, 1.9, -0.42);
    head.scale.setScalar(0.95);
    head.add(new THREE.Mesh(headGeometry(variant.head), this.skin));
    this.avatar.add(head);

    // Depth pre-pass: an invisible copy writes depth first, so the additive
    // skin only draws its front-most surface (no stacking into white).
    this.prepass = this.avatar.clone(true);
    this.depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.prepass.traverse((o) => {
      if (o.isMesh) o.material = this.depthOnly;
    });
    this.root.add(this.prepass, this.avatar);

    // Flame hair and shoulder/arm flames, in the avatar's color.
    const flameColors = {
      core: this.color.clone().multiplyScalar(1.3),
      mid: this.color.clone().multiplyScalar(0.8),
      edge: this.color.clone().multiplyScalar(0.25),
    };
    this.flames = [];
    const addFlame = (parent, pos, w, h, tilt) => {
      const f = flameMesh(flameMaterial(flameColors));
      f.position.set(...pos);
      f.scale.set(w, h, 1);
      f.rotation.z = tilt;
      f.userData = { w };
      parent.add(f);
      this.flames.push(f);
    };
    [-0.36, -0.18, 0, 0.18, 0.36].forEach((x, i) => addFlame(head, [x, 0.35, -0.35], 0.5, 1.1 + (i % 2) * 0.4, -x * 1.4));
    for (const s of [-1, 1]) {
      addFlame(this.avatar, [s * 1.05, 1.25, -0.6], 0.75, 1.2, -s * 0.45);
      addFlame(this.avatar, [s * 1.4, 0.5, -0.45], 0.55, 0.95, -s * 0.85);
      addFlame(this.avatar, [s * 1.35, -0.4, -0.35], 0.45, 0.7, -s * 1.1);
    }

    this.eyes = [-1, 1].map((s) => {
      const e = glowSprite(new THREE.Color(1.8, 1.8, 1.8).lerp(this.color, 0.3));
      e.position.set(s * EYES_AT[0], EYES_AT[1], EYES_AT[2]);
      head.add(e);
      return e;
    });

    this.embers = new Sparks({ max: 400, color: this.color.clone().multiplyScalar(1.1), size: 0.05, gravity: 1.5, drag: 1 });
    this.root.add(this.embers.points);
    stage.scene.add(this.root);
    this.me = null;

    loadSusanooModel(variant.model)
      .then((scene) => !this.disposed && this._useModel(variant.model, scene))
      .catch((err) => console.warn("Susanoo model failed, keeping the sculpt:", err));
  }

  // Swap the sculpted stand-in for the downloaded model (same unit space).
  _useModel(key, scene) {
    const tint = this.color.clone().multiplyScalar(0.55);
    const { group, materials } = instanceSusanoo(key, scene, (map) => skinMaterial(tint, map));
    this.mats.push(...materials);
    // Same placement as the sculpt: shoulders ~2 units apart, one unit above
    // the player's shoulders, a little behind.
    group.scale.setScalar(MODEL_SHOULDERS);
    group.position.set(0, 0.85, -0.45);
    const depth = group.clone(true);
    depth.traverse((o) => {
      if (o.isMesh) o.material = this.depthOnly;
    });
    this.avatar.add(group);
    this.prepass.add(depth);
    // Hide the sculpt (its prepass copy is the first children of prepass).
    for (const g of [this.avatar, this.prepass]) {
      g.children[0].visible = false; // sculpted body
      g.children[1].visible = false; // sculpted head (+ its flames and eyes)
    }
  }

  update(t, dt, track) {
    const st = this.stage;
    const b = track.body.seen ? track.body : fallbackBody(st.width, st.height);
    const presence = track.body.seen ? lerp(0.5, 1, track.body.presence) : 0.8;
    const unit = st.toWorldSize(b.span) * (1.15 + 0.1 * this.power);
    const sh = b.joints;
    const origin = st.toWorld((sh.lShoulder.x + sh.rShoulder.x) / 2, (sh.lShoulder.y + sh.rShoulder.y) / 2, -1.2);

    // Redraw the player on top from the live mask so the avatar is behind.
    if (!this.me && track.segment.seen) {
      this.me = new Cutout(st, track.segment, { live: true });
      this.me.uniforms.uAlpha.value = 1;
      this.me.uniforms.uMix.value = 0;
      this.root.add(this.me.mesh);
    }
    this.me?.update(track.segment);

    const fade = 1 - span(t, DURATION - 0.7, DURATION);
    const ignite = smooth(span(t, 0, 0.8));
    for (const g of [this.avatar, this.prepass]) {
      g.position.copy(origin);
      g.position.y += Math.sin(t * 1.6) * unit * 0.02; // breathing
      g.scale.setScalar(unit);
      g.rotation.y = Math.sin(t * 0.6) * 0.12;
    }

    // Reveal climbs from below the frame to above the head (world y).
    const bottom = origin.y - unit * 1.2;
    const top = origin.y + unit * 3.4;
    const reveal = lerp(bottom, top, smooth(span(t, 0.4, 2.8)));
    const alpha = fade * presence;
    for (const m of this.mats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uAlpha.value = alpha;
      m.uniforms.uReveal.value = reveal;
    }

    const wp = new THREE.Vector3();
    for (const f of this.flames) {
      f.material.uniforms.uTime.value = t + f.userData.w * 10;
      f.material.uniforms.uAlpha.value = alpha * (f.getWorldPosition(wp).y < reveal ? 0.8 : 0);
    }

    // Eyes ignite once the head has formed.
    const EYES = 3.0;
    const flare = t > EYES ? Math.exp(-(t - EYES) * 4) : 0;
    const eyesOn = smooth(span(t, EYES - 0.1, EYES + 0.2)) * fade;
    this.eyes.forEach((e) => {
      e.scale.set(0.18 + flare * 0.8, 0.07 + flare * 0.2, 1);
      e.material.opacity = eyesOn;
    });
    if (t > EYES && !this.roared) {
      this.roared = true;
      sfx.taiko();
    }

    const emit = Math.round(dt * 140 * ignite * fade);
    for (let i = 0; i < emit; i++) {
      const x = origin.x + (Math.random() - 0.5) * unit * 3.2;
      const y = Math.min(reveal, origin.y + (Math.random() - 0.3) * unit * 3);
      this.embers.spawn(x, y, origin.z + (Math.random() - 0.5) * unit, (Math.random() - 0.5) * unit * 0.2, unit * (0.4 + Math.random() * 0.6), 0, 0.7 + Math.random() * 0.6);
    }
    this.embers.setPixelScale(pxPerUnit(st));
    this.embers.material.uniforms.uSize.value = unit * 0.04;
    this.embers.gravity = unit * 0.6;
    this.embers.update(dt);

    const energy = ignite * fade * presence;
    st.setLight(0, b.torsoX, b.torsoY - b.span * 0.8, b.span * 3.2, this.lightColor, 0.55 * energy);
    st.darken = 0.45 * energy;
    st.desaturate = 0.3 * energy;
    st.tint.setRGB(lerp(1, 0.85 + this.lightColor.r * 0.2, energy), lerp(1, 0.85 + this.lightColor.g * 0.2, energy), lerp(1, 0.85 + this.lightColor.b * 0.2, energy));
    st.vignette = 0.3 + 0.4 * energy;
    st.vignetteColor.copy(this.color).multiplyScalar(0.05 * energy);
    st.bloom.strength = 0.75 + 0.25 * energy + flare * 0.6;
    st.aberration = 0.02 + 0.03 * energy + flare * 0.15;
    st.shake(0.002 * energy + 0.02 * flare);
    if (flare > 0.05) st.flash.copy(this.lightColor).multiplyScalar(0.2 * flare);
  }

  dispose() {
    this.disposed = true;
    this.me?.dispose();
    this.root.removeFromParent();
    // Baked body/head geometries and loaded models stay cached for the
    // next cast; only per-cast materials are freed.
    this.mats.forEach((m) => m.dispose());
    this.depthOnly.dispose();
    this.flames.forEach((f) => {
      f.geometry.dispose();
      f.material.dispose();
    });
    this.eyes.forEach((e) => e.material.dispose());
    this.embers.geometry.dispose();
    this.embers.material.dispose();
  }
}
