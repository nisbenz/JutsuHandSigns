// Which effect every skill in data/skills.js plays when it's cast.
//
// A skill is a list of layers drawn in order (painter's order). Each layer:
//   fx      - shader family (see FX_SOURCES in renderer.js)
//   anchor  - where it sits:
//             "hands"   one copy on EVERY tracked hand (up to two)
//             "hand"    only the most prominent hand
//             "between" midpoint of both hands (or the one hand)
//             "torso" / "back" / "ground" - body-anchored (pose tracker)
//             "face"    between the eyes; "eyes" for iris replacements
//             "screen"  the whole frame
//   scale   - multiplier on the anchor's size
//   variant - which sub-style of the family
//   colA / colB - palette (linear 0..1 RGB)
//   tint / tintMix - recolor for the FX-lab shaders, which have baked colors
//   offset  - [x, y] nudge in anchor units (+y is up)
//   gain    - brightness multiplier (glow effects that would wash out the face)
// bloom (per skill) overrides the glow strength; eye-only jutsu use 0 so the
// iris doesn't smear.

const BLUE = [0.3, 0.75, 1.0];
const WHITE = [1.0, 1.0, 1.0];
const INK = [0.01, 0.01, 0.02];

const sage = [
  { fx: "aura", anchor: "torso", scale: 0.75, variant: 0, colA: [1.0, 0.45, 0.08], colB: [1.0, 0.85, 0.35] },
  { fx: "facemark", anchor: "face", variant: 0, colA: [0.8, 0.22, 0.08], colB: [1.0, 0.82, 0.15] },
];
const lightningArmor = [
  { fx: "aura", anchor: "torso", scale: 0.8, variant: 1, colA: [0.25, 0.55, 1.0], colB: [0.75, 0.92, 1.0] },
  { fx: "chidori", anchor: "hands", scale: 0.55 },
];
const bodyFlicker = [{ fx: "smoke", anchor: "torso", scale: 1.0, variant: 2, colA: [0.35, 0.7, 0.2], colB: [0.85, 0.95, 1.0] }];
const flyingThunderGod = [{ fx: "smoke", anchor: "torso", scale: 0.9, variant: 3, colA: [1.0, 0.85, 0.3], colB: [1.0, 0.92, 0.45] }];
const summoningToads = [
  { fx: "smoke", anchor: "ground", scale: 0.5, variant: 1, colA: [1.0, 0.55, 0.2], colB: WHITE },
  { fx: "summon", anchor: "ground", scale: 0.3, variant: 0, colA: [0.85, 0.35, 0.12], colB: [0.98, 0.8, 0.55] },
];
const woodRelease = [{ fx: "wood", anchor: "hands", scale: 0.9, variant: 0, colA: [0.55, 0.36, 0.18], colB: [0.3, 0.7, 0.2] }];
// Smoke poofs where the two video clones appear (copy shader offsets them
// 0.8 torso units to each side; offsets here are in the smoke's own units).
const clonePoofs = [-1, 1].map((side) => ({ fx: "smoke", anchor: "torso", scale: 0.45, variant: 0, offset: [(side * 0.8) / 0.45, 0] }));
const woodClone = [
  { fx: "copy", anchor: "torso", variant: 1, colA: [0.6, 0.4, 0.2], colB: [0.4, 0.8, 0.3] },
  ...clonePoofs,
];
const byakugan = [
  { fx: "facemark", anchor: "face", variant: 3, colA: [0.42, 0.36, 0.58] },
  { fx: "eyes", anchor: "eyes", variant: 4 },
];
const gentleFist = [{ fx: "aura", anchor: "hands", scale: 0.5, variant: 0, colA: [0.2, 0.5, 1.0], colB: [0.65, 0.88, 1.0] }];
const susanoo = [{ fx: "susanoo", anchor: "torso", scale: 0.09, gain: 0.55 }];
const sharingan = [{ fx: "eyes", anchor: "eyes", variant: 0 }];
const mangekyo = [{ fx: "eyes", anchor: "eyes", variant: 2 }];
const rasengan = [{ fx: "orb", anchor: "hands", scale: 1.25, warp: 1 }];
const chidori = [{ fx: "chidori", anchor: "hand", scale: 1.0, warp: 1 }];
const edoTensei = [{ fx: "genjutsu", anchor: "face", scale: 1.0, variant: 2, colA: [0.22, 0.12, 0.3] }];
const kamui = [
  { fx: "vortex", anchor: "hand", scale: 1.1, colA: [0.55, 0.45, 0.8], colB: [0.45, 0.3, 0.9] },
  { fx: "eyes", anchor: "eyes", variant: 5 },
];
const shadow = (variant) => [{ fx: "shadow", anchor: "torso", scale: 0.6, variant, colA: INK, colB: [0.25, 0.1, 0.4] }];
const susanooTinted = (tint) => [{ ...susanoo[0], tint, tintMix: 0.75 }];

