import { useCallback, useEffect, useRef, useState } from "react";
import { SKILLS, DEFAULT_SKILLS } from "./data/skills";
import HandSignIcon from "./components/HandSignIcon";
import JutsuCast from "./components/JutsuCast";
import CharacterPicker from "./components/CharacterPicker";
import { MuteToggle, Prompt, StormPanel, StormRow, StormSky, Strip } from "./components/Storm";
import { sfx } from "./sfx";
import { preloadVfx, vfxFor } from "./vfx/registry";
import "./App.css";

const STAGE = {
  ONBOARDING: "onboarding",
  CONNECTING: "connecting",
  CAMERA: "camera",
  ANALYZING: "analyzing",
  NO_FACE: "no_face",
  RESULT: "result",
  JUTSU: "jutsu",
};

const WS_URL = import.meta.env.VITE_MATCH_WS_URL || "ws://localhost:8000/ws/match";
const JUTSU_WS_URL = import.meta.env.VITE_JUTSU_WS_URL || "ws://localhost:8000/ws/jutsu";
const COUNTDOWN_SECONDS = 5;
const JUTSU_FRAME_INTERVAL_MS = 80;
const INTRO_PLAYED_KEY = "shinobi-intro-played";

const LIGHTNING_KEYWORDS = ["chidori", "lightning", "thunder", "lariat", "flicker"];
const VOICE_BASE = `${import.meta.env.BASE_URL}voice/`;
function jutsuVoiceCandidates(skillName) {
  if (!skillName) return [];
  const slug = skillName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return [VOICE_BASE + slug + ".mp3", VOICE_BASE + "default.mp3"];
}

function jutsuFxVideo(skillName) {
  if (!skillName) return null;
  const key = skillName.toLowerCase();
  const name = LIGHTNING_KEYWORDS.some((k) => key.includes(k))
    ? "tesla-coil"
    : "plasma-orb";
  return `${import.meta.env.BASE_URL}video/fx/${name}.webm`;
}

