// Kabuki-style UI sounds, as in the Ultimate Ninja Storm menus: hyoshigi
// (hardwood clappers) when the cursor moves, kotsuzumi (shoulder drum)
// "pon" on confirm. Hyoshigi is a recorded strike with a synthesized wood
// ring on top; the tsuzumi is synthesized. Game moments use short clips cut
// from freely licensed recordings (koto, singing bowl, taiko — see
// public/sfx/CREDITS.md). Everything has procedural fallbacks while clips
// load, and shares a small-hall reverb.
//
// Browsers keep audio locked until the first user gesture, so sounds before
// the first click/key are silently skipped.

const MUTE_KEY = "shinobi-sfx-muted";

// Miyako-bushi ("In") scale on D: D Eb G A Bb.
const SCALE = [293.66, 311.13, 392.0, 440.0, 466.16];
const note = (degree, octave = 0) => {
  const i = ((degree % SCALE.length) + SCALE.length) % SCALE.length;
  const oct = octave + Math.floor(degree / SCALE.length);
  return SCALE[i] * 2 ** oct;
};

let ctx = null;
let master = null;
let wet = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  // storage blocked: default to sound on
}

function reverbImpulse(ac, seconds = 2.4) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const verb = ctx.createConvolver();
    verb.buffer = reverbImpulse(ctx);
    wet = ctx.createGain();
    wet.gain.value = 0.28;
    wet.connect(verb).connect(master);
    loadSamples();
  }
  if (ctx.state !== "running") return null;
  return ctx;
}

