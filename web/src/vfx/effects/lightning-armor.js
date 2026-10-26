// Lightning Release Armor: the whole body sheathed in crackling chakra.
// Bolts crawl along each limb (pose-tracked), static stands up off the
// shoulders and head, and the room goes cold. The Lariat variant ends with a
// screen-wide lightning sweep from the arm.
import * as THREE from "three";
import { BODY_CHAINS, fallbackBody } from "../tracking";
import { LightningRibbons, Shockwave, Sparks, boltPath, disposeTree, glowSprite, lerp, pxPerUnit, span } from "../kit";

const REGEN_EVERY = 0.04;
const COLD = new THREE.Color(0.55, 0.8, 1.0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

class LightningArmor {
  static needs = ["pose"];
  static duration = 6;

  constructor(stage, { power = 1 } = {}, finisher = null) {
    this.stage = stage;
    this.power = power;
    this.finisher = finisher;
    this.root = new THREE.Group();
    this.ribbons = new LightningRibbons({
      maxPoints: 12000,
      color: new THREE.Color(0.25, 0.5, 1.5),
      coreColor: new THREE.Color(1.0, 1.25, 1.7),
    });
    this.root.add(this.ribbons.mesh);
    this.sparks = new Sparks({ max: 600, color: new THREE.Color(1.2, 1.5, 2.2), size: 0.05, drag: 1.5 });
    this.root.add(this.sparks.points);
    this.glows = Array.from({ length: 6 }, () => {
      const g = glowSprite(new THREE.Color(0.03, 0.07, 0.22));
      this.root.add(g);
      return g;
    });
    if (finisher === "lariat") {
      this.wave = new Shockwave(new THREE.Color(0.35, 0.5, 0.9), 0.04);
      this.root.add(this.wave.mesh);
    }
    stage.scene.add(this.root);
    this._since = Infinity;
  }

  _world(p, target) {
    return this.stage.toWorld(p.x, p.y, 0, target);
  }

  // One jagged bolt that hugs the segment a->b, pushed outward from the
  // torso so it reads as a shell around the body rather than inside it.
  _crawl(pa, pb, center, r, width, intensity) {
    this._world(pa, _a);
    this._world(pb, _b);
    const t0 = Math.random() * 0.4;
    const t1 = t0 + 0.4 + Math.random() * 0.6;
    const from = _a.clone().lerp(_b, t0);
    const to = _a.clone().lerp(_b, Math.min(1, t1));
    for (const p of [from, to]) {
      _d.copy(p).sub(center).setZ(0).normalize();
      p.addScaledVector(_d, r * (0.1 + Math.random() * 0.35));
      p.z += (Math.random() - 0.5) * r * 0.6;
    }
    const path = boltPath(from, to, 4, 0.2);
    this.ribbons.addBolt(path, width, intensity);
    return to;
  }

  _regen(body, energy, extraBolts) {
    const st = this.stage;
    const r = st.toWorldSize(body.span);
    const center = st.toWorld(body.torsoX, body.torsoY);
    const rib = this.ribbons;
    rib.begin();
    const perChain = Math.round(lerp(1, 3, energy));
    for (const chain of BODY_CHAINS) {
      for (let c = 0; c < perChain; c++) {
        const i = Math.floor(Math.random() * (chain.length - 1));
        const end = this._crawl(body.joints[chain[i]], body.joints[chain[i + 1]], center, r, r * 0.035, 0.6 + Math.random() * 0.6);
        if (Math.random() < 0.25) {
          this.sparks.spawn(end.x, end.y, end.z, (Math.random() - 0.5) * r * 3, Math.random() * r * 3, 0, 0.3 + Math.random() * 0.3);
        }
      }
    }
    // Static standing off the shoulders and the head.
    const heads = [body.joints.lShoulder, body.joints.rShoulder, body.joints.nose];
    for (let i = 0; i < Math.round(3 * energy) + 1; i++) {
      const base = this._world(heads[Math.floor(Math.random() * heads.length)], new THREE.Vector3());
      base.y += r * 0.15;
      const tip = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 0.6, r * (0.3 + Math.random() * 0.5), 0));
      rib.addBolt(boltPath(base, tip, 3, 0.3), r * 0.025, 0.8);
    }
    extraBolts?.(rib, r);
    rib.end();
  }

  update(t, dt, track) {
    const st = this.stage;
    const b = track.body.seen ? track.body : fallbackBody(st.width, st.height);
    const presence = track.body.seen ? lerp(0.4, 1, track.body.presence) : 0.7;
    const D = this.constructor.duration;
    const build = span(t, 0, 1.0);
    const fade = 1 - span(t, D - 0.5, D);
    const energy = build * fade * presence * (0.85 + 0.3 * this.power);
    const flicker = 0.75 + Math.random() * 0.5;

    const finish = this.finisher === "lariat" ? this._lariat(t, b) : null;

    this._since += dt;
    if (this._since >= REGEN_EVERY) {
      this._since = 0;
      this._regen(b, Math.min(1, energy), finish?.bolts);
    }
    this.ribbons.material.uniforms.uIntensity.value = energy * flicker;
    this.sparks.setPixelScale(pxPerUnit(st));
    this.sparks.material.uniforms.uSize.value = st.toWorldSize(b.span) * 0.05;
    this.sparks.gravity = -st.toWorldSize(b.span) * 4;
    this.sparks.update(dt);

    const anchors = ["nose", "lShoulder", "rShoulder", "lWrist", "rWrist", null];
    this.glows.forEach((g, i) => {
      const p = anchors[i] ? b.joints[anchors[i]] : { x: b.torsoX, y: b.torsoY };
      this._world(p, g.position);
      g.scale.setScalar(st.toWorldSize(b.span) * (i === 5 ? 1.6 : 1.0) * flicker);
      g.material.opacity = energy;
    });

    st.setLight(0, b.torsoX, b.torsoY, b.span * 2.2, COLD, 0.7 * energy * flicker);
    st.setLight(1, b.joints.nose.x, b.joints.nose.y, b.span * 1.2, COLD, 0.6 * energy * flicker);
    st.darken = 0.35 * energy;
    st.desaturate = 0.4 * energy;
    st.tint.setRGB(lerp(1, 0.86, energy), lerp(1, 0.94, energy), lerp(1, 1.12, energy));
    st.vignette = 0.25 + 0.35 * energy;
    st.vignetteColor.setRGB(0, 0.01, 0.05);
    st.aberration = 0.03 + 0.05 * energy;
    st.shake(0.002 * energy * flicker);
    if (Math.random() < 0.05 * energy) st.flash.setRGB(0.03, 0.04, 0.06);
    finish?.apply();
  }

  // Lariat: at 3.2s the armored arm sweeps a lightning arc across the frame.
  _lariat(t, body) {
    const st = this.stage;
    const at = 3.2;
    const sweep = span(t, at, at + 0.22);
    if (t < at) return null;
    const hit = Math.exp(-(t - at - 0.22) * 5) * (t > at + 0.22 ? 1 : 0);
    // Swing from whichever wrist is nearer a screen edge, across to the other side.
    // Picked once, so the swing can't flip arms mid-sweep.
    this._arm ??=
      Math.abs(body.joints.lWrist.x - st.width / 2) > Math.abs(body.joints.rWrist.x - st.width / 2) ? "lWrist" : "rWrist";
    const wrist = body.joints[this._arm];
    const dir = wrist.x < st.width / 2 ? 1 : -1;
    const endX = lerp(wrist.x, dir > 0 ? st.width * 1.05 : -st.width * 0.05, sweep);
    const fadeArc = 1 - span(t, at + 0.5, at + 1.4);
    return {
      bolts: (rib, r) => {
        if (fadeArc <= 0) return;
        const steps = 6;
        for (let k = 0; k < 3; k++) {
          const pts = [];
          for (let i = 0; i <= steps; i++) {
            const f = i / steps;
            const x = lerp(wrist.x, endX, f);
            // The swing arcs: rises in the middle like an arm's swing path.
            const y = wrist.y - Math.sin(f * Math.PI) * body.span * 0.5 + (Math.random() - 0.5) * body.span * 0.1;
            pts.push(st.toWorld(x, y, (Math.random() - 0.5) * 0.3));
          }
          const curve = [];
          for (let i = 0; i < pts.length - 1; i++) curve.push(...boltPath(pts[i], pts[i + 1], 3, 0.25).slice(0, -1));
          curve.push(pts[pts.length - 1]);
          rib.addBolt(curve, r * (0.05 - k * 0.012) * fadeArc, 1.0);
        }
      },
      apply: () => {
        this.wave.mesh.position.copy(st.toWorld(endX, wrist.y));
        this.wave.mesh.scale.set(st.toWorldSize(st.height) * 1.2, st.toWorldSize(st.height) * 0.6, 1);
        this.wave.progress = t > at + 0.22 ? Math.min(1, (t - at - 0.22) * 2) : 0;
        if (hit > 0.02) {
          st.flash.setRGB(0.12 * hit, 0.16 * hit, 0.22 * hit);
          st.shake(0.035 * hit);
          st.aberration = 0.25 * hit;
          st.bloom.strength = 0.8 + 0.4 * hit;
        }
      },
    };
  }

  dispose() {
    disposeTree(this.root);
  }
}

export default LightningArmor;

export class Lariat extends LightningArmor {
  static duration = 5.5;
  constructor(stage, opts) {
    super(stage, opts, "lariat");
  }
}
