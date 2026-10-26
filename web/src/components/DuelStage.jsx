import { useEffect, useRef, useState } from "react";
import { DuelScene } from "../vfx/duel/scene";

const flag = (name) => {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
};
const DEBUG = flag("fxdebug");
const STATS = flag("fxstats");
const QUALITY = (() => {
  try {
    return new URLSearchParams(window.location.search).get("fxquality") ?? "auto";
  } catch {
    return "auto";
  }
})();

// ?fxstats=1: frame rate, 3D frame time and tracking time, four times a second.
function StatsOverlay({ sceneRef }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setInterval(() => {
      const s = sceneRef.current?.stats;
      if (s) setText(`${s.fps.toFixed(0)} fps · 3D ${s.frameMs.toFixed(1)} ms · tracking ${s.trackMs.toFixed(1)} ms · ${s.quality}`);
    }, 250);
    return () => clearInterval(t);
  }, [sceneRef]);
  return <div className="duel-stats">{text}</div>;
}

// Full-screen 3D duel background: the live camera plus the duel's 3D
// effects. Calls onFail (and renders nothing useful) if WebGL can't start or
// the context is lost, so the duel can drop back to its 2D mode.
// apiRef.current is set to the DuelScene (seal / hit / …) while it runs.
export default function DuelStage({ video, state, characters, apiRef, onFail }) {
  const canvasRef = useRef(null);
  const debugRef = useRef(null);
  const sceneRef = useRef(null);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onFailRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    let scene;
    try {
      scene = new DuelScene(canvas, video, { characters, debugCanvas: debugRef.current, quality: QUALITY });
    } catch (err) {
      console.warn("3D duel unavailable, using 2D:", err);
      onFailRef.current?.();
      return;
    }
    const onLost = (e) => {
      e.preventDefault();
      console.warn("WebGL context lost, using 2D duel");
      onFailRef.current?.();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    sceneRef.current = scene;
    if (apiRef) apiRef.current = scene;
    if (import.meta.env.DEV) window.__duelScene = scene; // for inspecting effects in dev
    scene.start();
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      sceneRef.current = null;
      if (apiRef) apiRef.current = null;
      scene.dispose();
    };
    // characters are fixed for a duel's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  return (
    <>
      <canvas ref={canvasRef} className="duel-stage" />
      {DEBUG && <canvas ref={debugRef} className="duel-stage duel-debug" />}
      {STATS && <StatsOverlay sceneRef={sceneRef} />}
    </>
  );
}
