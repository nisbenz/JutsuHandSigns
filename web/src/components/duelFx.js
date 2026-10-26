// 2D additive-glow effects for duel hits, drawn on one canvas over the whole
// duel screen: a chakra bolt flies from the attacker's half to the
// defender's, then bursts into sparks and a shockwave ring on impact. The
// loop only runs while something is on screen.

import { DEFAULT_ELEMENT, elementOf } from "../vfx/duel/elements";

export const elementFor = (skill) => elementOf(skill);

const easeOut = (t) => 1 - (1 - t) ** 3;

export class DuelFx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bolts = [];
    this.sparks = [];
    this.rings = [];
    this.raf = 0;
    this.last = 0;
    this.timers = new Set();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = this.canvas.getBoundingClientRect();
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    this.observer.disconnect();
  }

  // Size unit that scales with the screen, so effects read the same on a
  // phone and a TV.
  get unit() {
    return Math.min(this.w, this.h) / 100;
  }

  // Fly a bolt from `from` to `to` (canvas px); `onImpact` fires on arrival.
  // Arrival is also guaranteed by a timer: browsers pause animation frames in
  // background tabs, and gameplay (HP bars) must not wait on the visuals.
  bolt(from, to, { color = DEFAULT_ELEMENT, big = false, onImpact } = {}) {
    const u = this.unit;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const bolt = {
      from,
      to,
      // Arc upward a little, like a thrown jutsu rather than a laser.
      ctrl: { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - dist * (big ? 0.28 : 0.18) },
      t: 0,
      duration: big ? 0.5 : 0.32,
      radius: u * (big ? 4.5 : 2.8),
      color,
      big,
      trail: [],
      onImpact,
      landed: false,
    };
    this.bolts.push(bolt);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (bolt.landed) return;
      this.land(bolt);
      this.bolts = this.bolts.filter((b) => b !== bolt);
    }, bolt.duration * 1000 + 80);
    this.timers.add(timer);
    this.burst(from.x, from.y, color, { count: big ? 26 : 12, speed: u * 30, size: u * 0.7 });
    this.start();
  }

  burst(x, y, color, { count = 20, speed = 40, size = 1.2, life = 0.6 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.9);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        size: size * (0.5 + Math.random()),
        life: life * (0.6 + Math.random() * 0.6),
        age: 0,
        color,
      });
    }
    this.start();
  }

  ring(x, y, color, maxRadius, duration = 0.45, width = 6) {
    this.rings.push({ x, y, color, maxRadius, duration, width, age: 0 });
    this.start();
  }

  impact(x, y, color, big) {
    const u = this.unit;
    this.burst(x, y, color, { count: big ? 70 : 30, speed: u * (big ? 75 : 45), size: u * (big ? 1.2 : 0.8), life: big ? 0.9 : 0.55 });
    this.ring(x, y, color, u * (big ? 34 : 14), big ? 0.6 : 0.4, u * (big ? 1.6 : 0.9));
    if (big) this.ring(x, y, { ...color, glow: color.core }, u * 20, 0.35, u * 0.8);
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    // A frame's timestamp can predate the performance.now() read in start(),
    // so the first step may come out negative.
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = "lighter";

    this.bolts = this.bolts.filter((b) => this.drawBolt(b, dt));
    this.rings = this.rings.filter((r) => this.drawRing(r, dt));
    this.sparks = this.sparks.filter((s) => this.drawSpark(s, dt));

    ctx.globalCompositeOperation = "source-over";
    if (this.bolts.length || this.rings.length || this.sparks.length) {
      this.raf = requestAnimationFrame((n) => this.frame(n));
    } else {
      this.raf = 0;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  glow(x, y, radius, color, alpha = 1) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color.core);
    g.addColorStop(0.3, color.glow);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawBolt(b, dt) {
    b.t = Math.min(1, b.t + dt / b.duration);
    const t = easeOut(b.t);
    const it = 1 - t;
    const x = it * it * b.from.x + 2 * it * t * b.ctrl.x + t * t * b.to.x;
    const y = it * it * b.from.y + 2 * it * t * b.ctrl.y + t * t * b.to.y;
    b.trail.push({ x, y });
    if (b.trail.length > (b.big ? 22 : 14)) b.trail.shift();

    b.trail.forEach((p, i) => {
      const k = (i + 1) / b.trail.length;
      this.glow(p.x, p.y, b.radius * (0.4 + k * 0.9), b.color, k * 0.55);
    });
    const flicker = 0.85 + Math.random() * 0.3;
    this.glow(x, y, b.radius * 2.4 * flicker, b.color, 0.9);
    this.glow(x, y, b.radius * 0.9, { core: "#ffffff", glow: b.color.core }, 1);

    // Jutsu bolts shed sparks as they fly.
    if (b.big) {
      const u = this.unit;
      for (let i = 0; i < 3; i++) {
        this.sparks.push({
          x,
          y,
          vx: (Math.random() - 0.5) * u * 25,
          vy: (Math.random() - 0.5) * u * 25,
          size: u * (0.4 + Math.random() * 0.6),
          life: 0.35,
          age: 0,
          color: b.color,
        });
      }
    }

    if (b.t >= 1) {
      this.land(b);
      return false;
    }
    return true;
  }

  land(b) {
    b.landed = true;
    this.impact(b.to.x, b.to.y, b.color, b.big);
    b.onImpact?.();
  }

  drawRing(r, dt) {
    r.age += dt;
    const k = r.age / r.duration;
    if (k >= 1) return false;
    const { ctx } = this;
    ctx.globalAlpha = (1 - k) ** 1.5;
    ctx.strokeStyle = r.color.glow;
    ctx.lineWidth = r.width * (1 - k * 0.6);
    ctx.shadowColor = r.color.glow;
    ctx.shadowBlur = r.width * 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.maxRadius * easeOut(k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return true;
  }

  drawSpark(s, dt) {
    s.age += dt;
    if (s.age >= s.life) return false;
    s.vx *= 1 - 3 * dt;
    s.vy = s.vy * (1 - 3 * dt) + this.unit * 20 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    this.glow(s.x, s.y, s.size * 3, s.color, 1 - s.age / s.life);
    return true;
  }
}
