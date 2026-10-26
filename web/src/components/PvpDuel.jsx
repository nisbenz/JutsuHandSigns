import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SKILLS, DEFAULT_SKILLS } from "../data/skills";
import { sfx } from "../sfx";
import { useFrameSocket } from "../useFrameSocket";
import { DuelFx, elementFor } from "./duelFx";
import DuelStage from "./DuelStage";
import HandSignIcon from "./HandSignIcon";
import HealthBar from "./HealthBar";
import { Prompt, StormPanel, Strip } from "./Storm";

const PVP_WS_URL = import.meta.env.VITE_PVP_WS_URL || "ws://localhost:8000/ws/pvp";
const FRAME_INTERVAL_MS = 80;
const HIT_FLASH_MS = 400;
const FLOAT_MS = 1100;
const BANNER_MS = 1400;
const SHAKE_MS = 450;
const KO_PANEL_DELAY_MS = 800; // let the finishing blow land before the panel covers it
const SIDES = ["left", "right"];

const portraitOf = (c) => `${import.meta.env.BASE_URL}characters/${c.file}`;
// 3D background + effects unless `?fx=2d` (or WebGL fails at runtime).
function wants3d() {
  try {
    return new URLSearchParams(window.location.search).get("fx") !== "2d";
  } catch {
    return true;
  }
}
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function startMessage(characters) {
  return {
    type: "start",
    players: characters.map((c) => ({
      character: c.id,
      skills: (SKILLS[c.id] || DEFAULT_SKILLS).slice(0, 3),
    })),
  };
}

// Current seal for one player: jutsu name, seal picture, progress dots and
// hold gauge. `landed` re-keys the glow + stamp so each landed seal replays them.
function SealCard({ player, landed, cardRef }) {
  return (
    <div ref={cardRef} className="pvp-seal">
      <div className="pvp-seal-skill">{player.skill}</div>
      <div className="pvp-seal-body">
        <HandSignIcon sign={player.target_sign} size={64} />
        <div className="pvp-seal-info">
          <span className="pvp-seal-name">{player.target_sign}</span>
          <div className="jutsu-progress-dots">
            {player.sequence.map((_sign, i) => (
              <span key={i} className={`dot ${i < player.idx ? "done" : i === player.idx ? "active" : ""}`} />
            ))}
          </div>
          <div className="chakra-gauge">
            <div className="chakra-gauge-fill" style={{ width: `${(player.hold_progress ?? 0) * 100}%` }} />
          </div>
          <span className="pvp-seal-detected">
            {player.detected_sign ? `Detected: ${player.detected_sign}` : "Form the seal"}
          </span>
        </div>
      </div>
      {landed > 0 && (
        <>
          <span key={`g${landed}`} className="pvp-seal-glow" />
          <span key={`s${landed}`} className="pvp-stamp" aria-hidden>
            印
          </span>
        </>
      )}
    </div>
  );
}

// One player's half of the HUD: health bar on top, current seal on the
// outer edge, floating damage numbers when they get hit.
function PlayerSide({ index, character, player, hp, fighting, flash, floats, landed, cardRef }) {
  const side = SIDES[index];
  return (
    <div className={`pvp-side ${side} ${flash ? "hit" : ""}`}>
      <HealthBar
        hp={hp}
        max={player?.max_hp ?? 100}
        side={side}
        name={`P${index + 1} ${character.name}`}
        portrait={portraitOf(character)}
      />
      {fighting && player?.target_sign && <SealCard player={player} landed={landed} cardRef={cardRef} />}
      {floats.map((f) => (
        <span key={f.id} className={`pvp-float ${f.kind}`}>
          {f.text}
        </span>
      ))}
    </div>
  );
}