export const SKILL_FX = {
  // Choji Akimichi
  "Partial Expansion Jutsu": { layers: [{ fx: "expansion", anchor: "hands" }] },
  "Human Boulder": { layers: [{ fx: "boulder", anchor: "torso", scale: 0.45 }] },
  "Butterfly Mode": { layers: [{ fx: "wing", anchor: "back", scale: 0.55, gain: 0.5 }] },

  // Deidara
  "Exploding Clay": { layers: [{ fx: "clay", anchor: "hands" }] },
  "C4 Karura": { layers: [{ fx: "c4", anchor: "hand" }] },
  "Clay Clone": { layers: [{ fx: "clone", anchor: "hand" }] },

  // Raikage (4th + 3rd)
  "Lightning Release Armor": { layers: lightningArmor },
  "Lariat": {
    layers: [
      { fx: "chidori", anchor: "hand", scale: 1.1, tint: [1.0, 0.95, 0.5], tintMix: 0.5, warp: 1 },
      { fx: "shock", anchor: "hand", scale: 0.9, variant: 0, colA: [0.6, 0.85, 1.0], colB: [0.85, 0.95, 1.0] },
    ],
  },
  "Body Flicker": { layers: bodyFlicker },
  "Lava-Melting Chop": {
    layers: [{ fx: "flame", anchor: "hands", scale: 0.8, variant: 0, colA: [1.0, 0.28, 0.02], colB: [1.0, 0.85, 0.3], warp: 1 }],
  },
  "Earth-Shattering Punch": {
    layers: [{ fx: "shock", anchor: "hand", scale: 1.0, variant: 0, colA: [1.0, 0.8, 0.5], colB: [1.0, 0.5, 0.15] }],
  },

  // Hashirama Senju
  "Wood Release: Deep Forest Emergence": {
    layers: [{ fx: "wood", anchor: "ground", scale: 0.55, variant: 1, colA: [0.55, 0.36, 0.18], colB: [0.3, 0.7, 0.2] }],
  },
  "Sage Mode": { layers: sage },
  "Wood Clone": { layers: woodClone },

  // Hinata / Neji Hyuga
  "Byakugan": { layers: byakugan, bloom: 0 },
  "Gentle Fist": { layers: gentleFist },
  "Eight Trigrams Palm Rotation": {
    layers: [{ fx: "shock", anchor: "torso", scale: 0.5, gain: 0.7, variant: 1, colA: [0.4, 0.75, 1.0], colB: [0.85, 0.95, 1.0] }],
  },
  "Eight Trigrams Sixty-Four Palms": {
    layers: [
      { fx: "shock", anchor: "ground", scale: 0.55, variant: 3, colA: [0.4, 0.75, 1.0], colB: WHITE, offset: [0, 0.6] },
      { ...gentleFist[0], scale: 0.35 },
      byakugan[0],
    ],
  },

  // Indra / Itachi / Sasuke / Madara / Obito / Shisui
  "Sharingan": { layers: sharingan, bloom: 0 },
  "Susanoo": { layers: susanoo },
  "Fire Release: Great Dragon Fire": {
    layers: [{ fx: "flame", anchor: "hand", scale: 1.0, variant: 1, colA: [1.0, 0.32, 0.04], colB: [1.0, 0.9, 0.5], warp: 1 }],
  },
  "Amaterasu": {
    layers: [
      { fx: "flame", anchor: "hands", scale: 0.9, variant: 0, colA: [0.02, 0.0, 0.03], colB: [0.55, 0.08, 0.45] },
      { fx: "eyes", anchor: "eyes", variant: 1 },
    ],
  },
  "Tsukuyomi": {
    layers: [
      { fx: "genjutsu", anchor: "screen", variant: 0, colA: [0.75, 0.02, 0.02], colB: [0.95, 0.12, 0.1] },
      { fx: "eyes", anchor: "eyes", variant: 1 },
    ],
    bloom: 0.4,
  },
  "Rinnegan": { layers: [{ fx: "eyes", anchor: "eyes", variant: 3 }], bloom: 0 },
  "Mangekyō Sharingan": { layers: mangekyo, bloom: 0 },
  "Kamui": { layers: kamui },
  "Kotoamatsukami": {
    layers: [
      { fx: "genjutsu", anchor: "screen", variant: 3, colA: [0.6, 1.0, 0.8], colB: WHITE },
      { fx: "eyes", anchor: "eyes", variant: 2 },
    ],
    bloom: 0.5,
  },
  "Wood Release": { layers: woodRelease },

  // Ino Yamanaka
  "Mind Body Switch Technique": {
    layers: [{ fx: "mind", anchor: "between", scale: 0.9, variant: 0, colA: [0.85, 0.55, 1.0], colB: [1.0, 0.8, 1.0] }],
  },
  "Mind Destruction": {
    layers: [{ fx: "mind", anchor: "face", variant: 1, colA: [0.6, 0.3, 1.0], colB: [1.0, 0.3, 0.7] }],
    bloom: 0.5,
  },
  "Mind Transmission Technique": {
    layers: [{ fx: "mind", anchor: "face", scale: 0.8, variant: 2, colA: [0.3, 0.7, 1.0], colB: [0.85, 0.97, 1.0] }],
  },

  // Jiraiya / Minato / Naruto defaults
  "Rasengan": { layers: rasengan },
  "Summoning: Toads": { layers: summoningToads },
  "Flying Thunder God": { layers: flyingThunderGod },

  // Kabuto / Orochimaru
  "Chakra Scalpel": { layers: [{ fx: "aura", anchor: "hands", scale: 1.0, variant: 3, colA: [0.3, 0.9, 1.0] }] },
  "Edo Tensei": { layers: edoTensei, bloom: 0.5 },
  "Snake Sage Mode": {
    layers: [
      { fx: "aura", anchor: "torso", scale: 0.6, variant: 0, colA: [0.5, 0.2, 0.75], colB: [0.85, 0.75, 1.0] },
      { fx: "facemark", anchor: "face", variant: 2, colA: [0.45, 0.12, 0.55], colB: [1.0, 0.85, 0.15] },
    ],
  },
  "Snake Summoning": {
    layers: [
      { fx: "smoke", anchor: "ground", scale: 0.5, variant: 1, colA: [0.7, 0.4, 1.0], colB: WHITE },
      { fx: "snakes", anchor: "ground", scale: 0.3, variant: 2, colA: [0.45, 0.35, 0.55], colB: [0.85, 0.8, 0.7], dir: [0, 1] },
    ],
  },
  "Living Corpse Reincarnation": {
    layers: [
      { fx: "snakes", anchor: "hands", scale: 0.6, variant: 1, colA: [0.86, 0.86, 0.8], colB: [0.98, 0.94, 0.82] },
      { fx: "facemark", anchor: "face", variant: 2, colA: [0.45, 0.12, 0.55], colB: [1.0, 0.85, 0.15] },
    ],
  },

  // Kakashi
  "Chidori": { layers: chidori },
  "Summoning: Ninja Hounds": {
    layers: [
      { fx: "smoke", anchor: "ground", scale: 0.5, variant: 1, colA: [0.35, 0.75, 1.0], colB: WHITE },
      { fx: "summon", anchor: "ground", scale: 0.42, variant: 1, colA: [0.6, 0.5, 0.38], colB: [0.15, 0.25, 0.55] },
    ],
  },

  // Kiba Inuzuka
  "Fang Over Fang": {
    layers: [{ fx: "tornado", anchor: "torso", scale: 0.6, variant: 0, colA: [0.45, 0.4, 0.35], colB: [0.95, 0.92, 0.85] }],
  },
  "Beast Human Clone": {
    layers: [{ fx: "copy", anchor: "torso", variant: 2, colA: [0.8, 0.66, 0.52], colB: [1.0, 0.55, 0.25] }, ...clonePoofs],
  },
  "Twin Wolf Fang": {
    layers: [{ fx: "tornado", anchor: "torso", scale: 0.6, variant: 2, colA: [0.45, 0.4, 0.35], colB: [0.92, 0.88, 0.82] }],
  },

  // Kisame / Tobirama
  "Water Release: Shark Bomb": {
    layers: [{ fx: "water", anchor: "hand", scale: 1.1, variant: 2, colA: [0.1, 0.4, 0.85], colB: [0.85, 0.95, 1.0] }],
  },
  "Samehada": {
    layers: [{ fx: "sword", anchor: "hand", scale: 0.8, colA: [0.38, 0.5, 0.66], colB: [0.3, 0.7, 1.0] }],
  },
  "Water Prison": {
    layers: [{ fx: "water", anchor: "torso", scale: 0.8, variant: 1, colA: [0.1, 0.45, 0.85], colB: [0.85, 0.95, 1.0] }],
  },
  "Water Release: Water Dragon": {
    layers: [{ fx: "water", anchor: "hand", scale: 0.85, variant: 0, colA: [0.1, 0.4, 0.9], colB: [0.85, 0.95, 1.0] }],
  },

  // Konan / Yahiko
  "Paper Release": { layers: [{ fx: "paper", anchor: "hands", scale: 0.8, variant: 0, colA: [0.96, 0.95, 0.9] }] },
  "Paper Clone": {
    layers: [
      { fx: "copy", anchor: "torso", variant: 3, colA: [0.96, 0.95, 0.9], colB: [0.85, 0.85, 1.0] },
      { fx: "paper", anchor: "hand", scale: 0.8, variant: 0, colA: [0.96, 0.95, 0.9] },
    ],
  },
  "Dance of the Shikigami": {
    layers: [
      { fx: "paper", anchor: "back", scale: 0.6, variant: 1, colA: [0.96, 0.95, 0.9] },
      { fx: "paper", anchor: "hands", scale: 0.6, variant: 1, colA: [0.98, 0.93, 0.95] },
    ],
  },
  "Six Paths of Pain": {
    layers: [
      { fx: "shock", anchor: "torso", scale: 0.5, variant: 2, colA: [0.7, 0.65, 0.95], colB: WHITE },
      { fx: "eyes", anchor: "eyes", variant: 3 },
    ],
  },
  "Explosive Tag Barrage": {
    layers: [{ fx: "paper", anchor: "between", scale: 1.0, variant: 2, colA: [0.95, 0.9, 0.75], colB: [0.6, 0.05, 0.05] }],
  },

  // Rock Lee
  "Primary Lotus": {
    layers: [{ fx: "tornado", anchor: "torso", scale: 0.6, variant: 3, colA: [0.85, 0.15, 0.1], colB: [0.95, 0.93, 0.88] }],
  },
  "Eight Gates": {
    // Green chakra cloak plus the gates' signature steam pouring off the body.
    layers: [
      { fx: "aura", anchor: "torso", scale: 0.9, variant: 0, colA: [0.15, 0.95, 0.4], colB: [0.85, 1.0, 0.7], gain: 0.8 },
      { fx: "steam", anchor: "hands", scale: 1.6, gain: 1.8 },
      { fx: "steam", anchor: "torso", scale: 0.9, offset: [0, 0.4], gain: 1.6 },
    ],
  },
  "Leaf Hurricane": {
    layers: [{ fx: "tornado", anchor: "torso", scale: 1.0, variant: 1, colA: [0.75, 0.95, 0.85], colB: [0.3, 0.65, 0.15] }],
  },

  // Sakura Haruno
  "Strength of a Hundred Seal": {
    layers: [
      { fx: "facemark", anchor: "face", variant: 1, colA: [0.6, 0.2, 0.75] },
      { fx: "aura", anchor: "torso", scale: 0.7, variant: 0, colA: [0.55, 0.2, 0.9], colB: [0.85, 0.6, 1.0], gain: 0.7 },
      { fx: "aura", anchor: "hands", scale: 0.45, variant: 0, colA: [0.6, 0.25, 1.0], colB: [0.95, 0.75, 1.0] },
    ],
  },
  "Byakugō Healing": {
    layers: [
      { fx: "facemark", anchor: "face", variant: 1, colA: [0.6, 0.2, 0.75] },
      { fx: "aura", anchor: "hands", scale: 0.8, variant: 2, colA: [0.3, 1.0, 0.5] },
    ],
  },
  "Cherry Blossom Impact": {
    layers: [{ fx: "shock", anchor: "hand", scale: 1.0, variant: 4, colA: [1.0, 0.6, 0.8], colB: [1.0, 0.65, 0.8] }],
  },

  // Sasori
  "Puppet Technique": { layers: [{ fx: "threads", anchor: "screen", variant: 0, colA: [0.4, 0.8, 1.0] }] },
  "Hundred Puppet Performance": { layers: [{ fx: "threads", anchor: "screen", variant: 1, colA: [0.4, 0.8, 1.0] }] },
  "Iron Sand": {
    layers: [{ fx: "threads", anchor: "between", scale: 1.0, variant: 2, colA: [0.12, 0.1, 0.14], colB: [0.6, 0.5, 0.8] }],
  },

  // Shikamaru Nara
  "Shadow Possession Jutsu": { layers: shadow(0) },
  "Shadow Strangle": { layers: shadow(1) },
  "Shadow Sewing": { layers: shadow(2) },

  // Yamato
  "Four-Pillar House Prison": {
    layers: [{ fx: "wood", anchor: "ground", scale: 0.6, variant: 2, colA: [0.55, 0.36, 0.18], colB: [0.3, 0.7, 0.2] }],
  },

  // Fallback roster (characters without a skills entry)
  "Shadow Clone Jutsu": {
    layers: [{ fx: "copy", anchor: "torso", variant: 0, colB: [0.85, 0.92, 1.0] }, ...clonePoofs],
  },
  "Substitution Jutsu": {
    layers: [
      { fx: "smoke", anchor: "torso", scale: 0.55, variant: 0 },
      { fx: "wood", anchor: "torso", scale: 0.35, variant: 0, colA: [0.55, 0.36, 0.18], colB: [0.3, 0.7, 0.2], dir: [1, 0.2] },
    ],
  },
};

