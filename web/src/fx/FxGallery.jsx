import { useEffect, useState } from "react";
import JutsuFx from "./JutsuFx";
import { SKILL_FX } from "./catalog";
import { SKILLS } from "../data/skills";

// Dev page (open the app with ?fxlab): browse every skill's cast effect,
// with the real camera or synthetic tracking (?fxlab&mock).
export default function FxGallery() {
  const params = new URLSearchParams(window.location.search);
  const mock = params.has("mock");
  const skills = Object.keys(SKILL_FX).sort();
  const [skill, setSkill] = useState(params.get("skill") || "Rasengan");
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
    .filter(([, list]) => list.includes(skill))
    .map(([id]) => id)
    .join(", ");

  return (
    <div className="fx-gallery">
      {(mock || stream) && <JutsuFx skill={skill} stream={stream} mock={mock} restartKey={restart} />}
      <div className="fx-gallery-panel">
        <p className="kicker">Jutsu FX gallery {mock ? "(mock tracking)" : ""}</p>
        <select value={skill} onChange={(e) => setSkill(e.target.value)}>
          {skills.map((s) => (
            <option key={s} value={s}>
              {s}
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
