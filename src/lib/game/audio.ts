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
  // 🎲 SFX variation (audio-design: kill the "machine gun" repeat) — every sound
  // EFFECT is detuned ±3% per hit so rapid-fire repeats (claws, zombies, pickups)
  // never buzz identically. Music tones stay pinned to their pitch grid.
  const det = isMusic ? 1 : 1 + (Math.random() - 0.5) * 0.06;
  const f = freq * det;
  const v = vol * (isMusic ? musicVol : sfxVol) * 2.2; // scale 0..1 sliders into tone range
  if (v <= 0.001) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo * det), t0 + dur);
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

  /* ------- 7 Nights — horror set ------- */
  // axe bites wood
  chop: () => { tone(180, 0.07, "square", 0.4, 90); noise(0.06, 0.28, 900); },
  // hammer smashes stone
  smash: () => { tone(120, 0.09, "square", 0.45, 60); noise(0.09, 0.3, 500); tone(300, 0.05, "triangle", 0.2, undefined, 0.04); },
  // building hammering — two quick knocks
  build: () => { tone(220, 0.06, "square", 0.32, 140); noise(0.05, 0.2, 700); tone(220, 0.06, "square", 0.3, 140, 0.14); noise(0.05, 0.18, 700, 0.14); },
  // a weapon swings through air
  swing: () => noise(0.1, 0.14, 1300),
  // blade/claw connects
  stab: () => { tone(260, 0.08, "sawtooth", 0.34, 110); noise(0.07, 0.22, 800); },
  // long distant wolf howl at dusk
  howl: () => { tone(240, 0.9, "sine", 0.24, 400); tone(380, 0.8, "sine", 0.14, 240, 0.35); noise(0.7, 0.05, 300, 0.1); },
  // dissonant possession sting — the spirit picks its host
  possess: () => { tone(140, 0.7, "sawtooth", 0.22, 70); tone(147, 0.7, "sawtooth", 0.18, 66); tone(520, 0.5, "square", 0.1, 90, 0.1); },
  // a survivor's dying scream
  scream: () => { tone(880, 0.34, "sawtooth", 0.3, 420); tone(660, 0.4, "triangle", 0.2, 220, 0.12); },
  // double thump — heartbeat when the beast is near
  heart: () => { tone(58, 0.1, "sine", 0.5, 44); tone(52, 0.12, "sine", 0.42, 40, 0.16); },
  // low guttural beast growl
  groan: () => { tone(96, 0.6, "sawtooth", 0.2, 62); noise(0.5, 0.08, 220, 0.05); },
  // happy double woof — a stray says hello
  bark: () => { tone(300, 0.09, "sawtooth", 0.3, 165); noise(0.05, 0.1, 600); tone(265, 0.11, "sawtooth", 0.26, 150, 0.13); noise(0.06, 0.08, 520, 0.13); },
  // hurt-dog yelp — sharp, high, falling
  whine: () => { tone(760, 0.2, "sine", 0.28, 360); tone(1020, 0.13, "triangle", 0.12, 540, 0.05); },
  // 🧟 zombie hound — low snarling rumble with a wet rasp
  zdog: () => { tone(88, 0.7, "sawtooth", 0.24, 56); tone(126, 0.5, "square", 0.09, 72, 0.1); noise(0.55, 0.11, 240, 0.08); },
  // dawn bell — relief
  bell: () => { tone(660, 0.7, "sine", 0.3, 659); tone(990, 0.5, "sine", 0.12, undefined, 0.02); },
  /* ------- 🌲 deep-jungle night — the scary set ------- */
  // owl — the classic two-note "hoo-HOO" drifting through the trees
  owl: () => { tone(486, 0.28, "sine", 0.16, 442); tone(418, 0.5, "sine", 0.18, 396, 0.34); noise(0.5, 0.014, 900, 0.3); },
  // distant big-cat growl — a low rolling rumble that makes you stop walking
  growl: () => { tone(82, 1.1, "sawtooth", 0.17, 58); tone(110, 0.9, "square", 0.05, 74, 0.12); noise(1.0, 0.07, 180, 0.05); },
  // twig snap — something just stepped on a branch behind you
  snap: () => { noise(0.045, 0.3, 1500); tone(1900, 0.03, "square", 0.1, 700); },
  // crow caw — two harsh flat rasps
  caw: () => { tone(620, 0.14, "sawtooth", 0.14, 480); tone(575, 0.18, "sawtooth", 0.12, 430, 0.2); },
  // wolf howl — long rising-falling glide, very different from the zombie wail
  wolfHowl: () => { tone(294, 0.5, "sine", 0.15, 523); tone(523, 1.1, "sine", 0.15, 349, 0.5); tone(349, 0.5, "sine", 0.08, 294, 1.5); noise(1.6, 0.02, 600, 0.3); },
  // spectral chime — the ghost stag fades from sight
  chime: () => { [1244, 1568, 1976].forEach((f, i) => tone(f, 0.8, "sine", 0.07, f * 0.985, i * 0.09, true)); noise(0.6, 0.015, 3000, 0.1); },
  // angry crowd drags the accused away
  mob: () => { tone(200, 0.3, "sawtooth", 0.2, 260); noise(0.35, 0.16, 400, 0.05); tone(180, 0.3, "square", 0.14, 240, 0.18); },
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

