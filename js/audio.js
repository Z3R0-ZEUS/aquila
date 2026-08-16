/** Tiny Web Audio synth — no sample files required. */

let ctx = null;
let muted = false;
let master = null;
let started = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  started = true;
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = !!v;
  if (master) master.gain.value = muted ? 0 : 0.22;
}

export function toggleMute() {
  setMuted(!muted);
  return muted;
}

export function unlock() {
  ac();
}

function env(gain, t, a = 0.01, d = 0.2, peak = 0.4) {
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(freq, dur, type = 'triangle', peak = 0.25, atk = 0.01) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  env(g, t, atk, dur, peak);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, peak = 0.2, filterFreq = 1200) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const n = c.createBufferSource();
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  n.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(filterFreq, t);
  const g = c.createGain();
  env(g, t, 0.005, dur, peak);
  n.connect(f);
  f.connect(g);
  g.connect(master);
  n.start(t);
  n.stop(t + dur + 0.02);
}

export const sfx = {
  click() {
    tone(880, 0.06, 'square', 0.08, 0.002);
  },
  select() {
    tone(420, 0.08, 'triangle', 0.12);
    tone(640, 0.1, 'sine', 0.06);
  },
  move() {
    noise(0.12, 0.12, 700);
    tone(180, 0.1, 'sine', 0.06);
  },
  melee() {
    noise(0.16, 0.28, 1800);
    tone(140, 0.14, 'sawtooth', 0.16);
    setTimeout(() => tone(90, 0.18, 'triangle', 0.12), 40);
  },
  missile() {
    tone(980, 0.08, 'square', 0.08);
    tone(640, 0.16, 'triangle', 0.07);
    setTimeout(() => noise(0.1, 0.14, 2400), 80);
  },
  impact() {
    noise(0.18, 0.22, 900);
    tone(70, 0.2, 'sine', 0.18);
  },
  death() {
    tone(220, 0.35, 'sawtooth', 0.14);
    tone(110, 0.45, 'triangle', 0.12);
    noise(0.3, 0.16, 500);
  },
  rout() {
    tone(300, 0.2, 'triangle', 0.1);
    tone(180, 0.28, 'sine', 0.08);
  },
  endTurn() {
    tone(330, 0.1, 'triangle', 0.1);
    setTimeout(() => tone(250, 0.14, 'sine', 0.08), 80);
  },
  victory() {
    tone(392, 0.18, 'triangle', 0.14);
    setTimeout(() => tone(523, 0.22, 'triangle', 0.14), 120);
    setTimeout(() => tone(659, 0.35, 'sine', 0.12), 240);
  },
  defeat() {
    tone(196, 0.3, 'sine', 0.14);
    setTimeout(() => tone(147, 0.45, 'triangle', 0.12), 160);
  },
  ui() {
    tone(520, 0.05, 'sine', 0.07);
  },
};

export function combatSound(missile, result) {
  if (missile) sfx.missile();
  else sfx.melee();
  setTimeout(() => sfx.impact(), 160);
  if (result?.defenderDead || result?.attackerDead) setTimeout(() => sfx.death(), 280);
  else if (result?.retreat) setTimeout(() => sfx.rout(), 280);
}
