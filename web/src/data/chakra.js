// Each character's chakra colour (linear RGB, 0..1), for their duel aura,
// hand charge and hits. Picked from their signature techniques: Sasuke's
// purple Susanoo, Itachi's red, Madara's blue, Hashirama's wood green, …
export const CHAKRA = {
  "choji-akimichi": [1, 0.45, 0.2],
  deidara: [1, 0.75, 0.3],
  "fourth-raikage": [0.7, 0.85, 1],
  "hashirama-senju": [0.45, 1, 0.5],
  "hinata-hyuga": [0.75, 0.7, 1],
  "indra-otsutsuki": [1, 0.25, 0.35],
  "ino-yamanaka": [0.95, 0.6, 1],
  "itachi-uchiha": [1, 0.2, 0.2],
  jiraiya: [1, 0.6, 0.25],
  "kabuto-yakushi": [0.55, 0.95, 0.8],
  "kakashi-hatake": [0.6, 0.85, 1],
  "kiba-inuzuka": [1, 0.45, 0.35],
  "kisame-hoshigaki": [0.3, 0.6, 1],
  konan: [0.8, 0.9, 1],
  "madara-uchiha": [0.35, 0.55, 1],
  "minato-namikaze": [1, 0.9, 0.35],
  "neji-hyuga": [0.85, 0.85, 1],
  "obito-uchiha": [0.7, 0.4, 1],
  orochimaru: [0.6, 0.3, 0.9],
  "rock-lee": [0.4, 1, 0.4],
  "sakura-haruno": [1, 0.5, 0.75],
  sasori: [0.85, 0.35, 0.3],
  "sasuke-uchiha": [0.62, 0.38, 1],
  "shikamaru-nara": [0.5, 0.45, 0.75],
  "shisui-uchiha": [0.4, 1, 0.6],
  "third-raikage": [1, 0.95, 0.6],
  "tobirama-senju": [0.4, 0.85, 1],
  yahiko: [1, 0.55, 0.3],
  yamato: [0.55, 0.85, 0.4],
};

export const DEFAULT_CHAKRA = [0.4, 0.7, 1];

export const chakraOf = (id) => CHAKRA[id] ?? DEFAULT_CHAKRA;

// Kanji of each seal, for the stamp that flashes when one lands.
export const SEAL_KANJI = {
  Rat: "子",
  Ox: "丑",
  Tiger: "寅",
  Hare: "卯",
  Dragon: "辰",
  Snake: "巳",
  Horse: "午",
  Ram: "未",
  Monkey: "申",
  Bird: "酉",
  Dog: "戌",
  Boar: "亥",
};