/* ------- 7 Nights: the night drone — low detuned dread + wind ------- */
let droneTimer: ReturnType<typeof setInterval> | null = null;
let droneStep = 0;

/** Start the creepy night ambience (call at dusk/night, stop at dawn). */
export function startDrone() {
  const c = ac();
  if (!c || droneTimer) return;
  droneTimer = setInterval(() => {
    if (muted || document.hidden || musicVol <= 0.001) return;
    // slow breathing low drone
    if (droneStep % 6 === 0) tone(55 + (droneStep % 12 === 0 ? 3 : 0), 1.6, "sine", 0.2, 48, 0, true);
    if (droneStep % 6 === 3) tone(58, 1.4, "triangle", 0.12, 44, 0, true);
    // gusts of wind
    if (droneStep % 4 === 2) noise(1.1, 0.05 + (droneStep % 8 === 2 ? 0.03 : 0), 240, 0, true);
    // distant shriek, rare
    if (droneStep % 16 === 13) tone(1244, 0.5, "sine", 0.05, 620, 0, true);
    droneStep = (droneStep + 1) % 32;
  }, 700);
}

export function stopDrone() {
  if (droneTimer) { clearInterval(droneTimer); droneTimer = null; }
}

/* ------- 🦗 jungle insect ambience — crickets, cicadas & beetles -------
 * Original-sound synthesis, zero assets: crickets chirp with the classic
 * 3-5 pulse trains around 4 kHz, cicadas buzz in swelling waves with a
 * wobble, beetles bumble past low and slow. The engine calls setInsects()
 * every frame with an intensity from (player zone × story hour) — the
 * chorus breathes louder at night, fades to lone daytime chirps, and
 * stops entirely outside the jungle.                                        */
let insectTimer: ReturnType<typeof setInterval> | null = null;
let insectLvl = 0;      // smoothed 0..1.15 intensity
let insectTarget = 0;
let insectStep = 0;
let cicadaLeft = 0;     // seconds left in the current cicada wave

/** Drive the jungle insect chorus (0 = silent/off, 1 = full night band). */
export function setInsects(intensity01: number) {
  insectTarget = Math.max(0, Math.min(1.15, intensity01));
  if (insectTimer || insectTarget <= 0) return;
  if (!ac()) return;
  insectTimer = setInterval(insectTick, 130);
}

export function stopInsects() {
  insectTarget = 0; insectLvl = 0; cicadaLeft = 0;
  if (insectTimer) { clearInterval(insectTimer); insectTimer = null; }
}

function insectTick() {
  if (muted || document.hidden || musicVol <= 0.001) return;
  insectLvl += (insectTarget - insectLvl) * 0.12;
  if (insectLvl < 0.015) {
    if (insectTarget <= 0 && insectTimer) { clearInterval(insectTimer); insectTimer = null; }
    return;
  }
  insectStep++;
  // 🦗 crickets — the signature night sound: rapid pulse-train chirps.
  // Each chirp is 3-5 short pulses ~40 ms apart near 3.9-4.8 kHz.
  if (Math.random() < 0.15 + insectLvl * 0.5) {
    const base = 3900 + Math.random() * 900;
    const pulses = 3 + Math.floor(Math.random() * 3);
    const v = 0.045 + insectLvl * 0.05;
    for (let i = 0; i < pulses; i++) tone(base, 0.034, "sine", v, undefined, i * 0.042, true);
    // an answering cricket, a little lower and later
    if (Math.random() < 0.45) {
      const b2 = base * (0.82 + Math.random() * 0.12);
      for (let i = 0; i < pulses; i++) tone(b2, 0.03, "sine", v * 0.8, undefined, 0.5 + Math.random() * 0.4 + i * 0.044, true);
    }
  }
  // 🪰 cicadas — long buzzing waves that swell and fade with a wobble
  if (cicadaLeft <= 0 && insectLvl > 0.4 && Math.random() < 0.045 + insectLvl * 0.09) cicadaLeft = 1.8 + Math.random() * 2.4;
  if (cicadaLeft > 0) {
    cicadaLeft -= 0.13;
    if (insectStep % 2 === 0) {
      const f = 5400 + Math.sin(insectStep * 0.7) * 380 + Math.random() * 120;
      const swell = Math.sin((1.8 + 2.4 - Math.max(0, cicadaLeft)) * 1.6); // breathe in & out
      tone(f, 0.27, "sawtooth", (0.018 + insectLvl * 0.028) * Math.max(0.25, swell), f + 140, 0, true);
    }
  }
  // 🪲 beetle fly-by — a fat low bumble drifting past (mostly daylight)
  if (Math.random() < 0.012 + (1 - insectLvl) * 0.011) {
    tone(190 + Math.random() * 70, 0.9, "sawtooth", 0.03, 150 + Math.random() * 90, 0, true);
  }
}