// Unlock on the first gesture (autoplay policy).
function unlock() {
  audio();
  ctx?.resume();
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

// Route a node to dry + reverb.
function out(node, reverb = 1) {
  node.connect(master);
  if (reverb > 0) {
    const send = ctx.createGain();
    send.gain.value = reverb;
    node.connect(send).connect(wet);
  }
}

// Karplus-Strong plucked string, rendered once per pitch and cached.
const plucks = new Map();
function pluckBuffer(freq, seconds = 1.4, brightness = 0.5) {
  const key = `${freq.toFixed(2)}:${brightness}`;
  if (plucks.has(key)) return plucks.get(key);
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const period = Math.max(2, Math.round(sr / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  // Each pass through the delay line low-passes the string a little: the
  // blend sets brightness, the decay how long it rings.
  const decay = 0.996;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const next = ring[(idx + 1) % period];
    d[i] = cur;
    ring[idx] = (cur * (1 - brightness) + next * brightness) * decay;
    idx = (idx + 1) % period;
  }
  plucks.set(key, buf);
  return buf;
}

function pluck(freq, { when = 0, gain = 0.35, length = 1.2, reverb = 0.8 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(freq, length);
  const g = ctx.createGain();
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  // A little bite at the attack, like a plectrum (tsume).
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 120;
  src.connect(hp).connect(g);
  out(g, reverb);
  src.start(t);
  src.stop(t + length);
}

function noiseBurst({ when = 0, duration = 0.05, freq = 2000, q = 6, gain = 0.4, type = "bandpass", reverb = 0.4 }) {
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g);
  out(g, reverb);
  src.start(ctx.currentTime + when);
}

function tone(freq, { when = 0, attack = 0.005, decay = 1, gain = 0.2, type = "sine", endFreq, glide, reverb = 0.6 }) {
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + (glide ?? Math.min(decay, 0.25)));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  osc.connect(g);
  out(g, reverb);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

// ---- recorded clips -------------------------------------------------------

const SAMPLE_NAMES = ["hyoshigi", "pluck", "bowl", "taiko"];
const samples = {};

function loadSamples() {
  const base = `${import.meta.env.BASE_URL}sfx/`;
  for (const name of SAMPLE_NAMES) {
    fetch(`${base}${name}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        samples[name] = buf;
      })
      .catch(() => {
        // keep using the synthesized fallback for this sound
      });
  }
}

// Play a loaded clip; returns false if it isn't available yet.
function sample(name, { when = 0, gain = 1, rate = 1, reverb = 0.5 } = {}) {
  const buf = samples[name];
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  out(g, reverb);
  src.start(ctx.currentTime + when);
  return true;
}

// Pitch ratio of an In-scale degree relative to the root, for re-pitching
// a recorded pluck into a melody.
const ratio = (degree) => note(degree) / note(0);

// Band-passed noise whose center frequency sweeps — a swish.
function noiseSweep({ when = 0, from = 500, to = 2500, duration = 0.2, gain = 0.15, reverb = 0.3 }) {
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  const t = ctx.currentTime + when;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + duration);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g);
  out(g, reverb);
  src.start(t);
}

// Hyoshigi: the recorded clack (if loaded) plus the clean ring of hardwood —
// a free bar's inharmonic modes (1 : 2.76 : 5.4) around its ~1.95 kHz peak.
function hyoshigi({ rate = 1, gain = 1 } = {}) {
  const f = 1950 * rate;
  const recorded = sample("hyoshigi", { gain: 0.6 * gain, rate, reverb: 0.4 });
  tone(f, { attack: 0.001, decay: 0.13, gain: (recorded ? 0.07 : 0.16) * gain, reverb: 0.45 });
  tone(f * 2.76, { attack: 0.001, decay: 0.05, gain: (recorded ? 0.025 : 0.06) * gain, reverb: 0.3 });
  tone(f * 5.4, { attack: 0.001, decay: 0.02, gain: 0.015 * gain, reverb: 0.2 });
  if (!recorded) noiseBurst({ duration: 0.008, freq: 4000, q: 1, gain: 0.3 * gain, reverb: 0.2 });
}

// Kotsuzumi "pon": a finger-struck hourglass drum. The player eases the ropes
// right after the strike, so the head's pitch drops; inharmonic membrane
// modes die fast over the resonant fundamental, the hollow wooden body adds
// an "o" formant, and the fingers slap the skin.
function tsuzumi({ pitch = 1, gain = 1, length = 0.65, reverb = 0.6 } = {}) {
  const f0 = 400 * pitch;
  tone(f0 * 1.32, { attack: 0.002, decay: length, gain: 0.42 * gain, endFreq: f0, glide: 0.07, reverb });
  for (const [r, g, d] of [
    [1.59, 0.14, 0.18],
    [2.14, 0.08, 0.12],
    [2.65, 0.05, 0.08],
    [3.5, 0.03, 0.05],
  ]) {
    tone(f0 * 1.32 * r, { attack: 0.001, decay: d, gain: g * gain, endFreq: f0 * r, glide: 0.06, reverb: reverb * 0.6 });
  }
  noiseBurst({ duration: 0.09, freq: 800, q: 3, gain: 0.18 * gain, reverb });
  noiseBurst({ duration: 0.012, freq: 3200, q: 1, gain: 0.25 * gain, reverb: 0.2 });
}

// Throttle so sweeping the mouse across a list doesn't machine-gun.
let lastHover = 0;

function play(fn) {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  fn();
}

export const sfx = {
  // Cursor moves: one hyoshigi clack, very slightly varied so repeated
  // moves don't sound copy-pasted.
  hover() {
    const now = performance.now();
    if (now - lastHover < 50) return;
    lastHover = now;
    play(() => hyoshigi({ rate: 0.98 + Math.random() * 0.05, gain: 0.8 }));
  },

  // Confirm: tsuzumi "pon".
  select() {
    play(() => tsuzumi());
  },

  // Back / cancel: a lower, drier, shorter tsuzumi stroke.
  back() {
    play(() => tsuzumi({ pitch: 0.8, gain: 0.75, length: 0.35, reverb: 0.4 }));
  },

  // Panel slides in: a soft airy swish.
  open() {
    play(() => noiseSweep({ from: 500, to: 2600, duration: 0.22, gain: 0.12 }));
  },

  // Big reveal (your shinobi, jutsu result): a full, ringing tsuzumi with a
  // koto pluck blooming out of it.
  reveal() {
    play(() => {
      tsuzumi({ pitch: 0.9, gain: 1.1, length: 0.9, reverb: 0.8 });
      if (!sample("pluck", { when: 0.08, gain: 0.5, reverb: 0.6 })) pluck(note(0, 1), { when: 0.08, gain: 0.25, length: 1.2 });
    });
  },

  // Countdown / impacts: a heavier, lower hyoshigi strike, like the
  // clapper beats that drive a kabuki scene.
  tick() {
    play(() => hyoshigi({ rate: 0.82, gain: 1.1 }));
  },

  // Koto climbing the In scale with each completed sign, over a soft bowl.
  seal(step = 0) {
    play(() => {
      if (sample("pluck", { gain: 0.7, rate: ratio(step), reverb: 0.6 })) {
        sample("pluck", { when: 0.05, gain: 0.45, rate: ratio(step + 2), reverb: 0.6 });
        sample("bowl", { gain: 0.25, rate: ratio(step) * 2, reverb: 0.4 });
        return;
      }
      pluck(note(step, 1), { gain: 0.3, length: 1.6 });
      pluck(note(step + 2, 1), { when: 0.03, gain: 0.22, length: 1.6 });
      pluck(note(step, 2), { when: 0.06, gain: 0.14, length: 1.4 });
    });
  },

  // Recorded taiko hit with a synthesized sub-boom under it for weight
  // (the recording is a fast roll, so its tail is short).
  taiko() {
    play(() => {
      const recorded = sample("taiko", { gain: 0.9, reverb: 0.6 });
      tone(90, { attack: 0.003, decay: 0.7, gain: recorded ? 0.5 : 0.9, endFreq: 45, reverb: 0.7 });
      if (recorded) return;
      tone(190, { attack: 0.003, decay: 0.18, gain: 0.25, endFreq: 110, reverb: 0.4 });
      noiseBurst({ duration: 0.15, freq: 500, q: 0.8, type: "lowpass", gain: 0.6, reverb: 0.6 });
    });
  },

  // Smoke "poof" of a clone or summon: an airy downward whoosh.
  poof(gain = 1) {
    play(() => {
      noiseSweep({ from: 2400, to: 300, duration: 0.35, gain: 0.25 * gain, reverb: 0.5 });
      noiseBurst({ duration: 0.18, freq: 900, q: 0.6, type: "lowpass", gain: 0.3 * gain, reverb: 0.4 });
    });
  },

  // Claw slash: a fast bright rip.
  slash() {
    play(() => noiseSweep({ from: 1500, to: 6000, duration: 0.12, gain: 0.3, reverb: 0.3 }));
  },

  // Explosion: a low noise blast over a falling sub thump.
  boom(gain = 1) {
    play(() => {
      noiseBurst({ duration: 0.6, freq: 380, q: 0.6, type: "lowpass", gain: 0.8 * gain, reverb: 0.7 });
      tone(70, { attack: 0.004, decay: 0.8, gain: 0.7 * gain, endFreq: 32, glide: 0.5, reverb: 0.6 });
    });
  },

  get muted() {
    return muted;
  },

  setMuted(value) {
    muted = value;
    try {
      localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch {
      // storage blocked: mute lasts for this page only
    }
  },
};
