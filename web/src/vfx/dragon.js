// Serpentine creature rig shared by the dragons and the giant snake: a
// SpineTube body plus *sculpted* parts (see sculpt.js) — a head with snout,
// brow, horns, cheek spikes and mane; a separately hinged jaw with teeth and
// beard; clawed legs; a tail tuft — and instanced dorsal spines, all
// re-posed every frame along the body's spine. "Up" for every part is the
// world up projected off the local tangent, so spines and horns stay on the
// creature's back instead of rolling around the tube.
import * as THREE from "three";
import { SpineTube } from "./elements";
import { bake, box, chain, cone, ellipsoid, mirrorZ, sphere, subtract, union } from "./sculpt";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Head-space sculpts: facing +X, +Y up, Z to the side; ~1 unit long.
const JAW_PIVOT = [-0.08, -0.18, 0];

const SCULPTS = {
  "dragon-head": [
    () => {
      let head = union(
        [
          ellipsoid([0, 0.06, 0], [0.36, 0.27, 0.3]), // cranium
          cone([0.08, 0.02, 0], [0.86, -0.02, 0], 0.21, 0.12), // snout
          cone([0.15, 0.14, 0], [0.75, 0.06, 0], 0.08, 0.04), // snout ridge
          mirrorZ(ellipsoid([0.84, 0.04, 0.07], [0.07, 0.06, 0.06])), // nose bulbs
          mirrorZ(cone([0.05, 0.2, 0.15], [0.4, 0.15, 0.14], 0.08, 0.045)), // brow
          mirrorZ(cone([-0.05, -0.04, 0.24], [-0.45, -0.02, 0.46], 0.07, 0.012)), // cheek spikes
          mirrorZ(chain([[0, 0.2, 0.12], [-0.35, 0.45, 0.22], [-0.8, 0.52, 0.3], [-1.1, 0.44, 0.32]], [0.075, 0.055, 0.035, 0.01])), // horns
          mirrorZ(cone([-0.42, 0.46, 0.23], [-0.52, 0.78, 0.26], 0.035, 0.008)), // horn tines
          ...[0, 1, 2, 3].map((i) => cone([-0.2 - i * 0.12, 0.2 - i * 0.02, 0], [-0.5 - i * 0.14, 0.5 - i * 0.06, 0], 0.06, 0.01)), // mane
          ...[0, 1, 2].map((i) => mirrorZ(cone([-0.2 - i * 0.12, 0.1, 0.16], [-0.45 - i * 0.14, 0.25, 0.32], 0.05, 0.008))),
        ],
        0.06
      );
      head = subtract(head, box([0.45, -0.24, 0], [0.62, 0.08, 0.4]), 0.03); // flat palate
      head = subtract(head, mirrorZ(ellipsoid([0.3, 0.12, 0.19], [0.07, 0.04, 0.05])), 0.02); // eye sockets
      head = subtract(head, mirrorZ(sphere([0.9, 0.05, 0.06], 0.03)), 0.01); // nostrils
      const teeth = [0, 1, 2, 3, 4].map((i) => mirrorZ(cone([0.2 + i * 0.13, -0.12, 0.12], [0.2 + i * 0.13, -0.25, 0.12], 0.024, 0.004)));
      return union([head, ...teeth], 0.01);
    },
    [[-1.25, -0.35, -0.55], [1.05, 0.9, 0.55]],
    100,
  ],
  "dragon-jaw": [
    () => {
      let jaw = union(
        [
          cone([-0.08, -0.2, 0], [0.78, -0.22, 0], 0.13, 0.07),
          ellipsoid([0.74, -0.22, 0], [0.09, 0.06, 0.08]),
          mirrorZ(cone([-0.05, -0.18, 0.1], [0.6, -0.2, 0.08], 0.07, 0.04)),
          cone([0.55, -0.28, 0], [0.35, -0.62, 0], 0.04, 0.005), // beard
          mirrorZ(cone([0.3, -0.27, 0.08], [0.12, -0.55, 0.12], 0.03, 0.004)),
        ],
        0.05
      );
      jaw = subtract(jaw, box([0.4, -0.08, 0], [0.55, 0.06, 0.3]), 0.02);
      const teeth = [0, 1, 2, 3].map((i) => mirrorZ(cone([0.25 + i * 0.13, -0.15, 0.1], [0.25 + i * 0.13, -0.04, 0.1], 0.022, 0.003)));
      return union([jaw, ...teeth], 0.01);
    },
    [[-0.25, -0.7, -0.3], [0.95, 0.02, 0.3]],
    72,
  ],
  "snake-head": [
    () => {
      let head = union(
        [
          ellipsoid([0.1, 0.02, 0], [0.55, 0.2, 0.33]),
          ellipsoid([0.55, 0, 0], [0.32, 0.14, 0.23]),
          mirrorZ(ellipsoid([0.25, 0.12, 0.16], [0.16, 0.07, 0.08])), // heavy brow scales
          mirrorZ(ellipsoid([-0.15, 0.0, 0.26], [0.22, 0.12, 0.1])), // venom glands
        ],
        0.08
      );
      head = subtract(head, box([0.35, -0.2, 0], [0.6, 0.06, 0.4]), 0.03);
      head = subtract(head, mirrorZ(ellipsoid([0.36, 0.08, 0.2], [0.06, 0.035, 0.05])), 0.02);
      head = subtract(head, mirrorZ(sphere([0.83, 0.04, 0.06], 0.025)), 0.01);
      return union([head, mirrorZ(cone([0.62, -0.1, 0.1], [0.6, -0.4, 0.11], 0.035, 0.004))], 0.01); // fangs
    },
    [[-0.5, -0.5, -0.45], [0.95, 0.3, 0.45]],
    90,
  ],
  "snake-jaw": [
    () => subtract(union([cone([-0.1, -0.18, 0], [0.7, -0.18, 0], 0.15, 0.08), mirrorZ(cone([-0.08, -0.17, 0.12], [0.55, -0.17, 0.1], 0.08, 0.04))], 0.06), box([0.35, -0.06, 0], [0.55, 0.06, 0.4]), 0.02),
    [[-0.3, -0.4, -0.3], [0.85, 0.02, 0.3]],
    64,
  ],
  leg: [
    () =>
      union(
        [
          cone([0, 0, 0], [0.05, -0.22, 0], 0.075, 0.06),
          cone([0.05, -0.22, 0], [0.02, -0.4, 0], 0.055, 0.045),
          ellipsoid([0.06, -0.42, 0], [0.08, 0.035, 0.06]),
          ...[-1, 0, 1].map((k) => cone([0.1, -0.42, k * 0.04], [0.22, -0.46, k * 0.055], 0.022, 0.003)),
        ],
        0.04
      ),
    [[-0.15, -0.55, -0.2], [0.3, 0.12, 0.2]],
    56,
  ],
  tail: [
    () =>
      union(
        [[-0.5, 0.3, 0], [-0.58, 0, 0], [-0.5, -0.3, 0], [-0.45, 0.15, 0.25], [-0.45, 0.15, -0.25]].map((tip) => cone([0, 0, 0], tip, 0.08, 0.008)),
        0.05
      ),
    [[-0.7, -0.45, -0.35], [0.15, 0.45, 0.35]],
    56,
  ],
};

