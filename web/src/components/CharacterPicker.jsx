import { useEffect } from "react";
import { CHARACTERS } from "../data/characters";
import { SKILLS, DEFAULT_SKILLS } from "../data/skills";
import { vfxFor } from "../vfx/registry";
import { Prompt, StormPanel } from "./Storm";
import { sfx } from "../sfx";

// Manual character select — skips the face scan so every roster entry (and
// its techniques) can be reached directly. Characters with at least one
// technique that has a 3D cast effect are badged.
export default function CharacterPicker({ onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      sfx.back();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker-shell" onClick={(e) => e.stopPropagation()}>
        <StormPanel title="Choose your shinobi" className="picker-panel" sound="open">
          <div className="picker-grid">
            {CHARACTERS.map((c) => {
              const skills = (SKILLS[c.id] || DEFAULT_SKILLS).slice(0, 3);
              const fx = skills.filter((s) => vfxFor(s));
              return (
                <button
                  key={c.id}
                  className="picker-card"
                  onMouseEnter={sfx.hover}
                  onFocus={sfx.hover}
                  onClick={() => {
                    sfx.select();
                    onPick(c);
                  }}
                >
                  <img src={`${import.meta.env.BASE_URL}characters/${c.file}`} alt="" loading="lazy" />
                  <span className="picker-name">{c.name}</span>
                  {fx.length > 0 && (
                    <span className="storm-badge picker-badge" title={`3D: ${fx.join(", ")}`}>
                      3D ×{fx.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </StormPanel>
        <div className="prompt-bar static">
          <Prompt back onClick={onClose}>Back</Prompt>
        </div>
      </div>
    </div>
  );
}