const DEFAULT_FX = { layers: [{ fx: "orb", anchor: "hands", tint: BLUE, tintMix: 0 }] };

// Same technique, different user: per-character variants (keyed by the
// character id from the matching backend).
export const CHARACTER_FX = {
  "itachi-uchiha": { "Susanoo": { layers: susanooTinted([1.0, 0.3, 0.25]) } },
  "madara-uchiha": { "Susanoo": { layers: susanooTinted([0.35, 0.55, 1.0]) } },
  "indra-otsutsuki": { "Susanoo": { layers: susanooTinted([0.7, 0.5, 1.0]) } },
  "fourth-raikage": {
    "Body Flicker": {
      layers: [
        { fx: "aura", anchor: "torso", scale: 0.7, variant: 1, colA: [0.25, 0.55, 1.0], colB: [0.75, 0.92, 1.0], gain: 0.8 },
        { fx: "smoke", anchor: "torso", scale: 1.0, variant: 2, colA: [0.55, 0.8, 1.0], colB: [0.7, 0.88, 1.0] },
      ],
    },
  },
  "third-raikage": {
    "Lightning Release Armor": {
      layers: [
        { fx: "aura", anchor: "torso", scale: 0.8, variant: 1, colA: [1.0, 0.7, 0.15], colB: [1.0, 0.95, 0.6] },
        { fx: "chidori", anchor: "hands", scale: 0.55, tint: [1.0, 0.85, 0.35], tintMix: 0.7 },
      ],
    },
  },
  "obito-uchiha": { "Mangekyō Sharingan": { layers: [{ fx: "eyes", anchor: "eyes", variant: 5 }], bloom: 0 } },
};

export function fxForSkill(skill, character) {
  return CHARACTER_FX[character]?.[skill] || SKILL_FX[skill] || DEFAULT_FX;
}

// Which trackers a spec needs, so we only load the models we'll use.
export function trackersFor(spec) {
  const need = { hands: false, pose: false, face: false };
  for (const layer of spec.layers) {
    if (["hands", "hand", "between"].includes(layer.anchor) || layer.fx === "threads") need.hands = true;
    if (["torso", "back", "ground"].includes(layer.anchor)) need.pose = true;
    if (["face", "eyes"].includes(layer.anchor)) need.face = true;
  }
  // Body anchors fall back to the face when pose is lost.
  if (need.pose) need.face = true;
  return need;
}
