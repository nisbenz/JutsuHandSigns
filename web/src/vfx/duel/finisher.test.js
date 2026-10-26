import { describe, expect, it } from "vitest";
import { DEFAULT_SKILLS, SKILLS } from "../../data/skills";
import { finisherFor } from "./finisher";
import GenericFinisher from "./generic";

const ALL_SKILLS = [...new Set([...Object.values(SKILLS).flat(), ...DEFAULT_SKILLS])];
const KINDS = new Set(["hand", "face", "pose", "segment"]);

describe("finisherFor", () => {
  it.each(ALL_SKILLS)("%s resolves to a playable finisher", (skill) => {
    const Effect = finisherFor(skill);
    expect(typeof Effect).toBe("function");
    expect(Effect.duration).toBeGreaterThan(0);
    expect(Array.isArray(Effect.needs)).toBe(true);
    Effect.needs.forEach((k) => expect(KINDS.has(k)).toBe(true));
  });

  it("uses the dedicated cast when one exists and the generic one otherwise", () => {
    expect(finisherFor("Chidori")).not.toBe(GenericFinisher);
    expect(finisherFor("Primary Lotus")).toBe(GenericFinisher);
  });
});
