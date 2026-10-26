import { useEffect, useMemo, useRef, useState } from "react";
import PvpDuel from "../components/PvpDuel";
import { CHARACTERS } from "../data/characters";
import { DEFAULT_SKILLS, SKILLS } from "../data/skills";
import { createFakeCamStream } from "../fakecam";
import "../App.css";

// Dev-only duel FX lab (`?fxlab=duel`): the real duel screen with no backend.
// The panel fires any duel event on demand, through the same code path as
// server frames, so every effect can be seen, tuned and screenshotted.
// `&realcam` uses the webcam instead of the fake camera; `&fakecam=chars`
// draws two character pictures for the trackers to find.

const SIGNS = ["Rat", "Ox", "Tiger", "Hare", "Dragon", "Snake", "Horse", "Ram", "Monkey", "Bird", "Dog", "Boar"];
const ALL_SKILLS = [...new Set([...Object.values(SKILLS).flat(), ...DEFAULT_SKILLS])].sort();
const SIGN_DAMAGE = 6;
const JUTSU_DAMAGE = 20;
const TICK_MS = 80;
// Where the lab pretends each player's hands were detected (normalised, mirrored).
const BOXES = [
  [0.14, 0.42, 0.34, 0.78],
  [0.66, 0.42, 0.86, 0.78],
];

// Scripting hooks for screenshots while the tab is hidden (animation frames
// paused): click panel buttons, set sliders, and step the 3D layer by hand.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
window.__lab = {
  btn: (text, n = 0) => [...document.querySelectorAll(".duel-lab button")].filter((b) => b.textContent.trim() === text)[n]?.click(),
  slider: (k, v) => {
    const el = [...document.querySelectorAll(".duel-lab input[type=range]")][k];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  async step(frames, realMs = 0) {
    const s = window.__duelScene;
    s.paused = true;
    for (let i = 0; i < frames; i++) {
      s.stage.videoTex.needsUpdate = true;
      s.frame(1 / 60);
      if (realMs) await wait(realMs);
    }
  },
  async ready() {
    for (let n = 0; n < 150 && !window.__duelScene?.tracker.loaded; n++) await wait(100);
  },
  // Render one 3D frame and pin a copy of it as a static image over the
  // canvas, so a screenshot taken later still shows exactly that moment.
  snap() {
    const s = window.__duelScene;
    s.stage.videoTex.needsUpdate = true;
    s.frame(0.001);
    const canvas = s.stage.renderer.domElement;
    let img = document.getElementById("lab-snap");
    if (!img) {
      img = document.createElement("img");
      img.id = "lab-snap";
      img.className = "duel-stage";
      canvas.after(img);
    }
    img.src = canvas.toDataURL();
  },
  // Pick a jutsu in the panel, fire it from player `who`, advance `frames`
  // and snap: a mid-flight strike, frozen for a screenshot.
  async fly(who, skill, frames) {
    const sel = document.querySelectorAll(".duel-lab select")[2];
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, skill);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(80);
    this.unsnap();
    this.btn("Jutsu hit", who);
    await wait(100);
    await this.step(frames);
    this.snap();
    this.hideUi(true);
    return window.__duelScene.strikes.strikes.map((x) => `${x.kind}@${x.t.toFixed(2)}`).join();
  },
  unsnap() {
    document.getElementById("lab-snap")?.remove();
  },
  hideUi(hide) {
    document.querySelector(".duel-lab").style.display = hide ? "none" : "";
    document.querySelectorAll(".pvp-result").forEach((r) => (r.style.opacity = hide ? 0.2 : 1));
  },
};

const skillsOf = (c) => (SKILLS[c.id] || DEFAULT_SKILLS).slice(0, 3);

// A stand-in for the server's PvpMatch: same state shape and events.
class LabSim {
  constructor(characters) {
    this.characters = characters;
    this.reset();
  }

  reset(stage = "fight") {
    this.stage = stage;
    this.winner = null;
    this.events = [];
    this.hold = [0, 0];
    this.boxes = [true, true];
    this.players = this.characters.map((c, i) => {
      const sequence = [0, 1, 2].map((k) => SIGNS[(i * 5 + k * 3) % SIGNS.length]);
      return { hp: 100, max_hp: 100, character: c.id, skill: skillsOf(c)[0], sequence, idx: 0, target_sign: sequence[0], jutsu_landed: 0 };
    });
  }

  hit(attacker, jutsuSkill) {
    const a = this.players[attacker];
    const d = this.players[1 - attacker];
    const base = { type: "hit", attacker, defender: 1 - attacker };
    this.events.push({ ...base, damage: SIGN_DAMAGE, kind: "sign" });
    let dmg = SIGN_DAMAGE;
    if (jutsuSkill) {
      this.events.push({ ...base, damage: JUTSU_DAMAGE, kind: "jutsu", skill: jutsuSkill });
      dmg += JUTSU_DAMAGE;
      a.jutsu_landed += 1;
      a.idx = 0;
    } else {
      a.idx = (a.idx + 1) % a.sequence.length;
    }
    a.target_sign = a.sequence[a.idx];
    d.hp = Math.max(0, d.hp - dmg);
    if (d.hp === 0) this.ko(attacker);
  }

