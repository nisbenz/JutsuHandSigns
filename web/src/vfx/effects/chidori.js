// Chidori: a crackling knot of lightning in the palm, with arcs licking
// back along the forearm. Timeline: a few sparks catch (build) -> full
// shrieking discharge (sustain) -> one huge screen-spanning burst (release).
import * as THREE from "three";
import {
  ADDITIVE,
  LightningRibbons,
  Sparks,
  boltPath,
  disposeTree,
  glowSprite,
  lerp,
  pxPerUnit,
  span,
} from "../kit";

const DURATION = 5.5;
const RELEASE_AT = 4.8;
const REGEN_EVERY = 0.035; // bolts re-roll ~28x/s — the flicker *is* the look

const COLD = new THREE.Color(0.55, 0.8, 1.0);

const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _arm = new THREE.Vector3();

function randomDir(target) {
  // Mostly spread across the screen plane; a little depth keeps it 3D.
  target.set(Math.random() * 2 - 1, Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.45);
  return target.normalize();
}

export default class Chidori {
  static needs = ["hand"];
  static duration = DURATION;

  constructor(stage, { power = 1 } = {}) {
    this.stage = stage;
    this.power = power;
    this.root = new THREE.Group();

    this.ribbons = new LightningRibbons({
      maxPoints: 8000,
      color: new THREE.Color(0.25, 0.5, 1.6),
      coreColor: new THREE.Color(1.1, 1.35, 1.8),
    });
    this.root.add(this.ribbons.mesh);

    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.6, 2.2), ...ADDITIVE })
    );
    this.root.add(this.core);
    this.halo = glowSprite(new THREE.Color(0.05, 0.13, 0.5));
    this.root.add(this.halo);

    this.sparks = new Sparks({ max: 500, color: new THREE.Color(1.6, 2.0, 3.0), size: 0.05, gravity: -6, drag: 1.5 });
    this.root.add(this.sparks.points);

    stage.scene.add(this.root);
    this._origin = new THREE.Vector3();
    this._sinceRegen = Infinity;
  }

  _regen(origin, r, build, discharge, armDir) {
    const rib = this.ribbons;
    rib.begin();
    const count = Math.round(lerp(2, 15, build) + discharge * 10);
    for (let i = 0; i < count; i++) {
      randomDir(_dir);
      // A quarter of the arcs crawl back along the forearm.
      const alongArm = Math.random() < 0.25;
      if (alongArm) _dir.lerp(armDir, 0.75).normalize();
      let len = r * (1.6 + Math.random() * (alongArm ? 4.0 : 3.2)) * lerp(0.4, 1, build);
      if (discharge > 0) len *= 1 + discharge * (4 + Math.random() * 6);
      _end.copy(origin).addScaledVector(_dir, len);
      const path = boltPath(origin, _end, 5, 0.24);
      const intensity = 0.6 + Math.random() * 0.7;
      rib.addBolt(path, r * (0.07 + discharge * 0.05), intensity);

      // Forks off the main bolt.
      const forks = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 2) : 0;
      for (let f = 0; f < forks; f++) {
        const from = path[4 + Math.floor(Math.random() * (path.length - 8))];
        randomDir(_dir).lerp(_end.clone().sub(from).normalize(), 0.5).normalize();
        const fork = boltPath(from, from.clone().addScaledVector(_dir, len * (0.2 + Math.random() * 0.3)), 3, 0.3);
        rib.addBolt(fork, r * 0.035, intensity * 0.7);
      }

      if (Math.random() < 0.6) {
        const s = r * (2 + Math.random() * 4);
        this.sparks.spawn(_end.x, _end.y, _end.z, _dir.x * s, _dir.y * s, _dir.z * s, 0.25 + Math.random() * 0.35);
      }
    }
    rib.end();
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    const k = 0.85 + 0.3 * this.power;

    const ax = h.seen ? h.x : st.width / 2;
    const ay = h.seen ? h.y : st.height * 0.62;
    const rPx = (h.seen ? h.size * 0.55 : st.height * 0.09) * k;
    st.toWorld(ax, ay, 0, this._origin);
    const r = st.toWorldSize(rPx);
    // Screen-space forearm direction (wrist side of the palm), world y-up.
    _arm.set(-h.dirX, h.dirY, 0);
    if (!h.seen) _arm.set(0, -1, 0);

    const build = span(t, 0.0, 0.9);
    const release = span(t, RELEASE_AT, DURATION);
    const discharge = release > 0 ? Math.max(0, 1 - release * 3) : 0;
    const fade = 1 - span(t, RELEASE_AT + 0.2, DURATION);
    const presence = lerp(0.35, 1, h.seen ? h.presence : 1);
    const energy = build * fade * presence;
    const flicker = 0.75 + Math.random() * 0.5;

    this._sinceRegen += dt;
    if (this._sinceRegen >= REGEN_EVERY) {
      this._sinceRegen = 0;
      this._regen(this._origin, r, build, discharge, _arm);
    }
    this.ribbons.material.uniforms.uIntensity.value = energy * flicker;

    // Constant crackle of sparks from the core itself.
    const emit = Math.round(dt * 260 * energy);
    for (let i = 0; i < emit; i++) {
      randomDir(_dir);
      const s = r * (3 + Math.random() * 5);
      this.sparks.spawn(this._origin.x, this._origin.y, this._origin.z, _dir.x * s, _dir.y * s, _dir.z * s, 0.15 + Math.random() * 0.3);
    }
    this.sparks.setPixelScale(pxPerUnit(st));
    this.sparks.material.uniforms.uSize.value = r * 0.12;
    this.sparks.gravity = -r * 14;
    this.sparks.update(dt);

    this.core.position.copy(this._origin);
    this.core.scale.setScalar(r * 0.22 * (0.8 + 0.4 * Math.random()) * Math.max(energy, 1e-4));
    this.halo.position.copy(this._origin);
    this.halo.scale.setScalar(r * 4.5 * flicker * (1 + discharge * 2));
    this.halo.material.opacity = energy;

    st.setLight(0, ax, ay, rPx * 4 * (1 + discharge), COLD, (1.4 + discharge * 2) * energy * flicker);
    st.darken = 0.4 * Math.max(energy, discharge);
    st.desaturate = 0.45 * energy;
    st.tint.setRGB(0.85, 0.93, 1.12);
    st.vignette = 0.3 + 0.35 * energy;
    st.vignetteColor.setRGB(0.0, 0.01, 0.05);
    st.aberration = 0.03 + 0.06 * energy + discharge * 0.3;
    st.bloom.strength = 1.1 + 0.4 * energy + discharge * 1.2;
    st.shake(0.003 * energy * flicker);
    // Occasional full-frame strobe, like the bolts lighting the room.
    if (Math.random() < 0.06 * energy || discharge > 0) {
      const f = discharge > 0 ? 0.5 * discharge : 0.06;
      st.flash.setRGB(f * 0.6, f * 0.8, f);
    }
    if (discharge > 0) st.shake(0.025 * discharge);
  }

  dispose() {
    disposeTree(this.root);
  }
}
