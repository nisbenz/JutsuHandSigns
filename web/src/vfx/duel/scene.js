// 3D layer of a PvP duel: one Stage that lives for the whole duel (rematches
// included), drawing the live camera at full frame rate with the duel's
// effects on top. Fed the latest server state; owns its render loop.
import { Stage } from "../stage";
import { coverMapper } from "../landmarks";
import { DEFAULT_SKILLS, SKILLS } from "../../data/skills";
import { FinisherDirector } from "./finisher";
import { AuraLayer, PlayerFx } from "./player-fx";
import { Reticle } from "./reticle";
import { StrikeLayer } from "./strike";
import { DuelTracker } from "./tracker";

const RIPPLE_S = 0.4;
// Auto quality: drop to "low" after this long under LOW_FPS.
const LOW_FPS = 40;
const LOW_AFTER_S = 3;

export const PLAYER_COLORS = ["#ff9a3c", "#4fc3ff"];

export class DuelScene {
  // characters: the two players' character ids (for their chakra colours).
  // quality: "auto" (default; drops to low if the frame rate sags), "high" or "low".
  constructor(canvas, video, { characters = [], debugCanvas = null, quality = "auto" } = {}) {
    this.video = video;
    this.stage = new Stage(canvas, video);
    this.aura = new AuraLayer(this.stage);
    this.players = [0, 1].map((i) => new PlayerFx(this.stage, i, characters[i]));
    this.reticles = [new Reticle(this.stage.scene), new Reticle(this.stage.scene)];
    this.strikes = new StrikeLayer(this.stage);
    this.anchors = [null, null];
    this.ripple = null;
    this.tracker = new DuelTracker(video, ["pose", "hand", "segment"]);
    this.tracker.ready().catch((err) => console.warn("Duel tracking unavailable, effects use fallbacks:", err));
    this.characters = characters;
    this.finishers = new FinisherDirector(this.stage, this.tracker);
    this.finishers.preload(characters.map((id) => ({ character: id, skills: (SKILLS[id] || DEFAULT_SKILLS).slice(0, 3) })));
    this.debugCanvas = debugCanvas;
    this.state = null;
    // Dev FX lab: freeze the 3D layer and advance it one frame at a time.
    this.paused = false;
    // Smoothed timings for the ?fxstats overlay and auto quality.
    this.stats = { fps: 60, frameMs: 0, trackMs: 0, quality: "high" };
    this.qualityMode = quality;
    this.slowFor = 0;
    if (quality === "low") this.setQuality("low");
    this.raf = 0;
    this.last = 0;
    this.loop = this.loop.bind(this);
  }

  setState(state) {
    this.state = state;
  }

