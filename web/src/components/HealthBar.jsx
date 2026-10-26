import { useEffect, useRef, useState } from "react";

const HURT_MS = 260;

// Fighting-game health bar: the front bar drops at once (with a white flash),
// a pale "damage trail" behind it follows a moment later. Anchored at the
// outer screen edge (`side`), so damage eats in from the center line.
export default function HealthBar({ hp, max = 100, side = "left", name, portrait }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const tone = pct < 25 ? "low" : pct < 50 ? "mid" : "high";
  const [hurt, setHurt] = useState(false);
  const prev = useRef(hp);

  useEffect(() => {
    const dropped = hp < prev.current;
    prev.current = hp;
    if (!dropped) return;
    setHurt(true);
    const t = setTimeout(() => setHurt(false), HURT_MS);
    return () => clearTimeout(t);
  }, [hp]);

  return (
    <div className={`health ${side} ${hurt ? "hurt" : ""}`} data-hp={hp}>
      {portrait && <img className="health-portrait" src={portrait} alt="" />}
      <div className="health-main">
        <div className="health-label">
          <span className="health-name">{name}</span>
          <span className="health-value">{Math.max(0, Math.round(hp))}</span>
        </div>
        <div className="health-trough" role="meter" aria-label={`${name} health`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp}>
          <div className="health-trail" style={{ width: `${pct}%` }} />
          <div className={`health-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