function part(name) {
  const [make, bounds, res] = SCULPTS[name];
  return bake(name, make, bounds, res);
}

// Thin whisker tube along a quadratic curve in head space.
function whisker(a, b, c, r) {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c));
  return new THREE.TubeGeometry(curve, 16, r, 6, false);
}

export class DragonModel {
  // Bake every sculpt this style needs (call early, e.g. when idle).
  static prebake(style = "dragon") {
    part(`${style}-head`);
    part(`${style}-jaw`);
    if (style === "dragon") {
      part("leg");
      part("tail");
    }
  }

  // style: "dragon" | "snake". headMaterial: optional separate material for
  // the head and jaw (patterned body shaders smear on sculpted parts).
  constructor(material, { segments = 90, style = "dragon", legs = style === "dragon", spines = style === "dragon", headMaterial = material } = {}) {
    this.segments = segments;
    this.group = new THREE.Group();
    this.tube = new SpineTube(material, { segments, radial: 18 });
    this.group.add(this.tube.mesh);

    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(part(`${style}-head`), headMaterial));
    this.jaw = new THREE.Group();
    this.jaw.position.set(...JAW_PIVOT);
    const jawMesh = new THREE.Mesh(part(`${style}-jaw`), headMaterial);
    jawMesh.position.set(-JAW_PIVOT[0], -JAW_PIVOT[1], -JAW_PIVOT[2]);
    this.jaw.add(jawMesh);
    this.head.add(this.jaw);
    this.whiskers = [];
    if (style === "dragon") {
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(whisker([0.8, -0.02, side * 0.12], [0.6, -0.2, side * 0.6], [0.0, -0.1, side * 1.1], 0.014), headMaterial);
        this.head.add(w);
        this.whiskers.push(w);
      }
    }
    this.group.add(this.head);

    this.spines = null;
    if (spines) {
      this.spineCount = 30;
      this.spines = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 10), material, this.spineCount);
      this.spines.frustumCulled = false;
      this.group.add(this.spines);
    }
    this.legs = legs
      ? [0.32, 0.62].flatMap((u) =>
          [-1, 1].map((side) => {
            const mesh = new THREE.Group();
            mesh.add(new THREE.Mesh(part("leg"), material));
            return { u, side, mesh };
          })
        )
      : [];
    this.legs.forEach((l) => this.group.add(l.mesh));
    this.tailTuft = style === "dragon" ? new THREE.Mesh(part("tail"), material) : null;
    if (this.tailTuft) this.group.add(this.tailTuft);
    this.points = Array.from({ length: segments }, () => new THREE.Vector3());
    this.radii = new Float32Array(segments);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  // Local frame at spine index i: tangent (forward), up, side.
  frame(i) {
    const n = this.segments;
    const t = this.points[Math.min(i + 1, n - 1)].clone().sub(this.points[Math.max(i - 1, 0)]).normalize();
    const up = WORLD_UP.clone().addScaledVector(t, -t.y);
    if (up.lengthSq() < 1e-4) up.set(0, 0, 1);
    up.normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    return { t, up, side };
  }

  // Orient an object so its +X follows `t` and +Y follows `up`.
  _orient(obj, f) {
    this._m.makeBasis(f.t, f.up, f.side);
    obj.quaternion.setFromRotationMatrix(this._m);
  }

  // points: spine (tail -> head), thick: body radius (world units),
  // t: time for secondary motion, jaw: 0 closed .. 1 wide open.
  update(points, thick, t, jaw = 0) {
    const n = this.segments;
    for (let i = 0; i < n; i++) this.points[i].copy(points[i]);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      // Thin tail, full body, a narrower neck, then the head takes over.
      let r = thick * (0.12 + 0.88 * Math.min(1, u * 1.7));
      if (u > 0.82) r *= 1 - (u - 0.82) * 2.6;
      this.radii[i] = Math.max(thick * 0.05, r * (1 + 0.05 * Math.sin(u * 40 - t * 6)));
    }
    this.tube.update(this.points, this.radii);

    const hf = this.frame(n - 2);
    this.head.position.copy(this.points[n - 1]).addScaledVector(hf.t, thick * 0.6);
    this._orient(this.head, hf);
    this.head.scale.setScalar(thick * 3.2);
    this.jaw.rotation.z = -0.65 * jaw;
    this.whiskers.forEach((w, k) => {
      w.rotation.y = Math.sin(t * 3 + k * 2) * 0.25;
    });

    if (this.spines) {
      for (let k = 0; k < this.spineCount; k++) {
        const i = Math.round((0.12 + (k / this.spineCount) * 0.72) * (n - 1));
        const f = this.frame(i);
        const r = this.radii[i];
        const size = r * 0.9;
        // Cone's +Y is its tip: point it up and back.
        const dir = f.up.clone().addScaledVector(f.t, -0.6).normalize();
        this._q.setFromUnitVectors(WORLD_UP, dir);
        this._m.compose(this.points[i].clone().addScaledVector(f.up, r * 0.85), this._q, new THREE.Vector3(size * 0.45, size, size * 0.45));
        this.spines.setMatrixAt(k, this._m);
      }
      this.spines.instanceMatrix.needsUpdate = true;
    }
    for (const leg of this.legs) {
      const i = Math.round(leg.u * (n - 1));
      const f = this.frame(i);
      leg.mesh.position.copy(this.points[i]).addScaledVector(f.side, leg.side * this.radii[i] * 0.85).addScaledVector(f.up, -this.radii[i] * 0.3);
      this._orient(leg.mesh, f);
      // Paddle the legs as it swims.
      leg.mesh.rotateZ(Math.sin(t * 5 + leg.u * 9 + leg.side) * 0.5);
      leg.mesh.rotateX(leg.side * 0.5);
      leg.mesh.scale.setScalar(thick * 1.8);
    }
    if (this.tailTuft) {
      const tf = this.frame(1);
      this.tailTuft.position.copy(this.points[0]);
      this._orient(this.tailTuft, tf);
      this.tailTuft.scale.setScalar(thick * 2.4);
    }
    return { headPos: this.head.position, headFrame: hf };
  }
}