// `labRef` (dev FX lab only): instead of a server, the lab pushes duel states
// through `labRef.current.push(state)`, the same path server frames take.
export default function PvpDuel({ videoRef, characters, onExit, onError, labRef }) {
  const [frame, setFrame] = useState(null);
  const [state, setState] = useState(null);
  // HP as shown on the bars: lags the server until each bolt actually lands.
  const [shownHp, setShownHp] = useState([100, 100]);
  const [flash, setFlash] = useState([false, false]);
  const [landed, setLanded] = useState([0, 0]);
  const [floats, setFloats] = useState([]);
  const [banner, setBanner] = useState(null);
  const [shake, setShake] = useState(0);
  const [koShown, setKoShown] = useState(false);
  const [fx3d, setFx3d] = useState(wants3d);

  const screenRef = useRef(null);
  const canvasRef = useRef(null);
  const fxRef = useRef(null);
  const cardRefs = [useRef(null), useRef(null)];
  const duel3d = useRef(null); // the 3D scene, while it runs
  const characterIds = useMemo(() => characters.map((c) => c.id), [characters]);
  const serverHp = useRef([100, 100]);
  const inFlight = useRef([0, 0]);
  const timers = useRef(new Set());
  const nextId = useRef(0);
  const start = useMemo(() => startMessage(characters), [characters]);

  const later = useCallback((fn, ms) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const fx = new DuelFx(canvasRef.current);
    fxRef.current = fx;
    const pending = timers.current;
    return () => {
      fx.dispose();
      pending.forEach(clearTimeout);
    };
  }, []);

  // Where effects start and land, in duel-screen pixels.
  const edgeOf = useCallback((el, edge) => {
    const screen = screenRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: (edge === "left" ? r.left : r.right) - screen.left, y: r.top + r.height / 2 - screen.top };
  }, []);

  const attack = useCallback(
    (attacker, hits, skill) => {
      const defender = 1 - attacker;
      const jutsu = hits.find((e) => e.kind === "jutsu");
      const damage = hits.reduce((sum, e) => sum + e.damage, 0);
      const color = elementFor(jutsu?.skill ?? skill);
      const screen = screenRef.current.getBoundingClientRect();

      setLanded((l) => l.map((v, i) => (i === attacker ? v + 1 : v)));
      duel3d.current?.seal(attacker);
      sfx.seal(attacker * 2);

      if (jutsu) {
        const id = nextId.current++;
        setBanner({ id, text: `${jutsu.skill}!`, side: SIDES[attacker], color });
        later(() => setBanner((b) => (b?.id === id ? null : b)), BANNER_MS);
      }

      // Launch from the card's edge facing the center line, so the launch
      // sparks don't hide the seal name.
      const card = cardRefs[attacker].current;
      const from = card
        ? edgeOf(card, attacker ? "left" : "right")
        : { x: screen.width * (attacker ? 0.75 : 0.25), y: screen.height * 0.3 };
      const to = { x: screen.width * (defender ? 0.75 : 0.25), y: screen.height * 0.5 };
      inFlight.current[defender] += 1;

      const onImpact = () => {
        inFlight.current[defender] -= 1;
        duel3d.current?.hit(defender, Boolean(jutsu));
        setShownHp((hp) => hp.map((v, i) => (i === defender ? serverHp.current[i] : v)));

        const fid = nextId.current++;
        setFloats((fs) => [...fs, { id: fid, side: defender, kind: jutsu ? "jutsu" : "sign", text: `-${damage}` }]);
        later(() => setFloats((fs) => fs.filter((f) => f.id !== fid)), FLOAT_MS);
        setFlash((fl) => fl.map((v, i) => (i === defender ? true : v)));
        later(() => setFlash((fl) => fl.map((v, i) => (i === defender ? false : v))), HIT_FLASH_MS);

        if (jutsu) {
          sfx.taiko();
          if (!reducedMotion()) {
            setShake((s) => s + 1);
            later(() => setShake(0), SHAKE_MS);
          }
        } else {
          sfx.tick();
        }
      };

      // 3D strike into the defender's tracked body when the 3D layer runs;
      // otherwise the 2D bolt across the screen.
      // A finished jutsu first plays its cast around the attacker.
      if (duel3d.current && jutsu) duel3d.current.jutsu(attacker, defender, { skill: jutsu.skill, onImpact });
      else if (duel3d.current) duel3d.current.strike(attacker, defender, { skill, onImpact });
      else fxRef.current.bolt(from, to, { color, big: Boolean(jutsu), onImpact });
    },
    // cardRefs are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edgeOf, later]
  );

  const onFrame = (msg) => {
    if (msg.status !== "frame") return;
    const { players, events } = msg.state;
    serverHp.current = players.map((p) => p.hp);
    [0, 1].forEach((a) => {
      const hits = events.filter((e) => e.type === "hit" && e.attacker === a);
      if (hits.length) attack(a, hits, players[a].skill);
    });
    // Bars with nothing in flight toward them simply follow the server, and
    // once the round is over every bar shows the final HP.
    const settled = msg.state.stage === "ko" || msg.state.stage === "done";
    setShownHp((hp) => hp.map((v, i) => (inFlight.current[i] && !settled ? v : serverHp.current[i])));
    // In 3D the live camera is drawn by the Stage; the server's annotated
    // JPEG is only needed for the 2D background.
    if (!fx3d && msg.image) setFrame(msg.image);
    setState(msg.state);
  };

  const send = useFrameSocket({
    url: PVP_WS_URL,
    videoRef,
    active: !labRef,
    startMessage: start,
    intervalMs: FRAME_INTERVAL_MS,
    quality: 0.75,
    onMessage: onFrame,
    onError: () => onError?.("Couldn't reach the duel server."),
  });

  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });
  useEffect(() => {
    if (!labRef) return;
    labRef.current = { ...labRef.current, push: (state) => onFrameRef.current({ status: "frame", state }) };
  }, [labRef]);

  const stage = state?.stage;
  const countdown = stage === "countdown" ? state.countdown : null;
  useEffect(() => {
    if (countdown) sfx.tick();
  }, [countdown]);
  const fighting = stage === "fight";
  useEffect(() => {
    if (fighting) sfx.taiko();
  }, [fighting]);

  const over = stage === "ko" || stage === "done";
  useEffect(() => {
    if (!over) return;
    const t = setTimeout(() => setKoShown(true), KO_PANEL_DELAY_MS);
    return () => clearTimeout(t);
  }, [over]);

  const rematch = () => {
    setFloats([]);
    setFlash([false, false]);
    setBanner(null);
    setKoShown(false);
    setState(null);
    setShownHp([100, 100]);
    inFlight.current = [0, 0];
    if (labRef) labRef.current.rematch?.();
    else send(start);
  };

  const winner = state?.winner;
  const timedOut = over && state.players.every((p) => p.hp > 0);
  const winnerChar = typeof winner === "number" ? characters[winner] : null;

  return (
    <div ref={screenRef} className={`pvp-screen ${shake ? "shake" : ""}`}>
      {fx3d ? (
        <DuelStage video={videoRef.current} state={state} characters={characterIds} apiRef={duel3d} onFail={() => setFx3d(false)} />
      ) : (
        frame && <img className="jutsu-frame" src={frame} alt="" />
      )}
      {!(fx3d ? state : frame) && (
        <div className="jutsu-loading">
          <div className="chakra-medallion small" />
          <Strip label="Preparing the duel…" />
        </div>
      )}

      <div className="pvp-sides">
        {characters.map((c, i) => (
          <PlayerSide
            key={i}
            index={i}
            character={c}
            player={state?.players[i]}
            hp={shownHp[i]}
            fighting={fighting}
            flash={flash[i]}
            floats={floats.filter((f) => f.side === i)}
            landed={landed[i]}
            cardRef={cardRefs[i]}
          />
        ))}
      </div>

      <canvas ref={canvasRef} className="pvp-fx" />

      {shake > 0 && banner && (
        <div
          key={`flash-${banner.id}`}
          className={`pvp-impact-flash on-${banner.side === "left" ? "right" : "left"}`}
          style={{ "--fx-glow": banner.color.glow }}
        />
      )}

      {banner && (
        <div
          key={`banner-${banner.id}`}
          className={`pvp-banner from-${banner.side}`}
          style={{ "--fx-glow": banner.color.glow, "--fx-core": banner.color.core }}
        >
          <span>{banner.text}</span>
        </div>
      )}

      {fighting && (
        <div className="pvp-timer" aria-label="Time left">
          {Math.ceil(state.time_left)}
        </div>
      )}

      {countdown && (
        <div className="hud-center">
          <div key={countdown} className="chakra-medallion pvp-count">
            {countdown}
          </div>
          <Strip label="Get ready: form your seals!" />
        </div>
      )}

      {over && koShown && (
        <StormPanel title={timedOut ? "Time!" : "K.O."} className="pvp-result" sound="reveal">
          {winnerChar ? (
            <>
              <img className="pvp-winner-portrait" src={portraitOf(winnerChar)} alt="" />
              <h1 className="storm-name">Player {winner + 1} wins!</h1>
              <p className="storm-sub">{winnerChar.name}</p>
            </>
          ) : (
            <h1 className="storm-name">Draw</h1>
          )}
        </StormPanel>
      )}

      <div className="prompt-bar pvp-prompts">
        {over && koShown && <Prompt onClick={rematch}>Rematch</Prompt>}
        <Prompt back onClick={onExit}>
          Exit duel
        </Prompt>
      </div>
    </div>
  );
}
