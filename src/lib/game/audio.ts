/** Lightweight WebAudio SFX — all synthesized, zero assets, zero latency. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let sfxVol = 0.8;   // 0..1 user setting (SFX)
let musicVol = 0.7; // 0..1 user setting (music)

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.32;
}
export const isMuted = () => muted;
/** Apply the two user volume sliders (0..1 each). */
export function setVolumes(sfx01: number, music01: number) {
  sfxVol = Math.max(0, Math.min(1, sfx01));
  musicVol = Math.max(0, Math.min(1, music01));
}
export const primeAudio = () => void ac();

function tone(freq: number, dur: number, type: OscillatorType, vol = 0.5, slideTo?: number, delay = 0, isMusic = false) {
  const c = ac();
  if (!c || !master || muted) return;
  const v = vol * (isMusic ? musicVol : sfxVol) * 2.2; // scale 0..1 sliders into tone range
  if (v <= 0.001) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur: number, vol = 0.25, hp = 400, delay = 0, isMusic = false) {
  const c = ac();
  if (!c || !master || muted) return;
  const v = vol * (isMusic ? musicVol : sfxVol) * 2.2;
  if (v <= 0.001) return;
  const t0 = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = v;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  pickup: () => { tone(660, 0.09, "triangle", 0.4); tone(880, 0.12, "triangle", 0.35, undefined, 0.06); },
  eat: () => { tone(520, 0.08, "square", 0.22); tone(392, 0.1, "square", 0.2, undefined, 0.07); },
  deliver: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.4, undefined, i * 0.07)),
  jump: () => tone(300, 0.18, "sine", 0.3, 620),
  jump2: () => { tone(430, 0.16, "sine", 0.3, 900); tone(620, 0.1, "triangle", 0.18, 980, 0.05); }, // double-jump whoosh
  land: () => noise(0.08, 0.14, 900),
  caught: () => { tone(392, 0.3, "sawtooth", 0.3, 180); tone(311, 0.4, "sawtooth", 0.25, 140, 0.15); },
  bonk: () => { tone(196, 0.16, "square", 0.4, 98); tone(311, 0.1, "triangle", 0.22, undefined, 0.05); noise(0.06, 0.12, 700); }, // car clonk + dizzy wobble
  rescue: () => [659, 784, 988].forEach((f, i) => tone(f, 0.14, "sine", 0.4, undefined, i * 0.08)),
  zombie: () => tone(140 + Math.random() * 40, 0.5, "sawtooth", 0.16, 90),
  alert: () => tone(740, 0.1, "square", 0.22, 988),
  siren: () => { tone(620, 0.26, "square", 0.15, 900); tone(900, 0.26, "square", 0.15, 620, 0.26); tone(620, 0.3, "square", 0.12, 900, 0.52); },
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, "triangle", 0.42, undefined, i * 0.12)),
  lose: () => [400, 340, 280, 220].forEach((f, i) => tone(f, 0.28, "sawtooth", 0.25, undefined, i * 0.16)),
  click: () => tone(700, 0.05, "triangle", 0.25),
  star: () => tone(1200, 0.2, "sine", 0.3, 400),
  // rare super-power fanfare — sparkly ascending arpeggio
  power: () => [523, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, "triangle", 0.38, undefined, i * 0.06)),
  // teleport poof — quick rising-then-vanishing whoosh
  blink: () => { tone(980, 0.14, "sine", 0.3, 240); noise(0.1, 0.16, 1400); },
  // animal morph — silly downward wobble (you now go "moo")
  morph: () => { tone(520, 0.22, "square", 0.22, 180); tone(300, 0.28, "sawtooth", 0.18, 140, 0.16); },
  // car engine start — a happy cartoon vroom-vroom
  engine: () => { tone(70, 0.55, "sawtooth", 0.34, 210); tone(105, 0.4, "square", 0.14, 260, 0.12); noise(0.3, 0.1, 320); },
  // friendly double-beep horn (press H while driving)
  horn: () => { tone(466, 0.16, "square", 0.26); tone(466, 0.2, "square", 0.22, undefined, 0.2); },
  // little car-door clunk when hopping in/out
  door: () => { tone(180, 0.08, "square", 0.3, 120); noise(0.05, 0.12, 500); },
};

/* ------- generative ambient music (super light) ------- */
let musicTimer: ReturnType<typeof setInterval> | null = null;
let step = 0;
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const ROOTS = [262, 220, 294, 196];

export function startMusic() {
  const c = ac();
  if (!c || musicTimer) return;
  musicTimer = setInterval(() => {
    if (muted || document.hidden || musicVol <= 0.001) return;
    const bar = Math.floor(step / 8) % 4;
    const root = ROOTS[bar];
    if (step % 8 === 0) tone(root / 2, 0.5, "sine", 0.16, undefined, 0, true);
    if (step % 2 === 0) {
      const n = root * Math.pow(2, SCALE[(step * 3 + bar) % SCALE.length] / 12);
      tone(n, 0.22, "triangle", 0.07, undefined, 0, true);
    }
    if (step % 4 === 2) noise(0.03, 0.04, 3000, 0, true);
    step = (step + 1) % 32;
  }, 260);
}

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}
