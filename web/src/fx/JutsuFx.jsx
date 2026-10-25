import { useEffect, useRef, useState } from "react";
import { FxRenderer } from "./renderer";
import { Tracker, MockTracker } from "./tracker";
import { fxForSkill, trackersFor } from "./catalog";

// Fullscreen live cast effect: the camera feed (mirrored) with the skill's
// effect layers tracked onto the hands / body / face in real time.
//
// Pass either `stream` (a MediaStream; real tracking) or `mock` (synthetic
// tracking over a generated backdrop, for the ?fxlab gallery). `restartKey`
// restarts the cast animation from t=0 when it changes.
export default function JutsuFx({ skill, stream, mock = false, restartKey = 0, className = "" }) {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const [missing, setMissing] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    let source;
    let backdrop;
    if (mock) {
      backdrop = makeBackdrop();
      source = backdrop.canvas;
    } else {
      source = videoRef.current;
      source.srcObject = stream || null;
      source.play().catch(() => {});
    }

    let renderer;
    try {
      renderer = new FxRenderer(canvas, source);
    } catch (err) {
      console.error("[fx]", err);
      return undefined;
    }
    const spec = fxForSkill(skill);
    const tracker = mock ? new MockTracker() : new Tracker(source, trackersFor(spec));
    const start = performance.now();
    let raf = 0;
    let frame = 0;
    let lastMissing = "";
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      backdrop?.draw(now / 1000);
      try {
        renderer.render(spec, tracker.update(), (now - start) / 1000);
        // Wait ~1s before hinting, so it doesn't flash while models load.
        if (++frame % 10 === 0) {
          const m = now - start > 1000 ? [...renderer.missing(spec)].join(",") : "";
          if (m !== lastMissing) {
            lastMissing = m;
            setMissing(m);
          }
        }
      } catch (err) {
        console.error("[fx] render failed", err);
        cancelAnimationFrame(raf);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      tracker.dispose();
      renderer.dispose();
    };
  }, [skill, stream, mock, restartKey]);

  return (
    <div className={`jutsu-fx ${className}`}>
      <video ref={videoRef} className="jutsu-fx-source" autoPlay muted playsInline />
      <canvas ref={canvasRef} className="jutsu-fx-canvas" />
      {missing && <p className="jutsu-fx-hint">{hintFor(missing)}</p>}
    </div>
  );
}

function hintFor(missing) {
  if (missing.includes("hands")) return "Raise your hands to release the jutsu";
  if (missing.includes("body")) return "Step back so your shoulders are in frame";
  return "Face the camera";
}

// A stand-in "camera frame" for mock mode: dim room + a silhouette whose
// head/shoulders/hands line up with MockTracker's landmarks.
function makeBackdrop() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  return {
    canvas,
    draw(t) {
      const W = canvas.width;
      const H = canvas.height;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#3a4150");
      g.addColorStop(1, "#1b1f27");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#c79b7f";
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.32, W * 0.07, H * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2c3d5a";
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.95, W * 0.2, H * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes so the eye effects have something to sit on.
      ctx.fillStyle = "#f2efe9";
      for (const ex of [0.465, 0.535]) {
        ctx.beginPath();
        ctx.ellipse(W * ex, H * 0.3, W * 0.022, H * 0.016, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#4a3326";
      for (const ex of [0.465, 0.535]) {
        ctx.beginPath();
        ctx.arc(W * ex, H * 0.3, H * 0.012, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#c79b7f";
      for (const [cx, ph] of [[0.3, 0], [0.7, 2]]) {
        const x = (cx + Math.sin(t * 0.8 + ph) * 0.04) * W;
        const y = (0.55 + Math.cos(t * 0.6 + ph) * 0.03) * H;
        ctx.beginPath();
        ctx.ellipse(x, y, W * 0.045, H * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}
