/**
 * 🎬 Polyfork clip library — the REAL action set for the shared skeleton.
 *
 * Every Polyfork humanoid ships the same 22-joint Mixamo-named skeleton, and
 * Polyfork publishes its full action catalog (Quaternius' Universal Animation
 * Library, CC0, retargeted to that skeleton) as per-clip JSON on its CDN —
 * the same files the action dropdown on every polyfork.dev asset page plays.
 * The needed 21 clips are fetched into `public/models/clips/` by
 * scripts/fetch-clips.mjs (CC BY 4.0 / CC0 credited in the graveyard kit),
 * so at runtime the game serves them from its own origin — no polyfork.dev
 * dependency, no CORS surprise.
 *
 * Each clip JSON carries: `times` (keyframe seconds), `tracks` (bone name →
 * packed bone-LOCAL quaternions), `hips` (packed Hips position offsets baked
 * at a 0.95 m hip height). `toClip()` — a faithful port of Polyfork's own
 * /cdn/clips.mjs — binds those onto a GlbInstance's bones BY UUID (a name
 * could catch a mesh instead of the bone), scales the hips to the character's
 * own height and plays IN PLACE (x/z travel zeroed — the engine moves bodies).
 *
 * On top of the raw clips sits the ACTIVITY layer the game poses through:
 * one activity clip may own a body at a time (jump / punch / sword slash /
 * knockback / get-up …). While it holds the body its weight eases to 1 and
 * the locomotion trio (Idle/Walk/Run) is damped to 0; when a one-shot ends
 * the weight eases back and locomotion resumes. Every request degrades
 * gracefully: a clip that hasn't streamed (or failed) returns false and the
 * caller keeps its procedural overlay — the game never blocks on a clip.
 */

import * as THREE from "three";
import type { GlbInstance } from "./glbCharacters";

/* ---------------- the clip catalog the game consumes ---------------- */

export const CLIPS = {
  jumpStart: "Jump start",
  jumpAir: "Jump in air",
  flipStart: "Flip jump start",
  flipAir: "Flip jump in air",
  flipLand: "Flip jump land",
  punchJab: "Punch jab",
  punchCross: "Punch cross",
  hookPunch: "Hook punch",
  swordIdle: "Sword idle",
  swordAttack: "Sword attack",
  swordSlashA: "Sword slash A",
  swordSlashB: "Sword slash B",
  swordSlashC: "Sword slash C",
  swordCombo: "Sword combo",
  swordHeavy: "Sword heavy combo",
  swordDash: "Sword dash",
  swordBlock: "Sword block",
  pickUp: "Pick up",
  knockback: "Knockback",
  getUp: "Get up",
  zombieAttack: "Zombie attack",
  zombieIdle: "Zombie idle",
  zombieWalk: "Zombie walk",
  dance: "Dance",
  eating: "Eating",
} as const;

export type ClipName = (typeof CLIPS)[keyof typeof CLIPS];

/** Attack one-shot cycles — repeated hits alternate so combos never stutter.
 *  ⚔️ the sword cycle now rotates through SIX real attack types (straight
 *  chop, two slashes, the spinning combo and the heavy finisher) so repeated
 *  hits never look like the same swing twice. */
export const PUNCH_CYCLE: readonly string[] = [CLIPS.punchJab, CLIPS.punchCross, CLIPS.hookPunch];
export const SWORD_CYCLE: readonly string[] = [
  CLIPS.swordAttack, CLIPS.swordSlashA, CLIPS.swordSlashB,
  CLIPS.swordCombo, CLIPS.swordSlashC, CLIPS.swordHeavy,
];

/* ---------------- raw clip streaming (own origin, cached) ---------------- */

interface RawClip {
  times: number[];
  tracks: Record<string, number[]>;
  hips: number[];
}

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const rawCache = new Map<string, Promise<RawClip | null>>();

