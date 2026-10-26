// Always-on 3D effects for each duel player: a chakra aura around their
// silhouette, hands that charge while a seal is held, a burst + kanji when a
// seal lands, a reaction when hit, a ragged aura at low HP, and the KO /
// victory beats. Driven every frame by DuelScene from the server state and
// each player's tracked view.
import * as THREE from "three";
import { COVER_GLSL, SCREEN_VERT } from "../stage";
import { ADDITIVE, NOISE_GLSL, Shockwave, Sparks, disposeTree, glowSprite, pxPerUnit } from "../kit";
import { SEAL_KANJI, chakraOf } from "../../data/chakra";

const decay = (v, rate, dt) => v * Math.exp(-rate * dt);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

// ---------------------------------------------------------------- aura layer

const AURA_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform sampler2D uMask0, uMask1;
uniform float uHas0, uHas1, uPower0, uPower1, uRag0, uRag1, uTime;
uniform vec4 uBody0, uBody1;   // fallback silhouette: centre uv, radii uv
uniform vec3 uColor0, uColor1;
uniform vec2 uRes, uVideoSize;
varying vec2 vUv;
${COVER_GLSL}

float sil(sampler2D m, float has, vec4 body, vec2 s) {
  if (has > 0.5) {
    vec2 v = coverUv(s);
    if (v.x < 0.0 || v.x > 1.0 || v.y < 0.0 || v.y > 1.0) return 0.0;
    // Mask rows run top-down, the video texture bottom-up.
    return smoothstep(0.3, 0.7, texture2D(m, vec2(v.x, 1.0 - v.y)).r);
  }
  vec2 d = (s - body.xy) / body.zw;
  return 1.0 - smoothstep(0.75, 1.0, length(d));
}

float aura(sampler2D m, float has, vec4 body, float rag, float seed) {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = vUv * aspect;
  float n = snoise(vec3(p * vec2(7.0, 3.5) - vec2(0.0, uTime * 1.7), uTime * 0.45 + seed)) * 0.5 + 0.5;
  float n2 = snoise(vec3(p * 17.0 - vec2(0.0, uTime * 3.2), seed + 3.1)) * 0.5 + 0.5;
  float reach = 0.05 * (0.55 + n) * (1.0 + rag * 0.5);
  float inside = sil(m, has, body, vUv);
  float outer = 0.0;
  for (int k = 1; k <= 4; k++) {
    float f = float(k) / 4.0;
    // Sample below and beside: flames lick upward off the silhouette.
    outer = max(outer, sil(m, has, body, vUv + vec2(0.0, -reach * f)) * (1.0 - f * 0.55));
    outer = max(outer, sil(m, has, body, vUv + vec2(reach * f * 0.45 / aspect.x, -reach * f * 0.3)) * (1.0 - f * 0.75));
    outer = max(outer, sil(m, has, body, vUv + vec2(-reach * f * 0.45 / aspect.x, -reach * f * 0.3)) * (1.0 - f * 0.75));
  }
  float rim = max(outer - inside * 0.85, 0.0);
  float tongues = smoothstep(0.2, 0.85, n * 0.7 + n2 * 0.45);
  // Low HP: the aura tears into gaps and flickers.
  float torn = mix(1.0, step(0.5, n2) * (0.6 + 0.4 * sin(uTime * 23.0 + seed)), rag);
  return rim * tongues * torn;
}

