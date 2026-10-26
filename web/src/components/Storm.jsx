// UI kit in the style of the Ultimate Ninja Storm menus: purple title bar
// with swirl-cloud trim, cream parchment body inside a lavender frame, gold
// swirl clouds, dark stat strips and text prompts. All
// motifs are drawn here (SVG/CSS) — no game assets.
import { useEffect, useMemo, useState } from "react";
import { sfx } from "../sfx";

// Inward spiral (outer -> center) as an SVG path: the curl inside each cloud.
function spiralPath(cx, cy, r, turns = 1.8, start = 0) {
  const steps = 48;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.82);
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }
  return d;
}

// Small deterministic RNG so cloud layouts don't reshuffle on re-render.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Band of golden swirl clouds along the bottom of the screen.
export function CloudBand({ seed = 7, className = "" }) {
  const puffs = useMemo(() => {
    const r = rng(seed);
    const out = [];
    for (let row = 0; row < 2; row++) {
      for (let x = -60; x < 1700; x += 120 + r() * 90) {
        const rad = (row ? 70 : 95) + r() * 45;
        out.push({ x, y: (row ? 250 : 215) + r() * 30, rad, row, turn: r() * Math.PI * 2 });
      }
    }
    return out;
  }, [seed]);
  return (
    <svg className={`cloud-band ${className}`} viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <radialGradient id="cloud-fill" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fbf3d8" />
          <stop offset="0.7" stopColor="#ead9a6" />
          <stop offset="1" stopColor="#c9ad6a" />
        </radialGradient>
      </defs>
      {puffs.map((p, i) => (
        <g key={i} opacity={p.row ? 1 : 0.85}>
          <circle cx={p.x} cy={p.y} r={p.rad} fill="url(#cloud-fill)" stroke="#a88c4c" strokeWidth="5" />
          <path d={spiralPath(p.x, p.y, p.rad * 0.78, 1.9, p.turn)} fill="none" stroke="#a88c4c" strokeWidth="6" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

// Faint line-art swirls, used as a watermark and in the title bar trim.
function SwirlTrim({ className, color, seed = 3, count = 5, width = 400, height = 60 }) {
  const items = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: count }, (_, i) => ({
      x: (i + 0.5) * (width / count) + (r() - 0.5) * 20,
      y: height * (0.35 + r() * 0.4),
      rad: height * (0.28 + r() * 0.25),
      turn: r() * Math.PI * 2,
    }));
  }, [seed, count, width, height]);
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {items.map((s, i) => (
        <path key={i} d={spiralPath(s.x, s.y, s.rad, 1.6, s.turn)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      ))}
    </svg>
  );
}

// Painted menu backdrop: teal sky melting into a gold horizon, distant rock
// pillars and a cloud band.
export function StormSky({ children, className = "" }) {
  return (
    <div className={`storm-sky ${className}`}>
      <svg className="storm-sky-rocks" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden>
        <defs>
          <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6f8f5a" />
            <stop offset="1" stopColor="#c9c08a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M60 900 L90 260 Q150 170 230 240 L270 900 Z" fill="url(#rock)" opacity="0.55" />
        <path d="M390 900 L420 420 Q470 360 520 420 L540 900 Z" fill="url(#rock)" opacity="0.35" />
        <path d="M1040 900 L1060 330 Q1120 250 1190 310 L1220 900 Z" fill="url(#rock)" opacity="0.4" />
        <path d="M1330 900 L1360 120 Q1440 40 1530 110 L1560 900 Z" fill="url(#rock)" opacity="0.6" />
      </svg>
      {children}
      <CloudBand />
    </div>
  );
}

// `sound` plays once when the panel appears ("open" swish, "reveal").
export function StormPanel({ title, children, className = "", footer, sound }) {
  useEffect(() => {
    if (sound) sfx[sound]();
  }, [sound]);
  return (
    <section className={`storm-panel ${className}`}>
      {title != null && (
        <header className="storm-panel-title">
          <SwirlTrim className="storm-panel-trim" color="rgba(190, 170, 230, 0.45)" seed={11} count={6} />
          <h2>{title}</h2>
        </header>
      )}
      <div className="storm-panel-body">
        <SwirlTrim className="storm-panel-watermark" color="rgba(170, 150, 110, 0.22)" seed={5} count={4} width={300} height={140} />
        {children}
      </div>
      {footer}
    </section>
  );
}

// Card-stack glyph, like the info-card icon on the prize rows.
export function CardIcon() {
  return (
    <svg className="storm-row-icon" viewBox="0 0 40 40" aria-hidden>
      <rect x="11" y="5" width="20" height="28" rx="3" transform="rotate(14 21 19)" fill="#2c6f86" stroke="#123846" strokeWidth="2" />
      <rect x="8" y="7" width="20" height="28" rx="3" transform="rotate(4 18 21)" fill="#3a8ba3" stroke="#123846" strokeWidth="2" />
      <rect x="5" y="9" width="20" height="28" rx="3" transform="rotate(-8 15 23)" fill="#5bb0c4" stroke="#123846" strokeWidth="2" />
      <circle cx="15" cy="23" r="4" fill="none" stroke="#e8f6f8" strokeWidth="2" />
    </svg>
  );
}

// Parchment row: icon, label, and a right-aligned value under a rule.
export function StormRow({ label, value, badge, onClick, icon = <CardIcon /> }) {
  const Tag = onClick ? "button" : "div";
  const handlers = onClick
    ? {
        onMouseEnter: sfx.hover,
        onFocus: sfx.hover,
        onClick: (e) => {
          sfx.select();
          onClick(e);
        },
      }
    : {};
  return (
    <Tag className={`storm-row ${onClick ? "is-button" : ""}`} {...handlers}>
      {icon}
      <span className="storm-row-text">
        <span className="storm-row-label">
          {label}
          {badge && <span className="storm-badge">{badge}</span>}
        </span>
        {value != null && <span className="storm-row-value">{value}</span>}
      </span>
    </Tag>
  );
}

// Text prompt on a dark strip, bottom right ("Next"). `back` prompts play
// the back sound instead of the confirm one.
export function Prompt({ back = false, children, onClick }) {
  const click = (e) => {
    (back ? sfx.back : sfx.select)();
    onClick?.(e);
  };
  return (
    <button className="storm-prompt" onClick={click} onMouseEnter={sfx.hover} onFocus={sfx.hover}>
      {children}
    </button>
  );
}

// Small round sound toggle, top-left.
export function MuteToggle() {
  const [muted, setMuted] = useState(sfx.muted);
  const toggle = () => {
    sfx.setMuted(!muted);
    setMuted(!muted);
    if (muted) sfx.select();
  };
  return (
    <button className="storm-mute" onClick={toggle} aria-label={muted ? "Unmute sounds" : "Mute sounds"} title={muted ? "Sound off" : "Sound on"}>
      {muted ? "♪̸" : "♪"}
    </button>
  );
}

// Dark stat strip: "Total number of battles ........ 2".
export function Strip({ label, value, className = "" }) {
  return (
    <div className={`storm-strip ${className}`}>
      <span>{label}</span>
      {value != null && <span className="storm-strip-value">{value}</span>}
    </div>
  );
}
