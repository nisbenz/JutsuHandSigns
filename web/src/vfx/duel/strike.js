// 3D strikes for duels: a chakra projectile flies from the attacker's hands
// to the defender's chest, arcing out toward the camera, with an element-
// specific trail and impact (lightning forks, a fireball blast, a water
// splash, ink ribbons, …). All strikes share a few particle pools.
import * as THREE from "three";
import { InkRibbons, Puffs, explode } from "../elements";
import { LightningRibbons, Shockwave, Sparks, boltPath, disposeTree, glowSprite, pxPerUnit } from "../kit";
import { elementOf } from "./elements";

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const IMPACT_FLASH_S = 0.25;
const WAVE_S = 0.45;

const hdr = (css, k) => new THREE.Color(css).multiplyScalar(k);

export class StrikeLayer {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.sparks = new Sparks({ max: 900, color: new THREE.Color(1.6, 1.6, 1.8), size: 0.06, gravity: -1.5, drag: 1.8 });
    this.drops = new Sparks({ max: 500, color: new THREE.Color(0.7, 1.3, 2.2), size: 0.07, gravity: -7, drag: 0.8 });
    this.fire = new Puffs({ max: 220, mode: "fire", lift: 0.8 });
    this.smoke = new Puffs({ max: 120, mode: "smoke", lift: 0.5 });
    this.bolts = new LightningRibbons({ color: new THREE.Color(0.4, 0.8, 2.2), coreColor: new THREE.Color(1.6, 1.8, 2.2) });
    this.ink = new InkRibbons({});
    this.root.add(this.smoke.mesh, this.fire.mesh, this.ink.mesh, this.bolts.mesh, this.sparks.points, this.drops.points);
    stage.scene.add(this.root);
    this.strikes = [];
    this.waves = []; // impact rings
    this.zaps = []; // lightning forks left at an impact, with time left
    this.flash = null;
    this.timers = new Set();
    this.time = 0;
  }

  // from / to: viewport px. options: { skill, big, light (light slot to use
  // while in flight), onImpact }.
  launch(from, to, { skill, big = false, light = 3, onImpact } = {}) {
    const st = this.stage;
    const el = elementOf(skill);
    const a = st.toWorld(from.x, from.y, 0.3);
    const b = st.toWorld(to.x, to.y, 0.4);
    const dist = a.distanceTo(b);
    const s = {
      kind: el.kind,
      core: hdr(el.core, big ? 1.9 : 1.5),
      glow: hdr(el.glow, big ? 2.2 : 1.6),
      a,
      b,
      // Arc up and out toward the camera, like a thrown jutsu.
      ctrl: new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + dist * (big ? 0.3 : 0.18), big ? 3.2 : 1.6),
      t: 0,
      duration: big ? 0.55 : 0.36,
      big,
      size: st.toWorldSize(big ? 95 : 55),
      head: glowSprite(new THREE.Color()),
      halo: glowSprite(new THREE.Color()),
      pos: a.clone(),
      prev: a.clone(),
      onImpact,
      light,
      landed: false,
    };
    s.head.material.color.copy(s.core);
    s.halo.material.color.copy(s.glow).multiplyScalar(0.6);
    this.root.add(s.halo, s.head);
    this.strikes.push(s);
    // Launch burst at the hands.
    this._burst(this.sparks, a, s.glow, big ? 40 : 18, big ? 5 : 3);
    // Arrival is guaranteed by a timer too: animation frames pause in
    // background tabs, and the HP bars wait on this impact.
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!s.landed) this._land(s);
    }, s.duration * 1000 + 80);
    this.timers.add(timer);
    return s;
  }

  _burst(pool, at, color, n, speed, up = 0) {
    pool.material.uniforms.uColor.value.copy(color);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random());
      pool.spawn(at.x, at.y, at.z, Math.cos(ang) * v, Math.sin(ang) * v + up, (Math.random() - 0.2) * v * 0.6, 0.35 + Math.random() * 0.45);
    }
  }

  _land(s) {
    s.landed = true;
    disposeTree(s.head);
    disposeTree(s.halo);
    const at = s.b;
    const big = s.big;
    const r = s.size;
    switch (s.kind) {
      case "fire":
      case "blast":
        this.sparks.material.uniforms.uColor.value.copy(s.glow);
        explode({ fire: this.fire, smoke: this.smoke, sparks: this.sparks }, at, r * (big ? 1.4 : 0.8));
        break;
      case "water":
        this._burst(this.drops, at, s.glow, big ? 140 : 60, big ? 7 : 4.5, 3);
        break;
      case "lightning":
        // Forks crackling out of the impact for a moment.
        for (let i = 0; i < (big ? 9 : 5); i++) {
          const ang = Math.random() * Math.PI * 2;
          const len = r * (big ? 4 : 2.6) * (0.5 + Math.random());
          this.zaps.push({ a: at.clone(), b: at.clone().add(new THREE.Vector3(Math.cos(ang) * len, Math.sin(ang) * len, 0.3)), t: 0.22 + Math.random() * 0.12 });
        }
        this._burst(this.sparks, at, s.core, big ? 60 : 25, big ? 7 : 4);
        break;
      default:
        this._burst(this.sparks, at, s.glow, big ? 90 : 35, big ? 7 : 4);
    }
    const wave = new Shockwave(s.glow.clone(), big ? 0.05 : 0.07);
    wave.mesh.position.copy(at);
    wave.mesh.scale.setScalar(r * (big ? 9 : 4.5));
    this.root.add(wave.mesh);
    this.waves.push({ wave, t: 0 });
    // Only a hint of a full-screen flash: it is added on top of the camera
    // image, so bright walls would cross the bloom threshold and white out.
    // The defender's light, aberration and shake carry the impact instead.
    if (big) this.flash = { color: s.glow.clone().multiplyScalar(0.03), t: 0 };
    s.onImpact?.();
  }

  update(dt) {
    const st = this.stage;
    this.time += dt;
    this.bolts.begin();
    this.ink.begin();

    for (const s of this.strikes) {
      if (s.landed) continue;
      s.t = Math.min(1, s.t + dt / s.duration);
      const t = easeInOut(s.t);
      const it = 1 - t;
      s.prev.copy(s.pos);
      s.pos.set(
        it * it * s.a.x + 2 * it * t * s.ctrl.x + t * t * s.b.x,
        it * it * s.a.y + 2 * it * t * s.ctrl.y + t * t * s.b.y,
        it * it * s.a.z + 2 * it * t * s.ctrl.z + t * t * s.b.z
      );
      const flicker = 0.85 + Math.random() * 0.3;
      s.head.position.copy(s.pos);
      s.halo.position.copy(s.pos);
      s.head.scale.setScalar(s.size * flicker);
      s.halo.scale.setScalar(s.size * 3.2 * flicker);
      this._trail(s, dt);
      st.setLight(s.light, ...this._px(s.pos), s.big ? 320 : 180, s.glow, s.big ? 0.8 : 0.45);
      if (s.t >= 1) this._land(s);
    }
    this.strikes = this.strikes.filter((s) => !s.landed);

    this.zaps = this.zaps.filter((z) => (z.t -= dt) > 0);
    for (const z of this.zaps) this.bolts.addBolt(boltPath(z.a, z.b, 4, 0.3), 0.05, Math.min(1, z.t * 5));

    for (const w of this.waves) {
      w.t += dt;
      w.wave.progress = Math.min(1, w.t / WAVE_S);
      if (w.t >= WAVE_S) disposeTree(w.wave.mesh);
    }
    this.waves = this.waves.filter((w) => w.t < WAVE_S);

    if (this.flash) {
      this.flash.t += dt;
      const k = Math.exp(-this.flash.t * 12);
      st.flash.add(this.flash.color.clone().multiplyScalar(k));
      st.aberration = 0.02 + 0.25 * k;
      if (this.flash.t > IMPACT_FLASH_S) this.flash = null;
    }

    this.bolts.end();
    this.ink.end();
    const ppu = pxPerUnit(st);
    this.sparks.setPixelScale(ppu);
    this.drops.setPixelScale(ppu);
    this.sparks.update(dt);
    this.drops.update(dt);
    this.fire.update(dt, this.time);
    this.smoke.update(dt, this.time);
  }

  _px(p) {
    const st = this.stage;
    return [(p.x / st.visW + 0.5) * st.width, (0.5 - p.y / st.visH) * st.height];
  }

  // Per-element trail behind the projectile.
  _trail(s, dt) {
    const p = s.pos;
    const v = new THREE.Vector3().subVectors(p, s.prev).divideScalar(Math.max(dt, 1e-3));
    switch (s.kind) {
      case "lightning":
        // A jagged bolt from the hands to the head, redrawn every frame.
        this.bolts.material.uniforms.uColor.value.copy(s.glow);
        this.bolts.addBolt(boltPath(s.a, p, 5, 0.18), s.big ? 0.09 : 0.05, 1);
        this.bolts.addBolt(boltPath(s.a, p, 4, 0.3), 0.03, 0.6);
        break;
      case "fire":
      case "blast":
        for (let i = 0; i < (s.big ? 4 : 2); i++) {
          this.fire.spawn(p.x, p.y, p.z, -v.x * 0.05 + (Math.random() - 0.5), -v.y * 0.05 + (Math.random() - 0.5), 0, s.size * (0.6 + Math.random() * 0.5), 0.35 + Math.random() * 0.2, 2);
        }
        if (s.kind === "blast") this.smoke.spawn(p.x, p.y, p.z - 0.1, 0, 0.3, 0, s.size * 0.8, 0.9, 2.5);
        break;
      case "water":
        this.drops.material.uniforms.uColor.value.copy(s.glow);
        for (let i = 0; i < (s.big ? 6 : 3); i++) {
          this.drops.spawn(p.x, p.y, p.z, -v.x * 0.1 + (Math.random() - 0.5) * 2, -v.y * 0.1 + Math.random() * 2, 0, 0.5);
        }
        break;
      case "shadow":
      case "eye": {
        // Inky ribbons trailing back to the caster.
        const mid = s.a.clone().lerp(p, 0.5).add(new THREE.Vector3(Math.sin(this.time * 9) * 0.3, Math.cos(this.time * 7) * 0.3, 0));
        this.ink.addBolt([s.a, mid, p], s.big ? 0.2 : 0.12, 1);
        this._burst(this.sparks, p, s.glow, 2, 1);
        break;
      }
      default:
        this.sparks.material.uniforms.uColor.value.copy(s.glow);
        for (let i = 0; i < (s.big ? 6 : 3); i++) {
          this.sparks.spawn(p.x, p.y, p.z, -v.x * 0.08 + (Math.random() - 0.5), -v.y * 0.08 + (Math.random() - 0.5), 0, 0.3 + Math.random() * 0.2);
        }
    }
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.strikes.forEach((s) => {
      disposeTree(s.head);
      disposeTree(s.halo);
    });
    disposeTree(this.root);
  }
}