void main() {
  float side = smoothstep(0.49, 0.51, vUv.x);
  vec3 c = vec3(0.0);
  if (uPower0 > 0.002) {
    float a = aura(uMask0, uHas0, uBody0, uRag0, 0.0) * (1.0 - side) * uPower0;
    c += mix(uColor0, vec3(2.2), clamp(a * a * 0.6, 0.0, 1.0)) * a;
  }
  if (uPower1 > 0.002) {
    float a = aura(uMask1, uHas1, uBody1, uRag1, 7.3) * side * uPower1;
    c += mix(uColor1, vec3(2.2), clamp(a * a * 0.6, 0.0, 1.0)) * a;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const EMPTY_MASK = () => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
};

export class AuraLayer {
  constructor(stage) {
    const bg = stage.bg.uniforms;
    this.stage = stage;
    this.masks = [EMPTY_MASK(), EMPTY_MASK()];
    this.versions = [-1, -1];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMask0: { value: this.masks[0] },
        uMask1: { value: this.masks[1] },
        uHas0: { value: 0 },
        uHas1: { value: 0 },
        uPower0: { value: 0 },
        uPower1: { value: 0 },
        uRag0: { value: 0 },
        uRag1: { value: 0 },
        uBody0: { value: new THREE.Vector4(0.25, 0.4, 0.12, 0.35) },
        uBody1: { value: new THREE.Vector4(0.75, 0.4, 0.12, 0.35) },
        uColor0: { value: new THREE.Color() },
        uColor1: { value: new THREE.Color() },
        uTime: { value: 0 },
        uRes: bg.uRes,
        uVideoSize: bg.uVideoSize,
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: AURA_FRAG,
      ...ADDITIVE,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -500;
    stage.scene.add(this.mesh);
  }

  // i: player; view: their tracked view; power / ragged: 0..1+; color: THREE.Color (HDR).
  set(i, view, power, ragged, color, dt) {
    const u = this.material.uniforms;
    const seg = view.segment;
    const real = seg.seen && seg.data && seg.width > 2;
    if (real && seg.version !== this.versions[i]) this._upload(i, seg);
    u[`uHas${i}`].value = real ? 1 : 0;
    u[`uPower${i}`].value = power;
    u[`uRag${i}`].value = ragged;
    u[`uColor${i}`].value.copy(color);
    // Fallback silhouette from the (tracked or stand-in) body: head to hips.
    const { width: W, height: H } = this.stage;
    const b = view.body;
    const top = b.joints.nose.y - b.span * 0.55;
    const bottom = Math.max(b.joints.lHip.y, b.joints.rHip.y) + b.span * 0.2;
    u[`uBody${i}`].value.set(b.torsoX / W, 1 - (top + bottom) / 2 / H, (b.span * 0.85) / W, (bottom - top) / 2 / H);
    if (i === 0) u.uTime.value += dt;
  }

  _upload(i, seg) {
    let tex = this.masks[i];
    if (tex.image.width !== seg.width || tex.image.height !== seg.height) {
      tex.dispose();
      tex = new THREE.DataTexture(new Uint8Array(seg.width * seg.height), seg.width, seg.height, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.masks[i] = tex;
      this.material.uniforms[`uMask${i}`].value = tex;
    }
    tex.image.data.set(seg.data);
    tex.needsUpdate = true;
    this.versions[i] = seg.version;
  }

  dispose() {
    this.masks.forEach((t) => t.dispose());
    disposeTree(this.mesh);
  }
}

// ---------------------------------------------------------------- kanji stamp

const kanjiCache = new Map();
function kanjiTexture(ch) {
  if (!kanjiCache.has(ch)) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.font = "bold 200px 'Noto Serif CJK JP', 'Yu Mincho', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#fff";
    ctx.fillText(ch, 128, 138);
    const tex = new THREE.CanvasTexture(c);
    kanjiCache.set(ch, tex);
  }
  return kanjiCache.get(ch);
}

// ---------------------------------------------------------------- one player

const GOLD = new THREE.Color(1.5, 1.05, 0.35);
const HURT = new THREE.Color(2.2, 0.25, 0.15);
const PILLAR_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = pow(1.0 - x, 4.0);
  float n = snoise(vec3(vUv.x * 6.0, vUv.y * 3.0 - uTime * 2.5, uTime * 0.3)) * 0.5 + 0.5;
  float fadeY = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float a = core * (0.35 + 0.5 * n) * fadeY * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export class PlayerFx {
  constructor(stage, index, characterId) {
    this.stage = stage;
    this.index = index;
    this.base = new THREE.Color(...chakraOf(characterId));
    this.color = this.base.clone().multiplyScalar(1.8);
    this.root = new THREE.Group();

    // Hand charge: a hot core, a wide halo and sparks pulled in.
    this.core = glowSprite(this.color.clone().multiplyScalar(1.4));
    this.halo = glowSprite(this.color.clone().multiplyScalar(0.35));
    this.sparks = new Sparks({ max: 260, color: this.color.clone().multiplyScalar(1.3), size: 0.06, gravity: 0, drag: 0.6 });
    this.hitSparks = new Sparks({ max: 220, color: new THREE.Color(2.4, 0.8, 0.4), size: 0.07, gravity: -3, drag: 2.2 });
    this.root.add(this.halo, this.core, this.sparks.points, this.hitSparks.points);

    // Seal landed: ring + kanji.
    // Kept near the bloom threshold: pale chakra colours (Hinata, Neji)
    // blow out to white if pushed as hard as the saturated ones.
    this.wave = new Shockwave(this.base.clone().multiplyScalar(1.1), 0.05);
    this.kanji = new THREE.Sprite(new THREE.SpriteMaterial({ color: this.base.clone().multiplyScalar(1.25), ...ADDITIVE, opacity: 0 }));
    this.root.add(this.wave.mesh, this.kanji);

    // Victory pillar.
    this.pillarMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: GOLD } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: PILLAR_FRAG,
      ...ADDITIVE,
    });
    this.pillar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.pillarMat);
    this.pillar.visible = false;
    this.root.add(this.pillar);
    stage.scene.add(this.root);

    this.charge = 0;
    this.flare = 0; // seal / intro bursts: brief aura boost
    this.hurt = 0; // 1 on impact, decays
    this.sealT = Infinity; // seconds since the last seal
    this.victoryT = -1;
    this.ignite = 0; // aura fades in during the countdown
    this.anchor = { x: 0, y: 0 };
    this._v = new THREE.Vector3();
  }

  // The seal that just landed (sign name), at the hands.
  seal(sign) {
    this.sealT = 0;
    this.flare = Math.max(this.flare, 1);
    const ch = SEAL_KANJI[sign];
    this.kanji.material.map = ch ? kanjiTexture(ch) : null;
    this.kanji.material.needsUpdate = true;
    const st = this.stage;
    const at = st.toWorld(this.anchor.x, this.anchor.y, 0.5, this._v);
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 3;
      this.sparks.spawn(at.x, at.y, at.z, Math.cos(a) * v, Math.sin(a) * v, (Math.random() - 0.3) * 2, 0.5 + Math.random() * 0.4);
    }
  }

  // Struck at `at` (viewport px); big = jutsu.
  hit(at, big) {
    this.hurt = big ? 1.4 : 1;
    this.flare = Math.max(this.flare, 0.4);
    const p = this.stage.toWorld(at.x, at.y, 0.6, this._v);
    const n = big ? 120 : 50;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = (big ? 4 : 2.5) * (0.4 + Math.random());
      this.hitSparks.spawn(p.x, p.y, p.z, Math.cos(a) * v, Math.sin(a) * v + 1.5, Math.random() * 2, 0.4 + Math.random() * 0.5);
    }
  }

  // Called every frame. p: server player state (or undefined); view: tracked
  // view; anchor: hands position in px; phase: { stage, countdown, winner }.
  update(dt, p, view, anchor, phase) {
    const st = this.stage;
    const i = this.index;
    this.anchor = anchor;
    const fighting = phase.stage === "fight";
    const over = phase.stage === "ko" || phase.stage === "done";
    const won = over && phase.winner === i;
    const lost = over && (phase.winner === 1 - i || phase.winner === "draw");

    // Intro: P1 ignites on "3", P2 on "2", both are lit by "FIGHT".
    const lit = fighting || over || (phase.stage === "countdown" && phase.countdown <= 3 - i);
    const wasLit = this.ignite > 0.5;
    this.ignite = approach(this.ignite, lit ? 1 : 0, 3, dt);
    if (fighting && !this.wasFighting) this.flare = Math.max(this.flare, 1.2);
    if (lit && !wasLit && this.ignite > 0.5) this.flare = Math.max(this.flare, 0.8);
    this.wasFighting = fighting;

    const match = fighting && p?.detected_sign != null && p.detected_sign === p.target_sign;
    this.charge = approach(this.charge, match ? p.hold_progress : 0, 10, dt);
    this.flare = decay(this.flare, 2.2, dt);
    this.hurt = decay(this.hurt, 3.5, dt);
    this.sealT += dt;

    const low = fighting && p && p.hp < 25 ? 1 : 0;
    let power = this.ignite * (0.55 + 0.5 * this.charge + 0.9 * this.flare) * (1 - 0.5 * this.hurt);
    if (lost) power *= 0;
    if (won) power *= 1.25;
    this.auraPower = power;
    this.auraRagged = low;

    // Per-half grade: low HP drains colour; the loser goes grey.
    if (lost) st.setHalfGrade(i, { desaturate: 0.95, darken: 0.18 });
    else if (low) st.setHalfGrade(i, { desaturate: 0.3, tint: new THREE.Color(1.05, 0.92, 0.92) });

    // Hand charge at the hands.
    const at = st.toWorld(anchor.x, anchor.y, 0.5, this._v);
    const size = st.toWorldSize(Math.max(60, anchor.size ?? 90));
    const c = this.charge;
    this.core.position.copy(at);
    this.halo.position.copy(at);
    const pulse = 1 + 0.08 * Math.sin(performance.now() / 70);
    this.core.scale.setScalar(size * (0.15 + 0.9 * c) * pulse);
    this.halo.scale.setScalar(size * (0.6 + 1.6 * c));
    this.core.material.opacity = Math.min(1, c * 1.6);
    this.halo.material.opacity = c * 0.8;
    if (c > 0.05) {
      // Sparks sucked in toward the hands: the anticipation beat.
      const rate = Math.round(c * 5);
      for (let k = 0; k < rate; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = size * (1.2 + Math.random() * 0.8);
        const life = 0.35;
        this.sparks.spawn(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, at.z, (-Math.cos(a) * r) / life, (-Math.sin(a) * r) / life, 0, life);
      }
      st.setLight(2 * i, anchor.x, anchor.y, Math.max(120, (anchor.size ?? 90) * 3.5), this.base, 0.9 * c);
    }

    // Seal landed: shockwave + kanji pop.
    const s = this.sealT;
    const sealOn = s < 0.9;
    this.wave.mesh.visible = s < 0.5;
    if (this.wave.mesh.visible) {
      this.wave.mesh.position.copy(at);
      this.wave.mesh.scale.setScalar(size * 3.2);
      this.wave.progress = s / 0.5;
    }
    this.kanji.visible = sealOn;
    if (sealOn) {
      this.kanji.position.set(at.x, at.y + size * 1.5, at.z + 0.3);
      const pop = s < 0.12 ? 0.6 + (s / 0.12) * 0.7 : 1.3 - Math.min(0.3, (s - 0.12) * 0.6);
      this.kanji.scale.setScalar(size * 1.05 * pop);
      this.kanji.material.opacity = 0.85 * (s < 0.5 ? 1 : 1 - (s - 0.5) / 0.4);
    }
    if (sealOn && s < 0.3) st.setLight(2 * i, anchor.x, anchor.y, 260, this.base, 1.0 * (1 - s / 0.3));

    // Hit: red light on the torso.
    if (this.hurt > 0.02) {
      st.setLight(2 * i + 1, view.body.torsoX, view.body.torsoY, view.body.span * 2.2, HURT, 0.9 * Math.min(1, this.hurt));
    }

    // Victory pillar + rising embers on the winner.
    if (won && this.victoryT < 0) this.victoryT = 0;
    if (!over) this.victoryT = -1;
    this.pillar.visible = this.victoryT >= 0;
    if (this.pillar.visible) {
      this.victoryT += dt;
      const b = view.body;
      const base = st.toWorld(b.torsoX, st.height, -0.5);
      const w = st.toWorldSize(b.span * 1.4);
      this.pillar.position.set(base.x, 0, -0.5);
      this.pillar.scale.set(w, st.visH * 1.1, 1);
      this.pillarMat.uniforms.uTime.value += dt;
      this.pillarMat.uniforms.uAlpha.value = 0.8 * Math.min(1, this.victoryT / 0.6);
      if (Math.random() < 0.7) {
        this.sparks.spawn(base.x + (Math.random() - 0.5) * w, -st.visH / 2, 0, (Math.random() - 0.5) * 0.4, 2 + Math.random() * 2, 0, 1.6);
      }
      st.setLight(2 * i + 1, b.torsoX, b.torsoY, b.span * 2.2, GOLD, 0.3);
      // Dim the winner's half a little so the pillar, not the room, glows
      // (bright walls sit near the bloom threshold).
      st.setHalfGrade(i, { darken: 0.3 * Math.min(1, this.victoryT / 0.6) });
    }

    const ppu = pxPerUnit(st);
    this.sparks.setPixelScale(ppu);
    this.hitSparks.setPixelScale(ppu);
    this.sparks.update(dt);
    this.hitSparks.update(dt);
  }

  dispose() {
    disposeTree(this.root);
  }
}