  ko(winner) {
    if (winner === "draw") this.players.forEach((p) => (p.hp = 0));
    else this.players[1 - winner].hp = 0;
    this.stage = "ko";
    this.winner = winner;
    this.events.push({ type: "ko", winner });
  }

  setHp(i, hp) {
    this.players[i].hp = hp;
  }

  setHold(i, v) {
    this.hold[i] = v;
  }

  setBox(i, on) {
    this.boxes[i] = on;
  }

  // The next "server frame": state plus the events since the last one.
  frame() {
    const fighting = this.stage === "fight";
    const players = this.players.map((p, i) => {
      const hold = fighting ? this.hold[i] : 0;
      return { ...p, hold_progress: hold, detected_sign: hold > 0 ? p.target_sign : null, bbox: fighting && this.boxes[i] ? BOXES[i] : null };
    });
    const events = this.events;
    this.events = [];
    return { stage: this.stage, winner: this.winner, time_left: 90, countdown: 3, players, events };
  }
}

function useCamera() {
  const videoRef = useRef(null);
  useEffect(() => {
    let stream;
    let cancelled = false;
    (async () => {
      stream = new URLSearchParams(window.location.search).has("realcam")
        ? await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 } })
        : createFakeCamStream();
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      videoRef.current.srcObject = stream;
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return videoRef;
}

export default function DuelLab() {
  const videoRef = useCamera();
  const [ids, setIds] = useState(["sasuke-uchiha", "hinata-hyuga"]);
  const characters = useMemo(() => ids.map((id) => CHARACTERS.find((c) => c.id === id)), [ids]);
  return (
    <div className="camera-screen">
      <video ref={videoRef} autoPlay muted playsInline className="video-fullscreen" />
      <LabSession key={ids.join()} videoRef={videoRef} characters={characters} ids={ids} setIds={setIds} />
    </div>
  );
}

function LabSession({ videoRef, characters, ids, setIds }) {
  const labRef = useRef({});
  const [sim] = useState(() => new LabSim(characters));
  const [skill, setSkill] = useState("Chidori");
  const [open, setOpen] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [, rerender] = useState(0);
  const act = (fn) => () => {
    fn();
    rerender((n) => n + 1);
  };

  useEffect(() => {
    labRef.current.rematch = () => sim.reset();
    const t = setInterval(() => labRef.current.push?.(sim.frame()), TICK_MS);
    return () => clearInterval(t);
  }, [sim]);

  const toggleFreeze = () => {
    const next = !frozen;
    if (window.__duelScene) window.__duelScene.paused = next;
    document.getAnimations().forEach((a) => (next ? a.pause() : a.play()));
    setFrozen(next);
  };

  return (
    <>
      <PvpDuel videoRef={videoRef} characters={characters} labRef={labRef} onExit={() => sim.reset()} onError={console.error} />

      <div className={`duel-lab ${open ? "" : "closed"}`}>
        <button className="duel-lab-toggle" onClick={() => setOpen(!open)}>
          FX lab {open ? "▾" : "▸"}
        </button>
        {open && (
          <div className="duel-lab-body">
            <div className="duel-lab-row">
              {[0, 1].map((i) => (
                <select key={i} value={ids[i]} onChange={(e) => setIds(ids.map((v, j) => (j === i ? e.target.value : v)))}>
                  {CHARACTERS.map((c) => (
                    <option key={c.id} value={c.id}>
                      P{i + 1}: {c.name}
                    </option>
                  ))}
                </select>
              ))}
              <label>
                Jutsu{" "}
                <select value={skill} onChange={(e) => setSkill(e.target.value)}>
                  {ALL_SKILLS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
            </div>
            {[0, 1].map((i) => (
              <div className="duel-lab-row" key={i}>
                <strong>P{i + 1}</strong>
                <button onClick={act(() => sim.hit(i, null))}>Seal hit</button>
                <button onClick={act(() => sim.hit(i, skill))}>Jutsu hit</button>
                <label>
                  hold{" "}
                  <input type="range" min="0" max="1" step="0.05" value={sim.hold[i]} onChange={(e) => act(() => sim.setHold(i, +e.target.value))()} />
                </label>
                <label>
                  HP <input type="range" min="0" max="100" value={sim.players[i].hp} onChange={(e) => act(() => sim.setHp(i, +e.target.value))()} />
                </label>
                <label>
                  <input type="checkbox" checked={sim.boxes[i]} onChange={(e) => act(() => sim.setBox(i, e.target.checked))()} /> box
                </label>
              </div>
            ))}
            <div className="duel-lab-row">
              <button onClick={act(() => sim.reset("countdown"))}>Countdown</button>
              <button onClick={act(() => sim.reset())}>Fight</button>
              <button onClick={act(() => sim.ko(0))}>KO → P1 wins</button>
              <button onClick={act(() => sim.ko(1))}>KO → P2 wins</button>
              <button onClick={act(() => sim.ko("draw"))}>Draw</button>
              <button onClick={toggleFreeze}>{frozen ? "Resume" : "Freeze"}</button>
              <button disabled={!frozen} onClick={() => window.__duelScene?.frame(1 / 60)}>
                Step 3D
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