function introAlreadyPlayed() {
  try {
    return sessionStorage.getItem(INTRO_PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  // The intro cutscene plays once per browser tab session — never again on
  // "Try Again" (which never revisits this stage anyway) or a page refresh
  // within the same session.
  const [stage, setStage] = useState(() =>
    introAlreadyPlayed() ? STAGE.CONNECTING : STAGE.ONBOARDING
  );
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [jutsuSkill, setJutsuSkill] = useState(null);
  const [jutsuFrame, setJutsuFrame] = useState(null);
  const [jutsuState, setJutsuState] = useState(null);
  const [voiceSrc, setVoiceSrc] = useState(null);
  const [castCount, setCastCount] = useState(0);
  // Set when the cast is rendered client-side in 3D (see JutsuCast) rather
  // than by the backend; holds the scored power for the effect.
  const [clientCast, setClientCast] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trainedCount, setTrainedCount] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const wsRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const jutsuWsRef = useRef(null);
  const jutsuIntervalRef = useRef(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const connectWs = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    let intentionalClose = false;

    ws.onopen = () => setStage((s) => (s === STAGE.CONNECTING ? STAGE.CAMERA : s));
    ws.onerror = () => {
      if (!intentionalClose) setError("Couldn't reach the matching server. Is the backend running?");
    };
    ws.onclose = () => {
      if (!intentionalClose) setError((e) => e ?? "Lost connection to the matching server.");
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.status === "no_face") {
        setStage(STAGE.NO_FACE);
      } else if (msg.status === "ok") {
        // A manual pick may have landed while this scan was in flight.
        if (stageRef.current !== STAGE.ANALYZING) return;
        setResult(msg.character);
        setStage(STAGE.RESULT);
      } else {
        setError("The server couldn't process that frame. Try again.");
        setStage(STAGE.CAMERA);
      }
    };

    return () => {
      intentionalClose = true;
      ws.close();
    };
  }, []);

  // Connect once we leave the onboarding screen.
  useEffect(() => {
    if (stage === STAGE.ONBOARDING) return;
    return connectWs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage === STAGE.ONBOARDING]);

  // Camera stays on across CAMERA / ANALYZING / NO_FACE / RESULT — the result
  // is shown as an overlay on the same live feed, not a separate screen.
  const needsCamera = stage !== STAGE.ONBOARDING && stage !== STAGE.CONNECTING;
  useEffect(() => {
    if (!needsCamera) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Camera access was denied or unavailable. Allow camera access and reload.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCamera]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const ws = wsRef.current;
    if (!video || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!video.videoWidth || !video.videoHeight) return;

    setStage(STAGE.ANALYZING);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    ws.send(JSON.stringify({ type: "frame", image: dataUrl }));
  }, []);

  // 5-second "hold still" countdown that runs whenever we're camera-ready,
  // and restarts automatically after a no-face result.
  useEffect(() => {
    if (stage !== STAGE.CAMERA || pickerOpen) return;

    let cancelled = false;
    const video = videoRef.current;

    const waitForVideoReady = () =>
      new Promise((resolve) => {
        const check = () => {
          if (cancelled) return;
          if (video?.videoWidth) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });

    (async () => {
      await waitForVideoReady();
      if (cancelled) return;
      setCountdown(COUNTDOWN_SECONDS);
      let remaining = COUNTDOWN_SECONDS;
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (cancelled) return;
        if (remaining <= 0) {
          clearInterval(countdownTimerRef.current);
          setCountdown(0);
          capture();
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    })();

    return () => {
      cancelled = true;
      clearInterval(countdownTimerRef.current);
    };
  }, [stage, capture, pickerOpen]);

  // After "no face detected," automatically return to the camera stage to
  // retry the countdown.
  useEffect(() => {
    if (stage !== STAGE.NO_FACE) return;
    const t = setTimeout(() => setStage(STAGE.CAMERA), 1800);
    return () => clearTimeout(t);
  }, [stage]);

  // Jutsu practice: opens its own websocket, streams webcam frames, and
  // displays whatever annotated frame (skeleton / HUD / effect) comes back.
  useEffect(() => {
    if (stage !== STAGE.JUTSU || !jutsuSkill) return;
    let cancelled = false;
    setJutsuFrame(null);
    setJutsuState(null);
    setClientCast(null);
    const hasClientVfx = Boolean(vfxFor(jutsuSkill));

    const ws = new WebSocket(JUTSU_WS_URL);
    jutsuWsRef.current = ws;

    const sendFrame = () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || ws.readyState !== WebSocket.OPEN) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      ws.send(JSON.stringify({ type: "frame", image: canvas.toDataURL("image/jpeg", 0.85) }));
    };

    ws.onopen = () => {
      if (cancelled) return;
      ws.send(JSON.stringify({ type: "start", skill: jutsuSkill }));
      jutsuIntervalRef.current = setInterval(sendFrame, JUTSU_FRAME_INTERVAL_MS);
    };
    ws.onmessage = (event) => {
      if (cancelled) return;
      const msg = JSON.parse(event.data);
      if (msg.status !== "frame") return;
      if (msg.state.stage === "cast" && hasClientVfx) {
        // The backend's job ends at "sequence complete"; the cast itself
        // runs in the browser at full frame rate.
        clearInterval(jutsuIntervalRef.current);
        ws.close();
        setJutsuState(msg.state);
        setClientCast({ power: msg.state.power ?? 1 });
        return;
      }
      setJutsuFrame(msg.image);
      setJutsuState(msg.state);
    };
    ws.onerror = () => {
      if (!cancelled) setError("Couldn't reach the jutsu training server.");
    };

    return () => {
      cancelled = true;
      clearInterval(jutsuIntervalRef.current);
      ws.close();
    };
  }, [stage, jutsuSkill]);

  // Voice shout: at cast time, probe recorded clips in /voice/ — the exact
  // technique slug first ("rasengan.mp3"), then default.mp3. A missing file
  // moves to the next candidate; no clip at all = no sound.
  useEffect(() => {
    if (jutsuState?.stage !== "cast" || !jutsuSkill) return;
    const candidates = jutsuVoiceCandidates(jutsuSkill);
    let idx = 0;
    const probeOnNext = () => {
      idx += 1;
      if (idx < candidates.length) probe();
      else setVoiceSrc(null);
    };
    const probe = () => {
      const a = new Audio();
      a.oncanplaythrough = () => {
        a.oncanplaythrough = null;
        a.onerror = null;
        setVoiceSrc(candidates[idx]);
        setCastCount((n) => n + 1);
      };
      a.onerror = probeOnNext;
      a.preload = "auto";
      a.src = candidates[idx];
    };
    probe();
  }, [jutsuState?.stage === "cast", jutsuSkill]);

  // UI sounds tied to game state rather than to a button.
  useEffect(() => {
    if (stage === STAGE.CAMERA && !pickerOpen && countdown > 0) sfx.tick();
  }, [stage, pickerOpen, countdown]);

  const sealIdx = jutsuState?.stage === "play" ? jutsuState.idx : null;
  const prevSealIdx = useRef(null);
  useEffect(() => {
    if (sealIdx != null && prevSealIdx.current != null && sealIdx > prevSealIdx.current) sfx.seal(sealIdx - 1);
    prevSealIdx.current = sealIdx;
  }, [sealIdx]);

  const casting = jutsuState?.stage === "cast";
  useEffect(() => {
    if (casting) sfx.taiko();
  }, [casting]);

  const handleSelectJutsu = useCallback((skill) => {
    preloadVfx(skill, result?.id);
    setJutsuSkill(skill);
    setStage(STAGE.JUTSU);
  }, [result]);

  const handleCastDone = useCallback(() => {
    setJutsuState((s) => (s ? { ...s, stage: "done" } : s));
  }, []);

  const handleJutsuDone = useCallback(() => {
    setTrainedCount((n) => n + 1);
    setJutsuSkill(null);
    setStage(STAGE.RESULT);
  }, []);

  const handleIntroEnded = useCallback(() => {
    try {
      sessionStorage.setItem(INTRO_PLAYED_KEY, "1");
    } catch {
      // no sessionStorage (private mode etc.) — intro may replay on refresh, fine
    }
    setStage(STAGE.CONNECTING);
  }, []);

  const handlePickCharacter = useCallback((character) => {
    setPickerOpen(false);
    setResult({ ...character, picked: true });
    setStage(STAGE.RESULT);
  }, []);

  const handleClosePicker = useCallback(() => setPickerOpen(false), []);

  const handleRetry = useCallback(() => {
    setResult(null);
    setStage(STAGE.CAMERA);
  }, []);

  if (error) {
    return (
      <StormSky className="app-shell">
        <StormPanel title="Interrupted" className="message-panel">
          <p className="storm-text error-text">{error}</p>
        </StormPanel>
      </StormSky>
    );
  }

  if (stage === STAGE.ONBOARDING) {
    return (
      <div className="onboarding">
        <video
          className="intro-video"
          src={`${import.meta.env.BASE_URL}video/rasengan-throw.mp4`}
          autoPlay
          muted
          playsInline
          onEnded={handleIntroEnded}
        />
      </div>
    );
  }

  if (stage === STAGE.CONNECTING) {
    return (
      <StormSky className="app-shell">
        <StormPanel title="Loading" className="message-panel">
          <p className="storm-text">Connecting to the matching server…</p>
        </StormPanel>
      </StormSky>
    );
  }

  // CAMERA / ANALYZING / NO_FACE / RESULT / JUTSU all share the same live
  // camera feed; each stage is an overlay on top of it, not a new page.
  const skills = result ? (SKILLS[result.id] || DEFAULT_SKILLS).slice(0, 3) : [];
  return (
    <div className="camera-screen">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`video-fullscreen ${stage === STAGE.JUTSU ? "hidden" : ""}`}
      />

      {stage === STAGE.JUTSU && (
        <div className="jutsu-screen">
          {clientCast ? (
            jutsuState?.stage === "cast" && (
              <JutsuCast
                video={videoRef.current}
                skill={jutsuSkill}
                character={result?.id}
                power={clientCast.power}
                onDone={handleCastDone}
              />
            )
          ) : jutsuFrame ? (
            <img className="jutsu-frame" src={jutsuFrame} alt="" />
          ) : (
            <div className="jutsu-loading">
              <div className="chakra-medallion small" />
              <Strip label={`Summoning ${jutsuSkill}…`} />
            </div>
          )}

          {!clientCast && jutsuState?.stage === "cast" && jutsuFxVideo(jutsuSkill) && (
            <video
              className="jutsu-fx-overlay"
              src={jutsuFxVideo(jutsuSkill)}
              autoPlay
              muted
              loop
              playsInline
            />
          )}

          {jutsuState?.stage === "cast" && voiceSrc && (
            <audio key={castCount} src={voiceSrc} autoPlay />
          )}

          {jutsuState?.stage === "play" && (
            <StormPanel title={`Seal ${jutsuState.idx + 1} of ${jutsuState.total}`} className="jutsu-target-card">
              <HandSignIcon sign={jutsuState.target_sign} size={88} />
              <h1 className="storm-name jutsu-target-name">{jutsuState.target_sign}</h1>
              <div className="jutsu-progress-dots">
                {jutsuState.sequence.map((_sign, i) => (
                  <span
                    key={i}
                    className={`dot ${i < jutsuState.idx ? "done" : i === jutsuState.idx ? "active" : ""}`}
                  />
                ))}
              </div>
              <div className="chakra-gauge">
                <div
                  className="chakra-gauge-fill"
                  style={{ width: `${(jutsuState.hold_progress ?? 0) * 100}%` }}
                />
              </div>
              <p className="storm-sub">
                {jutsuState.detected_sign
                  ? `Detected: ${jutsuState.detected_sign}`
                  : "Form the sign with both hands"}
              </p>
            </StormPanel>
          )}

          {jutsuState?.stage === "done" && (
            <>
              <StormPanel title={jutsuState.rating} className="jutsu-result-card" sound="reveal">
                <StormRow label={jutsuSkill} value={`Power ${Math.round((jutsuState.power ?? 0) * 100)}%`} />
              </StormPanel>
              <div className="prompt-bar">
                <Prompt onClick={handleJutsuDone}>Next</Prompt>
              </div>
            </>
          )}
        </div>
      )}

      {stage !== STAGE.RESULT && stage !== STAGE.JUTSU && (
        <div className="hud">
          <div className="hud-corner tl" />
          <div className="hud-corner tr" />
          <div className="hud-corner bl" />
          <div className="hud-corner br" />
          <div className="hud-scanline" />

          {stage === STAGE.CAMERA && (
            <div className="hud-center">
              <div className="chakra-medallion">{countdown}</div>
              <Strip label="Hold still, reading your chakra…" />
            </div>
          )}
          {stage === STAGE.ANALYZING && (
            <div className="hud-center">
              <Strip label="Analyzing…" />
            </div>
          )}
          {stage === STAGE.NO_FACE && (
            <div className="hud-center">
              <Strip className="warn" label="No face detected — center yourself in frame" />
            </div>
          )}
          <div className="prompt-bar">
            <Prompt onClick={() => setPickerOpen(true)}>Choose character</Prompt>
          </div>
        </div>
      )}

      {stage === STAGE.RESULT && result && (
        <StormSky className="result-overlay">
          <img
            className="result-character"
            src={`${import.meta.env.BASE_URL}characters/${result.file}`}
            alt={result.name}
          />
          <StormPanel title={result.picked ? "You chose" : "Your shinobi"} className="result-panel" sound="reveal">
            <h1 className="storm-name">{result.name}</h1>
            <p className="storm-sub">Choose a technique to train</p>
            <div className="storm-rows">
              {skills.map((skill) => (
                <StormRow
                  key={skill}
                  label={skill}
                  badge={vfxFor(skill) ? "3D" : null}
                  value="Train ›"
                  onClick={() => handleSelectJutsu(skill)}
                />
              ))}
            </div>
          </StormPanel>
          <Strip className="result-strip" label="Jutsu trained" value={trainedCount} />
          <div className="prompt-bar">
            <Prompt back onClick={handleRetry}>Scan again</Prompt>
            <Prompt onClick={() => setPickerOpen(true)}>Choose character</Prompt>
          </div>
        </StormSky>
      )}

      <MuteToggle />

      {pickerOpen && <CharacterPicker onPick={handlePickCharacter} onClose={handleClosePicker} />}
    </div>
  );
}
