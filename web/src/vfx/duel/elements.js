// Technique -> element, shared by the 2D duel effects (components/duelFx.js)
// and the 3D strikes. First keyword match wins. `core` / `glow` are CSS
// colours; the 3D layer boosts them into HDR itself.
export const ELEMENTS = [
  { kind: "lightning", words: ["chidori", "lightning", "raikage", "lariat", "thunder", "kirin"], core: "#ffffff", glow: "#7fd4ff" },
  { kind: "fire", words: ["fire", "amaterasu", "katon", "lava"], core: "#fff1c9", glow: "#ff6a1f" },
  { kind: "water", words: ["water", "shark", "samehada", "prison"], core: "#e6fbff", glow: "#2f8fff" },
  { kind: "wood", words: ["wood", "forest", "pillar", "toad", "sage"], core: "#f1ffd9", glow: "#5fd04a" },
  { kind: "shadow", words: ["shadow", "possession", "strangle", "sewing", "kamui", "tsukuyomi", "edo", "snake"], core: "#f0e6ff", glow: "#9a5bff" },
  { kind: "eye", words: ["sharingan", "mangeky", "susanoo", "rinnegan", "kotoamatsukami"], core: "#ffe1e1", glow: "#ff2a3c" },
  { kind: "chakra", words: ["byakugan", "gentle fist", "trigrams", "palm", "rasengan"], core: "#ffffff", glow: "#4fd8ff" },
  { kind: "blast", words: ["clay", "explod", "c4", "tag", "boulder", "punch", "impact", "hundred"], core: "#fff7d6", glow: "#ffb52e" },
  { kind: "petal", words: ["paper", "cherry", "healing"], core: "#fff0fa", glow: "#ff79c6" },
];

export const DEFAULT_ELEMENT = { kind: "chakra", core: "#ffffff", glow: "#6fb8ff" };

export function elementOf(skill = "") {
  const key = skill.toLowerCase();
  return ELEMENTS.find((e) => e.words.some((w) => key.includes(w))) ?? DEFAULT_ELEMENT;
}
