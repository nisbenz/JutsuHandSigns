import { useEffect, useRef, useState } from "react";
import { Stage } from "../vfx/stage";
import { Tracker } from "../vfx/tracking";
import { vfxFor } from "../vfx/registry";

const HINTS = {
  face: "Look into the camera",
  hand: "Raise your hand into frame",
  pose: "Step back so your shoulders are in frame",
  segment: "Stand in frame",
};

// Full-screen 3D cast of one jutsu over the live camera. Runs the effect's
// timeline once, then calls onDone.
export default function JutsuCast({ video, skill, character, power, onDone }) {
  const canvasRef = useRef(null);
  const onDoneRef = useRef(onDone);
  const [hint, setHint] = useState(null);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const Effect = vfxFor(skill);
    if (!Effect || !video) return;
    let cancelled = false;
    let raf = 0;
    const stage = new Stage(canvasRef.current, video);
    const tracker = new Tracker(video, Effect.needs);
    let effect = null;

    // Show the plain feed while trackers load, so there is no black flash.
    let last = performance.now();
    const idle = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      stage.beginFrame(dt);
      stage.render(dt);
      raf = requestAnimationFrame(idle);
    };
    raf = requestAnimationFrame(idle);

    tracker
      .ready()
      .catch((err) => console.warn("VFX tracking unavailable, casting untracked:", err))
      .then(() => {
        if (cancelled) return;
        cancelAnimationFrame(raf);
        effect = new Effect(stage, { power, character });
        const t0 = performance.now();
        last = t0;
        const loop = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const t = (now - t0) / 1000;
          tracker.update(stage.width, stage.height, dt);
          stage.beginFrame(dt);
          effect.update(t, dt, tracker);
          stage.render(dt);
          const need = Effect.needs[0];
          const target = need && tracker[need === "pose" ? "body" : need];
          setHint(target && !target.seen && t > 0.6 ? need : null);
          if (t >= Effect.duration) {
            onDoneRef.current?.();
            return;
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      effect?.dispose();
      stage.dispose();
    };
  }, [video, skill, character, power]);

  return (
    <div className="jutsu-cast">
      <canvas ref={canvasRef} className="jutsu-cast-canvas" />
      {hint && (
        <p className="storm-strip jutsu-cast-hint">
          {HINTS[hint]}
        </p>
      )}
    </div>
  );
}
