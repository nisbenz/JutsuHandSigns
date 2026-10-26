// Fallback finisher for techniques that have no dedicated 3D cast yet (taijutsu,
// mind techniques, puppets, …): chakra of the technique's element gathers
// into the caster's hands, then fires on the strike beat. Same interface as
// the effects in ../effects, so the FinisherDirector treats it like them.
import * as THREE from "three";
import { LightningRibbons, Shockwave, Sparks, boltPath, disposeTree, glowSprite, pxPerUnit, smooth, span } from "../kit";
import { Puffs } from "../elements";
import { elementOf } from "./elements";
import { STRIKE_BEAT_S } from "./finisher-plan";

export default class GenericFinisher {
  static needs = ["pose"];
  static duration = 2.6;

  constructor(stage, { skill } = {}) {
    this.stage = stage;
    const el = elementOf(skill);
    this.kind = el.kind;
    this.glow = new THREE.Color(el.glow).multiplyScalar(1.8);
    this.core = new THREE.Color(el.core).multiplyScalar(1.6);
    this.root = new THREE.Group();
    this.orb = glowSprite(this.core.clone());
    this.halo = glowSprite(this.glow.clone().multiplyScalar(0.5));
    this.sparks = new Sparks({ max: 400, color: this.glow.clone(), size: 0.06, gravity: 0, drag: 0.8 });
    this.wave = new Shockwave(this.glow.clone(), 0.05);
    this.ribbons = new LightningRibbons({ color: this.glow.clone(), coreColor: this.core.clone() });
    this.fire = this.kind === "fire" || this.kind === "blast" ? new Puffs({ max: 160, mode: "fire", lift: 1.2 }) : null;
    this.root.add(this.halo, this.orb, this.sparks.points, this.wave.mesh, this.ribbons.mesh);
    if (this.fire) this.root.add(this.fire.mesh);
    stage.scene.add(this.root);
    this._at = new THREE.Vector3();
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    const at = st.toWorld(h.x, h.y, 0.4, this._at);
    const size = st.toWorldSize(Math.max(70, h.size || 90));
    const hit = STRIKE_BEAT_S;
    const build = smooth(span(t, 0, hit));
    const fade = 1 - smooth(span(t, hit + 0.3, GenericFinisher.duration));

    // Build-up: sparks sucked into the hands, the orb swelling.
    if (t < hit) {
      for (let k = 0; k < 3 + build * 6; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = size * (2 + Math.random() * 1.5) * (1 - build * 0.4);
        const life = 0.4;
        this.sparks.spawn(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, at.z, (-Math.cos(a) * r) / life, (-Math.sin(a) * r) / life, 0, life);
      }
      if (this.fire && Math.random() < build) this.fire.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 0.4, 0.6, 0, size * 0.5, 0.5, 2);
    }
    const pulse = 1 + 0.1 * Math.sin(t * 30);
    this.orb.position.copy(at);
    this.halo.position.copy(at);
    this.orb.scale.setScalar(size * (0.3 + 1.2 * build) * pulse * fade);
    this.halo.scale.setScalar(size * (1 + 3 * build) * fade);

    // Lightning crackles around the hands while it charges.
    this.ribbons.begin();
    if (this.kind === "lightning" && fade > 0.05) {
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const end = at.clone().add(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(size * (1 + build * 1.5)));
        this.ribbons.addBolt(boltPath(at, end, 4, 0.3), 0.04, fade);
      }
    }
    this.ribbons.end();

    // Payoff on the beat: ring, burst, a darker world so the release pops.
    const p = span(t, hit, hit + 0.45);
    this.wave.mesh.visible = p > 0 && p < 1;
    if (this.wave.mesh.visible) {
      this.wave.mesh.position.copy(at);
      this.wave.mesh.scale.setScalar(size * 10);
      this.wave.progress = p;
    }
    if (t >= hit && !this.burst) {
      this.burst = true;
      for (let k = 0; k < 80; k++) {
        const a = Math.random() * Math.PI * 2;
        const v = 3 + Math.random() * 5;
        this.sparks.spawn(at.x, at.y, at.z, Math.cos(a) * v, Math.sin(a) * v, Math.random() * 2, 0.6);
      }
      st.shake(0.012);
    }
    st.darken = 0.25 * build * fade;
    st.setLight(0, h.x, h.y, Math.max(160, (h.size || 90) * 4), this.glow, (0.4 + 0.8 * build) * fade);

    const ppu = pxPerUnit(st);
    this.sparks.setPixelScale(ppu);
    this.sparks.update(dt);
    this.fire?.update(dt, t);
  }

  dispose() {
    disposeTree(this.root);
  }
}
