// Skill name -> client-side 3D cast effect. First keyword match wins. Skills
// with no match keep the legacy backend-drawn cast (see App.jsx).
import Rasengan from "./effects/rasengan";
import Chidori from "./effects/chidori";
import { dojutsu } from "./effects/dojutsu";
import LightningArmor, { Lariat } from "./effects/lightning-armor";
import FlyingThunderGod from "./effects/thunder-god";
import BodyFlicker from "./effects/body-flicker";
import GreatDragonFire from "./effects/dragon-fire";
import Susanoo from "./effects/susanoo";
import { SharkBomb, WaterDragon, WaterPrison, Samehada } from "./effects/water";
import { C4Karura, ClayClone, ExplodingClay, ExplosiveTagBarrage } from "./effects/explosions";
import { ShadowPossession, ShadowSewing, ShadowStrangle } from "./effects/shadow";
import { DeepForestEmergence, FourPillarHousePrison, WoodClone, WoodRelease } from "./effects/wood";
import { BeastHumanClone, PaperClone, ShadowClone, Substitution } from "./effects/clones";
import { EdoTensei, SnakeSummoning, SummonHounds, SummonToad } from "./effects/summons";
import { loadLandmarker } from "./tracking";
import { bakeWhenIdle } from "./sculpt";

const RULES = [
  ["rasengan", Rasengan],
  ["chidori", Chidori],
  ["lightning release armor", LightningArmor],
  ["lariat", Lariat],
  ["flying thunder god", FlyingThunderGod],
  ["body flicker", BodyFlicker],
  ["great dragon fire", GreatDragonFire],
  ["susanoo", Susanoo],
  ["amaterasu", dojutsu("amaterasu")],
  ["water prison", WaterPrison],
  ["shark bomb", SharkBomb],
  ["water dragon", WaterDragon],
  ["samehada", Samehada],
  ["exploding clay", ExplodingClay],
  ["c4 karura", C4Karura],
  ["clay clone", ClayClone],
  ["explosive tag", ExplosiveTagBarrage],
  ["shadow possession", ShadowPossession],
  ["shadow strangle", ShadowStrangle],
  ["shadow sewing", ShadowSewing],
  // "Wood Release: Deep Forest Emergence" must match before plain "wood release".
  ["deep forest", DeepForestEmergence],
  ["wood clone", WoodClone],
  ["four-pillar", FourPillarHousePrison],
  ["wood release", WoodRelease],
  ["shadow clone", ShadowClone],
  ["substitution", Substitution],
  ["paper clone", PaperClone],
  ["beast human clone", BeastHumanClone],
  ["toads", SummonToad],
  ["ninja hounds", SummonHounds],
  ["snake summoning", SnakeSummoning],
  ["edo tensei", EdoTensei],
  // Order matters: "Mangekyō Sharingan" must hit mangekyō before sharingan.
  ["mangeky", dojutsu("mangekyo")],
  ["kamui", dojutsu("kamui")],
  ["tsukuyomi", dojutsu("tsukuyomi")],
  ["kotoamatsukami", dojutsu("kotoamatsukami")],
  ["rinnegan", dojutsu("rinnegan")],
  ["byakugan", dojutsu("byakugan")],
  ["sharingan", dojutsu("sharingan")],
];

export function vfxFor(skillName) {
  if (!skillName) return null;
  const key = skillName.toLowerCase();
  return RULES.find(([keyword]) => key.includes(keyword))?.[1] ?? null;
}

// Start downloading the trackers an effect needs (and bake any sculpted
// models) while the player is still doing hand signs, so the cast starts
// instantly.
export function preloadVfx(skillName, character) {
  const Effect = vfxFor(skillName);
  Effect?.needs.forEach((kind) => loadLandmarker(kind).catch(() => {}));
  if (Effect?.prebake) bakeWhenIdle(() => Effect.prebake(character));
}