  start() {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  loop(now) {
    // A frame's timestamp can predate performance.now() from start().
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    if (!this.paused) {
      this.frame(dt);
      this.autoQuality(dt);
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  // Server bbox (normalised, already mirrored like the screen) -> viewport px
  // box, through the same object-fit: cover mapping as the background.
  boxToScreen(bbox) {
    const { stage, video } = this;
    if (!bbox || !video.videoWidth) return null;
    const map = coverMapper(stage.width, stage.height, video.videoWidth, video.videoHeight);
    // coverMapper mirrors raw-frame x; the bbox is already mirrored, so undo it.
    const a = map({ x: 1 - bbox[0], y: bbox[1] });
    const b = map({ x: 1 - bbox[2], y: bbox[3] });
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  // Where player i's hands are, in px: the server's detection box when it
  // sees a sign (exactly where the seal is), else tracked hands, else the
  // fallback in their half. Smoothed so switching sources doesn't jump.
  anchorOf(i, dt) {
    const p = this.state?.players?.[i];
    const view = this.tracker.view(i);
    const box = this.boxToScreen(p?.bbox);
    const target = box ? { x: box.x, y: box.y, size: box.h * 0.5 } : { x: view.hand.x, y: view.hand.y, size: view.hand.size };
    const a = this.anchors[i];
    if (!a) return (this.anchors[i] = { ...target });
    const k = 1 - Math.exp(-dt * 14);
    a.x += (target.x - a.x) * k;
    a.y += (target.y - a.y) * k;
    a.size += (target.size - a.size) * k;
    return a;
  }

  // A seal just landed for player i (call before the new state arrives, so
  // the current target is the sign that landed).
  seal(i) {
    this.players[i].seal(this.state?.players?.[i]?.target_sign);
  }

  // Player i was struck (big = jutsu): sparks and red light on their chest,
  // a ripple through the image, a shake.
  hit(i, big) {
    const b = this.tracker.view(i)?.body;
    if (!b) return;
    const at = { x: b.torsoX, y: b.torsoY };
    this.players[i].hit(at, big);
    this.ripple = { ...at, t: 0, big, r: b.span * (big ? 3 : 1.8) };
    this.stage.shake(big ? 0.022 : 0.008);
  }

  // Fire a strike from attacker's hands into defender's chest. onImpact runs
  // when it lands (always: a timer backs up paused animation frames).
  strike(attacker, defender, { skill, big = false, onImpact } = {}) {
    const from = this.anchors[attacker] ?? this.tracker.view(attacker)?.hand;
    const b = this.tracker.view(defender)?.body;
    if (!from || !b) {
      onImpact?.();
      return;
    }
    this.strikes.launch(from, { x: b.torsoX, y: b.torsoY }, { skill, big, light: 2 * defender + 1, onImpact });
  }

  // A finished jutsu: the technique's cast plays around the attacker, then
  // flies into the defender on the beat (onImpact when it lands).
  jutsu(attacker, defender, { skill, onImpact } = {}) {
    this.finishers.play(attacker, {
      skill,
      character: this.characters[attacker],
      onStrike: () => this.strike(attacker, defender, { skill, big: true, onImpact }),
    });
  }

  // "low": render at 1x pixel ratio (bloom follows the render size), and
  // segment the players less often (the aura's mask).
  setQuality(q) {
    if (this.stats.quality === q) return;
    this.stats.quality = q;
    const st = this.stage;
    const ratio = q === "low" ? 1 : Math.min(window.devicePixelRatio, 2);
    st.renderer.setPixelRatio(ratio);
    st.composer.setPixelRatio(ratio);
    st.resize();
    this.tracker.segmentEvery = q === "low" ? 6 : 3;
  }

  autoQuality(dt) {
    if (dt <= 0) return;
    const fps = this.stats.fps = this.stats.fps * 0.95 + (1 / dt) * 0.05;
    if (this.qualityMode !== "auto" || this.stats.quality === "low") return;
    this.slowFor = fps < LOW_FPS ? this.slowFor + dt : 0;
    if (this.slowFor > LOW_AFTER_S) {
      console.info(`Duel FX: ${fps.toFixed(0)} fps, switching to low quality`);
      this.setQuality("low");
    }
  }

  frame(dt) {
    const t0 = performance.now();
    const { stage } = this;
    this.tracker.update(stage.width, stage.height, dt);
    stage.beginFrame(dt);
    const st = this.state;
    const players = st?.players;
    const phase = { stage: st?.stage, countdown: st?.countdown, winner: st?.winner };
    this.players.forEach((fx, i) => {
      const view = this.tracker.view(i);
      fx.update(dt, players?.[i], view, this.anchorOf(i, dt), phase);
      this.aura.set(i, view, fx.auraPower, fx.auraRagged, fx.color, dt);
    });
    this.reticles.forEach((r, i) => {
      const p = players?.[i];
      const box = st?.stage === "fight" ? this.boxToScreen(p?.bbox) : null;
      r.update(dt, stage, box, p?.detected_sign != null && p.detected_sign === p.target_sign, p?.hold_progress ?? 0);
    });
    this.finishers.update(dt);
    this.strikes.update(dt);
    if (this.ripple) {
      const rp = this.ripple;
      rp.t += dt;
      const k = 1 - rp.t / RIPPLE_S;
      if (k <= 0) this.ripple = null;
      else stage.setWarp(rp.x, rp.y, rp.r * (0.6 + 0.6 * (1 - k)), (rp.big ? 0.35 : 0.18) * k * Math.sin(rp.t * 40), 0);
    }
    stage.render(dt);
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.stats.trackMs = this.stats.trackMs * 0.9 + this.tracker.ms * 0.1;
    if (this.debugCanvas) this.drawDebug();
  }

  // ?fxdebug=1: each player's tracked joints and hands in their colour;
  // hollow markers are fallbacks (not tracked).
  drawDebug() {
    const c = this.debugCanvas;
    const { width: W, height: H } = this.stage;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 3;
    this.tracker.views.forEach((v, i) => {
      if (!v) return;
      ctx.strokeStyle = ctx.fillStyle = PLAYER_COLORS[i];
      const dot = (x, y, r, real) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (real) ctx.fill();
        else ctx.stroke();
      };
      Object.values(v.body.joints).forEach((j) => dot(j.x, j.y, 6, v.body.tracked));
      dot(v.hand.x, v.hand.y, 14, v.hand.tracked);
      v.hands.forEach((h) => dot(h.x, h.y, 8, true));
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(`P${i + 1} body:${v.body.tracked ? "yes" : "no"} hands:${v.hands.length}`, i ? W - 230 : 12, H - 60);
    });
    ctx.fillStyle = "#fff";
    ctx.fillText(`tracking ${this.tracker.ms.toFixed(1)} ms ${this.tracker.loaded ? "" : "(loading models…)"}`, W / 2 - 90, H - 30);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.reticles.forEach((r) => r.dispose());
    this.players.forEach((p) => p.dispose());
    this.strikes.dispose();
    this.finishers.dispose();
    this.aura.dispose();
    this.stage.dispose();
  }
}