function fetchRaw(name: string): Promise<RawClip | null> {
  const hit = rawCache.get(name);
  if (hit) return hit;
  const p = fetch(`/models/clips/anim-${slugify(name)}.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<RawClip>) : null))
    .catch(() => null);
  rawCache.set(name, p);
  return p;
}

/* ---------------- per-instance clip building (Polyfork toClip port) -------- */

/** The hip height the clips were baked at, in metres (Polyfork's constant). */
const BAKED_HIP = 0.95;

/** name → bone map built from the LIVE skeleton (isBone only, by uuid in the
 *  tracks) — cached per instance in a WeakMap so clones never share it. */
const boneMaps = new WeakMap<GlbInstance, Record<string, THREE.Object3D>>();

function bonesOf(st: GlbInstance): Record<string, THREE.Object3D> {
  let map = boneMaps.get(st);
  if (map) return map;
  map = {};
  st.body.traverse((o) => {
    if ((o as THREE.Bone).isBone && o.name && !map[o.name]) map[o.name] = o;
  });
  boneMaps.set(st, map);
  return map;
}

/** Build a THREE.AnimationClip bound to THIS instance's skeleton — Polyfork's
 *  toClip(): one QuaternionKeyframeTrack per bone (by uuid), plus a Hips
 *  position track scaled to the character's own hip height, played in place
 *  (x/z travel zeroed — the game moves its own characters). */
function toClip(raw: RawClip, name: string, st: GlbInstance): THREE.AnimationClip | null {
  const bones = bonesOf(st);
  // the humanoid guard from clips.mjs — a body missing the core mixamo set
  // (shouldn't happen for any cast member) simply gets no clip
  if (!["Hips", "Spine2", "LeftForeArm", "RightUpLeg"].every((n) => bones[n])) return null;
  const hips = bones.Hips;
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, values] of Object.entries(raw.tracks)) {
    const b = bones[bone];
    if (!b || !values.length) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.uuid}.quaternion`, raw.times.slice(), Float32Array.from(values)));
  }
  // Hips offsets are baked at the 0.95 m reference — rescale to this body,
  // keep the rest position (a posed rig's restHips could differ later)
  const rest = st.hipsRest;
  const ratio = (rest.y || BAKED_HIP) / BAKED_HIP;
  const pos = new Float32Array(raw.hips.length);
  for (let i = 0; i < raw.hips.length; i += 3) {
    pos[i] = rest.x;                    // in place — no travel
    pos[i + 1] = rest.y + raw.hips[i + 1] * ratio;
    pos[i + 2] = rest.z;                // in place — no travel
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.uuid}.position`, raw.times.slice(), pos));
  return new THREE.AnimationClip(name, -1, tracks);
}

/** Built AnimationClips per instance (name → clip) — instances own their
 *  bindings, raw JSON is shared. A PENDING marker means the fetch is still in
 *  flight; a null slot means the clip failed to build (poisoned — the
 *  procedural overlay keeps that state forever instead of refetching). */
const PENDING = Symbol("clip-pending");
const builtClips = new WeakMap<GlbInstance, Map<string, THREE.AnimationClip | typeof PENDING | null>>();

function clipMap(st: GlbInstance): Map<string, THREE.AnimationClip | typeof PENDING | null> {
  let mine = builtClips.get(st);
  if (!mine) { mine = new Map(); builtClips.set(st, mine); }
  return mine as Map<string, THREE.AnimationClip | typeof PENDING | null>;
}

/** Kick the one-time fetch+build for a clip (idempotent). */
function requestClip(st: GlbInstance, name: string): void {
  const mine = clipMap(st);
  if (mine.has(name)) return;
  mine.set(name, PENDING);
  void fetchRaw(name).then((raw) => {
    if (!raw) { mine.set(name, null); return; } // poisoned — permanent fallback
    const clip = toClip(raw, name, st);
    mine.set(name, clip); // null poisons too (a body without the core bones)
  });
}

/* ---------------- the activity layer ---------------- */

interface ActState {
  /** clip owning the body right now (null = locomotion owns it) */
  name: string | null;
  /** eased weight of the activity clip (0..1) */
  w: number;
  /** seconds since the activity started */
  t: number;
  /** one-shot length in seconds (Infinity = loop until cleared) */
  dur: number;
  /** crossfade-in seconds */
  fade: number;
  /** combo cycle counter (punch jab → cross → hook, sword slashes) */
  cy: number;
  /** previous-frame inputs for rising-edge detection */
  last: { swing: number; attack: number; getup: number; air: boolean; flip: number; eat: boolean; hurt: boolean; pickup: boolean };
}

const actStates = new WeakMap<GlbInstance, ActState>();

function actOf(st: GlbInstance): ActState {
  let a = actStates.get(st);
  if (!a) {
    // "pickup" registered like the other edge keys — character.ts drives the
    // Pick up one-shot (CLIPS.pickUp) from glbEdge(st, "pickup", …) at line 808
    a = { name: null, w: 0, t: 0, dur: Infinity, fade: 0.14, cy: 0, last: { swing: 0, attack: 0, getup: 0, air: false, flip: 0, eat: false, hurt: false, pickup: false } };
    actStates.set(st, a);
  }
  return a;
}

/** True while `name` is the clip owning this body (weights still easing). */
export const glbActName = (st: GlbInstance): string | null => actOf(st).name;

/** True when the clip is built and playable on this instance right now. */
export function glbClipReady(st: GlbInstance, name: string): boolean {
  const c = clipMap(st).get(name);
  return !!c && c !== PENDING;
}

/** Synchronously warm the fetch (fire-and-forget) — call once at boot for the
 *  high-traffic clips so the first jump/attack already has its action. */
export function glbWarmClip(st: GlbInstance, name: string): void {
  requestClip(st, name);
}

/** Request an activity clip. No-op (returns true) when already playing it.
 *  Returns false when the clip isn't built yet — the fetch is kicked once and
 *  the caller keeps its procedural overlay until it lands (or forever, when
 *  the clip failed — the game never blocks on a clip). */
export function glbWantAct(st: GlbInstance, name: string, opts?: { loop?: boolean; fade?: number; dur?: number }): boolean {
  const a = actOf(st);
  if (a.name === name) return true;
  // 🚦 switch governor — a body may not change activities within 120 ms of
  // its last switch. Brawls retrigger every ~0.4–0.6 s (well inside), but
  // pathological rapid re-switching (dozens of bodies × overlapping timers)
  // is hard-capped regardless of cause.
  if (a.name && a.t < 0.12) return false;
  const mine = clipMap(st);
  requestClip(st, name); // idempotent — first call only
  const clip = mine.get(name);
  if (!clip || clip === PENDING) return false; // streaming or failed
  // ⛔️ hand the body over HARD: the previous activity's action is zeroed
  // immediately (its motion is replaced by this clip's fade-in — an abandoned
  // action left at weight would keep blending forever on top of everything)
  if (a.name) {
    const prev = st.actions[a.name];
    if (prev) prev.setEffectiveWeight(0);
  }
  const action = st.mixer.clipAction(clip);
  st.actions[name] = action;
  action.reset();
  action.setLoop(opts?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = opts?.loop === false;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(0);
  action.play();
  a.name = name;
  a.t = 0;
  a.dur = opts?.loop === false ? (opts.dur ?? clip.duration) : Infinity;
  a.fade = opts?.fade ?? 0.14;
  return true;
}

/** Release the body back to locomotion (weights ease through glbActUpdate). */
export function glbStopAct(st: GlbInstance): void {
  const a = actOf(st);
  if (a.name) {
    const cur = st.actions[a.name];
    if (cur) cur.setEffectiveWeight(0);
  }
  a.name = null;
}

/** Build + register clips as plain locomotion-grade actions (weight 0) — used
 *  for state-swapped locomotion (🧟 Zombie idle/walk replace Idle/Walk for
 *  the TURNED). Returns true only when EVERY name is playable; callers keep
 *  the stock trio until it is. */
export function glbEnsureClips(st: GlbInstance, names: readonly string[]): boolean {
  let ok = true;
  const mine = clipMap(st);
  for (const n of names) {
    requestClip(st, n);
    const clip = mine.get(n);
    if (!clip || clip === PENDING) { ok = false; continue; }
    if (!st.actions[n]) {
      const a = st.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.play();
      st.actions[n] = a;
    }
  }
  return ok;
}

/** Advance the combo cycle and return the next one-shot clip name. */
export function glbCycleNext(st: GlbInstance, cycle: readonly string[]): string {
  const a = actOf(st);
  const n = cycle[a.cy % cycle.length];
  a.cy++;
  return n;
}

/** Rising-edge helper over per-instance memory — true once per 0→nonzero
 *  transition of `key`. */
export function glbEdge(st: GlbInstance, key: keyof ActState["last"], cur: number | boolean): boolean {
  const a = actOf(st);
  const prev = a.last[key] as number | boolean;
  const next = cur as number | boolean;
  a.last[key] = next as never;
  const was = typeof next === "boolean" ? prev === false : (prev as number) <= 0.0001;
  const is = typeof next === "boolean" ? next === true : (next as number) > 0.0001;
  return was && is;
}

/** Per-frame activity weight easing + one-shot retirement. Returns the eased
 *  weight (0 = locomotion owns the body). Call ONCE per posed frame BEFORE
 *  setGlbLocomotion, which scales its own trio targets by (1 − this). */
export function glbActUpdate(st: GlbInstance, dt: number): number {
  const a = actOf(st);
  a.t += dt;
  if (a.name && a.t >= a.dur) {
    // one-shot finished — hand the body back to locomotion (weights ease)
    const done = st.actions[a.name];
    if (done) done.setEffectiveWeight(0);
    a.name = null;
  }
  if (a.name) {
    const act = st.actions[a.name];
    if (act) act.setEffectiveWeight(a.w);
  }
  const target = a.name ? 1 : 0;
  const rate = target > a.w ? 1 / Math.max(0.04, a.fade) : 9; // fade-in per clip, brisk release
  a.w += (target - a.w) * Math.min(1, dt * rate);
  if (a.w < 0.005 && !a.name) a.w = 0;
  return a.w;
}

/** How much locomotion should be damped this frame (1 = fully owned). */
export const glbActDamp = (st: GlbInstance): number => actOf(st).w;
