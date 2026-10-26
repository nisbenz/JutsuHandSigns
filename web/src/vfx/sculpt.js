// Sculpting with signed distance fields: shapes are built like clay from
// primitives that melt into each other (smooth union) or carve each other
// (smooth subtraction), then baked once into a single smooth-shaded mesh
// with three's MarchingCubes. Normals come from the field's gradient, so
// there are no seams between "parts" — a jaw flows into a cheek, a horn
// grows out of a brow.
//
// Baking is CPU work (~0.2–1 s for a detailed head), so results are cached
// by key and can be warmed ahead of time with requestIdleCallback.
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";

const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---- primitives: each returns { f(x,y,z) -> distance, c: [x,y,z], r: bound }

export function sphere(c, r) {
  return { f: (x, y, z) => len(x - c[0], y - c[1], z - c[2]) - r, c, r };
}

// Ellipsoid (approximate distance, accurate near the surface).
export function ellipsoid(c, rad) {
  const [a, b, d] = rad;
  return {
    f: (x, y, z) => {
      const px = (x - c[0]) / a;
      const py = (y - c[1]) / b;
      const pz = (z - c[2]) / d;
      const k0 = len(px, py, pz);
      const k1 = len(px / a, py / b, pz / d);
      return k1 === 0 ? -Math.min(a, b, d) : (k0 * (k0 - 1)) / k1;
    },
    c,
    r: Math.max(a, b, d),
  };
}

// Tapered capsule from a (radius r1) to b (radius r2): limbs, horns, noses.
export function cone(a, b, r1, r2 = r1) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const bb = bx * bx + by * by + bz * bz || 1e-9;
  return {
    f: (x, y, z) => {
      const px = x - a[0];
      const py = y - a[1];
      const pz = z - a[2];
      const h = clamp01((px * bx + py * by + pz * bz) / bb);
      return len(px - bx * h, py - by * h, pz - bz * h) - (r1 + (r2 - r1) * h);
    },
    c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    r: Math.sqrt(bb) / 2 + Math.max(r1, r2),
  };
}

// A chain of tapered segments through points with per-point radii — curved
// horns, tails, fingers.
export function chain(points, radii) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) parts.push(cone(points[i], points[i + 1], radii[i], radii[i + 1]));
  return union(parts, 0.02);
}

// Torus in the XY plane (ring around z), rotated by `rx` around x.
export function torus(c, R, r, rx = 0) {
  const cs = Math.cos(rx);
  const sn = Math.sin(rx);
  return {
    f: (x, y, z) => {
      const px = x - c[0];
      const py0 = y - c[1];
      const pz0 = z - c[2];
      const py = py0 * cs - pz0 * sn;
      const pz = py0 * sn + pz0 * cs;
      const q = Math.sqrt(px * px + py * py) - R;
      return Math.sqrt(q * q + pz * pz) - r;
    },
    c,
    r: R + r,
  };
}

export function box(c, half, round = 0) {
  return {
    f: (x, y, z) => {
      const qx = Math.abs(x - c[0]) - half[0] + round;
      const qy = Math.abs(y - c[1]) - half[1] + round;
      const qz = Math.abs(z - c[2]) - half[2] + round;
      const out = len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return out + Math.min(Math.max(qx, qy, qz), 0) - round;
    },
    c,
    r: len(...half),
  };
}

// Mirror a primitive across x = 0 (left/right pairs in one evaluation).
export function mirrorX(p) {
  return { f: (x, y, z) => p.f(Math.abs(x), y, z), c: [0, p.c[1], p.c[2]], r: Math.abs(p.c[0]) + p.r };
}

// Mirror across z = 0 (pairs on either side of a creature facing +x).
export function mirrorZ(p) {
  return { f: (x, y, z) => p.f(x, y, Math.abs(z)), c: [p.c[0], p.c[1], 0], r: Math.abs(p.c[2]) + p.r };
}

// ---- operations --------------------------------------------------------

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}

// Smooth union of many shapes with blend radius k. Shapes whose bounding
// sphere is farther than the current distance + k are skipped (exact for
// the blend, and a large speed-up for big sculpts).
export function union(parts, k = 0.05) {
  const c = [0, 0, 0];
  parts.forEach((p) => p.c.forEach((v, i) => (c[i] += v / parts.length)));
  const r = Math.max(...parts.map((p) => len(p.c[0] - c[0], p.c[1] - c[1], p.c[2] - c[2]) + p.r));
  return {
    f: (x, y, z) => {
      let d = 1e9;
      for (const p of parts) {
        const lower = len(x - p.c[0], y - p.c[1], z - p.c[2]) - p.r;
        if (lower > d + k) continue;
        d = smin(d, p.f(x, y, z), k);
      }
      return d;
    },
    c,
    r,
  };
}

// Carve `cut` out of `base` with a soft edge k.
export function subtract(base, cut, k = 0.03) {
  return {
    f: (x, y, z) => {
      const a = base.f(x, y, z);
      const lower = len(x - cut.c[0], y - cut.c[1], z - cut.c[2]) - cut.r;
      if (lower > k) return a;
      return -smin(-a, cut.f(x, y, z), k);
    },
    c: base.c,
    r: base.r,
  };
}

// ---- baking ------------------------------------------------------------

const cache = new Map();

// Bake a shape to a static BufferGeometry. `bounds` = [[minx,miny,minz],
// [maxx,maxy,maxz]] must contain the shape; `res` is the grid resolution
// along the longest axis.
export function bake(key, makeShape, bounds, res = 96) {
  if (cache.has(key)) return cache.get(key);
  const shape = makeShape();
  const [lo, hi] = bounds;
  const c = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
  const h = Math.max(...[0, 1, 2].map((i) => (hi[i] - lo[i]) / 2)) * 1.04;
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 300000);
  mc.reset();
  mc.isolation = 0;
  const half = res / 2;
  const field = mc.field;
  for (let z = 0; z < res; z++) {
    const wz = c[2] + ((z - half) / half) * h;
    for (let y = 0; y < res; y++) {
      const wy = c[1] + ((y - half) / half) * h;
      for (let x = 0; x < res; x++) {
        const wx = c[0] + ((x - half) / half) * h;
        // Inside is positive for MarchingCubes; scale to grid units so the
        // gradient (normal) estimate is well conditioned.
        field[x + y * res + z * res * res] = (-shape.f(wx, wy, wz) / h) * half;
      }
    }
  }
  mc.update();
  const n = mc.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = c[0] + mc.positionArray[i * 3] * h;
    pos[i * 3 + 1] = c[1] + mc.positionArray[i * 3 + 1] * h;
    pos[i * 3 + 2] = c[2] + mc.positionArray[i * 3 + 2] * h;
    const nx = mc.normalArray[i * 3];
    const ny = mc.normalArray[i * 3 + 1];
    const nz = mc.normalArray[i * 3 + 2];
    const l = len(nx, ny, nz) || 1;
    nor[i * 3] = nx / l;
    nor[i * 3 + 1] = ny / l;
    nor[i * 3 + 2] = nz / l;
  }
  mc.geometry.dispose();
  mc.material.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  cache.set(key, geo);
  return geo;
}

// Warm the cache when the browser is idle (e.g. while the player is still
// doing hand signs) so casting doesn't hitch.
export function bakeWhenIdle(fn) {
  const run = () => {
    try {
      fn();
    } catch (err) {
      console.warn("sculpt prebake failed", err);
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 50);
}
