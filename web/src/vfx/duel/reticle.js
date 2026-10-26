// Lock-on reticle over a player's detected hand sign: four glowing corner
// brackets and a dashed ring. Cyan while the detector sees a sign, green when
// it is the right one; the brackets close in as the seal is held.
import * as THREE from "three";
import { ADDITIVE, disposeTree } from "../kit";

const SEEK = new THREE.Color(0.35, 1.3, 2.2);
const MATCH = new THREE.Color(0.35, 2.2, 0.7);
const RING_SEGMENTS = 10;

export class Reticle {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.color = SEEK.clone();
    this.mat = new THREE.MeshBasicMaterial({ color: this.color, opacity: 0, ...ADDITIVE });
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.color, opacity: 0, ...ADDITIVE });

    const quad = new THREE.PlaneGeometry(1, 1);
    this.bars = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(quad, this.mat);
      this.root.add(m);
      return m;
    });

    this.ring = new THREE.Group();
    const step = (Math.PI * 2) / RING_SEGMENTS;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      this.ring.add(new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 6, 1, i * step, step * 0.55), this.ringMat));
    }
    this.root.add(this.ring);
    scene.add(this.root);

    // Smoothed box in viewport px.
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.presence = 0;
    this._pos = new THREE.Vector3();
  }

  // box: {x, y, w, h} in viewport px, or null when nothing is detected.
  update(dt, stage, box, match, hold) {
    if (box) {
      if (this.presence < 0.05) {
        Object.assign(this, box); // appear in place rather than sliding in
      } else {
        const k = 1 - Math.exp(-dt * 18);
        this.x += (box.x - this.x) * k;
        this.y += (box.y - this.y) * k;
        this.w += (box.w - this.w) * k;
        this.h += (box.h - this.h) * k;
      }
    }
    this.presence += ((box ? 1 : 0) - this.presence) * (1 - Math.exp(-dt * (box ? 14 : 6)));
    this.root.visible = this.presence > 0.01;
    if (!this.root.visible) return;

    this.color.lerp(match ? MATCH : SEEK, 1 - Math.exp(-dt * 12));
    this.mat.opacity = this.presence;
    this.ringMat.opacity = this.presence * 0.55;

    stage.toWorld(this.x, this.y, 0, this._pos);
    this.root.position.copy(this._pos);

    const W = stage.toWorldSize(this.w);
    const H = stage.toWorldSize(this.h);
    const pull = 1 - 0.22 * (match ? hold : 0);
    const arm = Math.min(W, H) * 0.3;
    const thick = stage.toWorldSize(Math.max(3, this.h * 0.022));
    let b = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = (sx * W * pull) / 2;
        const cy = (sy * H * pull) / 2;
        this.bars[b].position.set(cx - (sx * arm) / 2, cy, 0);
        this.bars[b++].scale.set(arm, thick, 1);
        this.bars[b].position.set(cx, cy - (sy * arm) / 2, 0);
        this.bars[b++].scale.set(thick, arm, 1);
      }
    }

    this.ring.scale.setScalar(Math.max(W, H) * 0.62 * pull);
    this.ring.rotation.z -= dt * (1.2 + (match ? hold : 0) * 7);
  }

  dispose() {
    disposeTree(this.root);
  }
}
