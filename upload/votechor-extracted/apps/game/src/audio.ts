import { toast } from "./store";
let ac: AudioContext | null = null;
const layers: Record<string, GainNode> = {};
let ambientT = 0, sirenT = 0, lastCap = "";

export function startAudio() {
  if (ac) return;
  try {
    ac = new AudioContext();
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type: BiquadFilterType, f: number, q = 1) => {
      const s = ac!.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = ac!.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ac!.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(ac!.destination); s.start(); return g;
    };
    layers.city = mk("lowpass", 420); layers.wind = mk("bandpass", 700, 0.5);
    layers.jungle = mk("bandpass", 3600, 5); layers.grave = mk("bandpass", 300, 3);
  } catch { ac = null; }
}
function tone(f: number, dur: number, vol: number, type: OscillatorType = "sine", f2?: number) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.linearRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g); g.connect(ac.destination); o.start(); o.stop(t + dur);
}
const caption = (s: string) => { if (s !== lastCap) { lastCap = s; toast(s); setTimeout(() => (lastCap = ""), 5000); } };
export const sfx = { pickup: () => tone(660, 0.15, 0.08, "triangle", 990), bump: () => tone(180, 0.18, 0.12, "square", 90) };

/** Zone-based ambience, cross-faded each frame, plus siren while wanted. */
export function updateAudio(zone: string, night: number, stars: number, dt: number) {
  if (!ac) return;
  const set = (k: string, v: number) => { layers[k].gain.value += (v - layers[k].gain.value) * 0.08; };
  set("city", zone === "City" ? 0.2 : 0.02);
  set("wind", (zone === "Mountain Wall" ? 0.25 : 0.05) + (zone === "Farmland" ? 0.06 : 0));
  set("jungle", zone === "Jungle" ? 0.07 : 0);
  set("grave", zone === "Graveyard" ? 0.18 : 0);
  ambientT += dt;
  if (ambientT > 0.5) {
    ambientT = 0;
    if (zone === "Jungle") {
      if (Math.random() < 0.5) {
        if (night > 0.5) { tone(4200, 0.05, 0.04, "square"); setTimeout(() => tone(4200, 0.05, 0.04, "square"), 90); }
        else tone(2000, 0.18, 0.05, "sine", 2800);
        if (Math.random() < 0.15) caption(night > 0.5 ? "[Crickets]" : "[Birdsong and insects]");
      }
      if (Math.random() < 0.08) { tone(420, 0.4, 0.07, "sawtooth", 220); caption("[A monkey objects loudly]"); }
    }
    if (zone === "Graveyard" && Math.random() < 0.2) { tone(140, 1.4, 0.08, "sine", 90); caption("[Distant howling]"); }
  }
  sirenT += dt;
  if (stars > 0 && sirenT > 0.45) { sirenT = 0; tone(((Date.now() / 450) | 0) % 2 ? 780 : 620, 0.22, 0.035, "square"); }
}
