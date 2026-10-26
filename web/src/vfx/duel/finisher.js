// Plays jutsu finishers in a duel: the technique's training-mode 3D cast
// (or the generic finisher) runs around the ATTACKER only, using their
// scoped tracking view, as a short "duel cut"; on the strike beat the jutsu
// flies into the defender. One finisher at a time (see finisher-plan.js).
import { vfxFor } from "../registry";
import { bakeWhenIdle } from "../sculpt";
import { FinisherQueue, MAX_WAIT_S, duelCut, strikeAt } from "./finisher-plan";
import GenericFinisher from "./generic";

const nowS = () => performance.now() / 1000;

// The cast for a skill: its registered effect, or the generic finisher.
export function finisherFor(skill) {
  return vfxFor(skill) ?? GenericFinisher;
}

export class FinisherDirector {
  constructor(stage, tracker) {
    this.stage = stage;
    this.tracker = tracker;
    this.queue = new FinisherQueue();
    this.active = null;
    this.timers = new Set();
  }

  // Load what the players' techniques need before the first finisher:
  // extra trackers (face for eye techniques) and baked sculpts (Susanoo).
  preload(players) {
    for (const { character, skills } of players) {
      for (const skill of skills) {
        const Effect = finisherFor(skill);
        Effect.needs?.forEach((kind) => this.tracker.need(kind).catch(() => {}));
        if (Effect.prebake) bakeWhenIdle(() => Effect.prebake(character));
      }
    }
  }

  _later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // Play `skill` around player `attacker`; onStrike() fires the strike, on
  // the beat — or right away if the finisher can't get the stage in time.
  play(attacker, { skill, character, onStrike }) {
    const Effect = finisherFor(skill);
    const cut = duelCut(Effect.duration);
    const item = { attacker, skill, character, Effect, cut, onStrike, struck: false };
    if (this.queue.request(item, nowS(), cut.length) === "play") {
      this._start(item);
    } else {
      // Animation frames may be paused (background tab): make sure a queued
      // finisher still gives up and strikes after its wait.
      this._later(() => {
        if (this.queue.cancel(item)) this._strike(item);
      }, MAX_WAIT_S * 1000 + 100);
    }
  }

  _strike(item) {
    if (item.struck) return;
    item.struck = true;
    item.onStrike?.();
  }

  _start(item) {
    let effect = null;
    try {
      effect = new item.Effect(this.stage, { power: 1, character: item.character, skill: item.skill });
    } catch (err) {
      console.warn(`Finisher for ${item.skill} failed, striking without it:`, err);
      this._strike(item);
      return;
    }
    this._end();
    // The same object the backup timer holds, so `struck` is shared and the
    // strike can only fire once.
    Object.assign(item, { effect, t: 0, at: strikeAt(item.cut.length) });
    this.active = item;
    // The strike must land even if animation frames stop.
    this._later(() => this._strike(item), this.active.at * 1000 + 150);
  }

  _end() {
    if (!this.active) return;
    this.active.effect.dispose();
    this.queue.release(nowS());
    this._strike(this.active);
    this.active = null;
  }

  update(dt) {
    const { start, expired } = this.queue.tick(nowS());
    expired.forEach((item) => this._strike(item));
    if (start) this._start(start);

    const a = this.active;
    if (!a) return;
    a.t += dt;
    const k = a.cut.timeScale;
    try {
      a.effect.update(a.t * k, dt * k, this.tracker.view(a.attacker));
    } catch (err) {
      console.warn(`Finisher for ${a.skill} broke mid-cast:`, err);
      this._end();
      return;
    }
    if (a.t >= a.at) this._strike(a);
    if (a.t >= a.cut.length) this._end();
  }

  clear() {
    this.queue.clear();
    this._end();
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.queue.clear();
    if (this.active) this.active.effect.dispose();
    this.active = null;
  }
}
