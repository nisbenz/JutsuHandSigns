import { describe, expect, it } from "vitest";
import { FinisherQueue, MAX_CUT_S, MAX_WAIT_S, STRIKE_BEAT_S, duelCut, strikeAt } from "./finisher-plan";

describe("duelCut", () => {
  it("plays short effects at normal speed", () => {
    expect(duelCut(2.5)).toEqual({ timeScale: 1, length: 2.5 });
  });
  it("compresses long effects into MAX_CUT_S", () => {
    const { timeScale, length } = duelCut(6.4);
    expect(length).toBe(MAX_CUT_S);
    expect(timeScale * length).toBeCloseTo(6.4);
  });
  it("handles a missing duration", () => {
    expect(duelCut(undefined)).toEqual({ timeScale: 1, length: 0 });
  });
});

describe("strikeAt", () => {
  it("strikes on the beat", () => {
    expect(strikeAt(MAX_CUT_S)).toBe(STRIKE_BEAT_S);
  });
  it("strikes before a very short cut ends", () => {
    expect(strikeAt(1)).toBeCloseTo(0.8);
    expect(strikeAt(0)).toBe(0);
  });
});

describe("FinisherQueue", () => {
  it("plays immediately when idle", () => {
    const q = new FinisherQueue();
    expect(q.request("a", 0, 3)).toBe("play");
  });
  it("queues a second finisher and starts it when the first ends", () => {
    const q = new FinisherQueue();
    q.request("a", 0, 1);
    expect(q.request("b", 0.5, 1)).toBe("wait");
    expect(q.tick(0.9)).toEqual({ start: null, expired: [] });
    expect(q.tick(1.0)).toEqual({ start: "b", expired: [] });
    // b now owns the stage until 2.0
    expect(q.request("c", 1.5, 1)).toBe("wait");
  });
  it("turns a finisher that waited too long into strike-only", () => {
    const q = new FinisherQueue();
    q.request("a", 0, 3);
    q.request("b", 0.2, 3);
    expect(q.tick(0.2 + MAX_WAIT_S + 0.01)).toEqual({ start: null, expired: ["b"] });
    expect(q.tick(3)).toEqual({ start: null, expired: [] });
  });
  it("keeps order: an earlier waiter is not skipped by a later request", () => {
    const q = new FinisherQueue();
    q.request("a", 0, 1);
    q.request("b", 0.1, 1);
    expect(q.request("c", 1.05, 1)).toBe("wait"); // b is still waiting
    expect(q.tick(1.05).start).toBe("b");
  });
  it("cancel() removes only a waiting item", () => {
    const q = new FinisherQueue();
    q.request("a", 0, 3);
    q.request("b", 0, 3);
    expect(q.cancel("a")).toBe(false); // playing, not waiting
    expect(q.cancel("b")).toBe(true);
    expect(q.cancel("b")).toBe(false);
    expect(q.tick(3.1)).toEqual({ start: null, expired: [] });
  });
  it("release() frees the stage early so the next one starts at once", () => {
    const q = new FinisherQueue();
    q.request("a", 0, 3);
    expect(q.request("b", 0.5, 3)).toBe("wait");
    q.release(1);
    expect(q.tick(1).start).toBe("b");
  });
  it("clear() frees the stage", () => {
    const q = new FinisherQueue();
    q.request("a", 0, 3);
    q.request("b", 0, 3);
    q.clear();
    expect(q.request("c", 0.1, 3)).toBe("play");
  });
});
