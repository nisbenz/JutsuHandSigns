// Downloaded Susanoo models (CC-BY 4.0, see public/models/susanoo/CREDITS.md)
// adapted to the cast: unwanted parts hidden, every material swapped for the
// chakra skin shader (which keeps the model's own texture as surface
// detail), and a framing so each model's shoulders land a shoulder-width
// above the player's.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// shoulders: midpoint between the model's shoulder joints (model units);
// width: distance between them; hide: mesh indices in traversal order.
export const SUSANOO_MODELS = {
  madara: {
    url: "models/susanoo/madara.glb",
    // The file also contains Madara himself and his gunbai fan.
    hide: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 18],
    shoulders: [0, 2650, 0],
    width: 1400,
  },
  sasuke: { url: "models/susanoo/sasuke.glb", hide: [], shoulders: [0, 250, 0], width: 340 },
  darko: { url: "models/susanoo/darko.glb", hide: [], shoulders: [-0.03, 0.4, 0], width: 0.78 },
};

const loads = new Map();

// Load (once) and return the glTF scene for a model key.
export function loadSusanooModel(key) {
  if (!loads.has(key)) {
    const cfg = SUSANOO_MODELS[key];
    const p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${cfg.url}`).then((gltf) => {
      const meshes = [];
      gltf.scene.traverse((o) => {
        if (o.isMesh) meshes.push(o);
      });
      cfg.hide.forEach((i) => meshes[i] && (meshes[i].visible = false));
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
    p.catch(() => loads.delete(key));
    loads.set(key, p);
  }
  return loads.get(key);
}

// Instance a loaded model with chakra-skin materials. `makeSkin(map)` builds
// a skin material given the original base-color texture (or null). Returns
// a group in *shoulder units*: origin at the model's shoulder midpoint,
// 1 unit = its shoulder width — the same space the sculpted avatar uses.
export function instanceSusanoo(key, scene, makeSkin) {
  const cfg = SUSANOO_MODELS[key];
  const model = scene.clone(true);
  const skins = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const map = src?.map ?? null;
    if (!skins.has(map)) skins.set(map, makeSkin(map));
    o.material = skins.get(map);
  });
  const s = 1 / cfg.width;
  model.scale.setScalar(s);
  model.position.set(-cfg.shoulders[0] * s, -cfg.shoulders[1] * s, -cfg.shoulders[2] * s);
  const group = new THREE.Group();
  group.add(model);
  return { group, materials: [...skins.values()] };
}
