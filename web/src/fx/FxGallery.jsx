import { useEffect, useState } from "react";
import JutsuFx from "./JutsuFx";
import { SKILL_FX, CHARACTER_FX } from "./catalog";
import { SKILLS } from "../data/skills";

// Dev page (open the app with ?fxlab): browse every skill's cast effect,
// with the real camera or synthetic tracking (?fxlab&mock). Character-
// specific variants are listed as "Skill (character)".
const ENTRIES = [
  ...Object.keys(SKILL_FX).map((skill) => ({ skill, character: "", label: skill })),
  ...Object.entries(CHARACTER_FX).flatMap(([character, skills]) =>
    Object.keys(skills).map((skill) => ({ skill, character, label: `${skill} (${character})` }))
  ),
].sort((a, b) => a.label.localeCompare(b.label));

export default function FxGallery() {
  const params = new URLSearchParams(window.location.search);
  // ?fxlab&mock[=zoom][&head=y]: zoom > 1 frames the mock person closer.
  const mock = params.has("mock") ? Number(params.get("mock")) || true : false;
  const mockHeadY = params.has("head") ? Number(params.get("head")) : undefined;
  const initial = ENTRIES.find((e) => e.skill === params.get("skill") && e.character === (params.get("character") || ""));
  const [entry, setEntry] = useState(initial || ENTRIES.find((e) => e.skill === "Rasengan"));
  const [restart, setRestart] = useState(0);
  const [stream, setStream] = useState(null);

  useEffect(() => {
    if (mock) return undefined;
    let s;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 } })
      .then((st) => {
        s = st;
        setStream(st);
      })
      .catch((err) => console.error(err));
    return () => s?.getTracks().forEach((t) => t.stop());
  }, [mock]);

  const owners = Object.entries(SKILLS)
    .filter(([, list]) => list.includes(entry.skill))
    .map(([id]) => id)
    .join(", ");

  return (
    <div className="fx-gallery">
      {(mock || stream) && (
        <JutsuFx skill={entry.skill} character={entry.character} stream={stream} mock={mock} mockHeadY={mockHeadY} restartKey={restart} />
      )}
      <div className="fx-gallery-panel">
        <p className="kicker">Jutsu FX gallery {mock ? "(mock tracking)" : ""}</p>
        <select value={entry.label} onChange={(e) => setEntry(ENTRIES.find((x) => x.label === e.target.value))}>
          {ENTRIES.map((e) => (
            <option key={e.label} value={e.label}>
              {e.label}
            </option>
          ))}
        </select>
        <button className="begin-btn" onClick={() => setRestart((n) => n + 1)}>
          Recast
        </button>
        <p className="hint">{owners}</p>
      </div>
    </div>
  );
}
