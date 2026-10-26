// Timing rules for jutsu finishers in a duel (pure, unit tested in
// finisher-plan.test.js). A finisher is a training-mode cast effect played
// around the attacker as a short "duel cut" while the fight keeps going.

export const MAX_CUT_S = 3.2; // a finisher never runs longer than this
export const STRIKE_BEAT_S = 1.4; // when the jutsu leaves the caster
export const MAX_WAIT_S = 1.2; // how long a second finisher may queue

// Effect duration (s) -> how fast to play it and how long it lasts.
export function duelCut(duration) {
  if (!(duration > 0)) return { timeScale: 1, length: 0 };
  if (duration <= MAX_CUT_S) return { timeScale: 1, length: duration };
  return { timeScale: duration / MAX_CUT_S, length: MAX_CUT_S };
}

// When, in real seconds from the start of the cut, the strike fires: the
// beat, but never after the cut is over.
export function strikeAt(length) {
  return Math.min(STRIKE_BEAT_S, Math.max(0, length - 0.2));
}

// One finisher plays at a time. request() returns "play" if nothing is
// playing, else queues it. tick(now) returns what to do with queued ones:
// start the next when the stage is free, or give up on ones that waited too
// long (they become strike-only, so the hit still lands).
export class FinisherQueue {
  constructor() {
    this.playingUntil = -Infinity;
    this.waiting = [];
  }

  request(item, now, length) {
    if (now >= this.playingUntil && this.waiting.length === 0) {
      this.playingUntil = now + length;
      return "play";
    }
    this.waiting.push({ item, since: now, length });
    return "wait";
  }

  // -> { start: item | null, expired: item[] }
  tick(now) {
    const expired = [];
    this.waiting = this.waiting.filter((w) => {
      if (now - w.since > MAX_WAIT_S) {
        expired.push(w.item);
        return false;
      }
      return true;
    });
    let start = null;
    if (now >= this.playingUntil && this.waiting.length) {
      const w = this.waiting.shift();
      this.playingUntil = now + w.length;
      start = w.item;
    }
    return { start, expired };
  }

  // The playing finisher ended (possibly before its estimated length):
  // free the stage now.
  release(now) {
    this.playingUntil = Math.min(this.playingUntil, now);
  }

  // Remove a still-waiting item (e.g. its wait timed out while animation
  // frames were paused). Returns whether it was still waiting.
  cancel(item) {
    const n = this.waiting.length;
    this.waiting = this.waiting.filter((w) => w.item !== item);
    return this.waiting.length !== n;
  }

  clear() {
    this.playingUntil = -Infinity;
    this.waiting = [];
  }
}
