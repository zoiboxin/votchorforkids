import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/* 🧍 Polyfork character cast — real rigged, animated low-poly humans  */
/*                                                                     */
/* The Polyfork catalog (polyfork.dev, CC BY 4.0 — credited in the     */
/* graveyard kit too) serves ~206 self-contained character GLBs: one   */
/* shared Mixamo-style skeleton, ~3–5k triangles, vertex colors (no    */
/* textures) and embedded "Idle" / "Walk" / "Run" clips in every file. */
/* Real-world scale (~1.7–1.8 m, feet at the origin, Y-up, +Z front).  */
/*                                                                     */
/* This module owns the CAST: a fixed pool of 12 townsfolk + 1 police  */
/* officer that the whole town shares. Files stream in on first play   */
/* (parallel download, sequential main-thread parse), then every body  */
/* is a SkeletonUtils.clone of the cached template — one shared        */
/* geometry set per character no matter how many souls wear it.        */
/* ------------------------------------------------------------------ */

export interface GlbCharacterDef {
  slug: string;
  name: string;
  emoji: string;
  url: string;
}

const cdn = (slug: string) => `https://polyfork.dev/cdn/${slug}.glb`;

/** The cast — kit-slugged Polyfork characters (verified slugs + sizes). */
export const GLB_CHARACTERS: readonly GlbCharacterDef[] = [
  { slug: "airline-pilot-63226a", name: "Airline Pilot", emoji: "✈️", url: cdn("airline-pilot-63226a") },
  { slug: "flight-attendant-befaf4", name: "Flight Attendant", emoji: "🛫", url: cdn("flight-attendant-befaf4") },
  { slug: "traveller-92f20c", name: "Traveller", emoji: "🎒", url: cdn("traveller-92f20c") },
  { slug: "baggage-handler-0823f5", name: "Baggage Handler", emoji: "🧳", url: cdn("baggage-handler-0823f5") },
  { slug: "ground-marshaller-8e8631", name: "Ground Marshaller", emoji: "🦺", url: cdn("ground-marshaller-8e8631") },
  { slug: "fuel-technician-df4ce0", name: "Fuel Technician", emoji: "⛽", url: cdn("fuel-technician-df4ce0") },
  { slug: "bellhop-053c4d", name: "Bellhop", emoji: "🛎️", url: cdn("bellhop-053c4d") },
  { slug: "blackjack-dealer-fc0ab1", name: "Blackjack Dealer", emoji: "🎰", url: cdn("blackjack-dealer-fc0ab1") },
  { slug: "lounge-bartender-9d425a", name: "Lounge Bartender", emoji: "🍹", url: cdn("lounge-bartender-9d425a") },
  { slug: "carving-chef-102bf5", name: "Carving Chef", emoji: "🔪", url: cdn("carving-chef-102bf5") },
  { slug: "pit-boss-234a94", name: "Pit Boss", emoji: "♠️", url: cdn("pit-boss-234a94") },
  { slug: "cocktail-server-eb211b", name: "Cocktail Server", emoji: "🍸", url: cdn("cocktail-server-eb211b") },
];

/** Police crew + officers wear the security officer — instantly recognizable. */
export const POLICE_CHAR = "airport-security-officer-8fd38a";
export const POLICE_CHAR_DEF: GlbCharacterDef = {
  slug: POLICE_CHAR, name: "Security Officer", emoji: "👮", url: cdn(POLICE_CHAR),
};

const ALL_CHARS: readonly GlbCharacterDef[] = [...GLB_CHARACTERS, POLICE_CHAR_DEF];

export const glbCharDef = (slug: string): GlbCharacterDef | undefined =>
  ALL_CHARS.find((c) => c.slug === slug);

/* ---------------- template loading (one shared rig per character) ---------------- */

/** The cartoon cast stands ~2.24 u tall (head top) — GLBs are scaled to match. */
const CHAR_TARGET_H = 2.24;

export interface GlbTemplate {
  slug: string;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** scale that brings this model to the cast height */
  unitScale: number;
  /** hip height in final (scaled) units — pivot for flips & leans */
  hip: number;
  /** named attachment socket for held tools */
  handBone: THREE.Object3D | null;
}

export interface GlbInstance {
  slug: string;
  body: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  cur: string;
  baseScale: number;
  hip: number;
  handBone: THREE.Object3D | null;
}

const loader = new GLTFLoader();
const templates = new Map<string, GlbTemplate>();
const pending = new Map<string, Promise<GlbTemplate>>();
const failed = new Set<string>();

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

/** React hook — re-renders whenever a new cast character finished loading. */
export function useGlbCharacters(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
  );
}

/** Synchronous template lookup — null while the file streams in. */
export const glbTemplate = (slug: string): GlbTemplate | undefined => templates.get(slug);

function measure(scene: THREE.Object3D): { h: number } {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  return { h: Math.max(0.01, box.max.y - box.min.y) };
}

/** Load (and cache) a cast character. Resolves from cache when ready. */
export function loadGlbTemplate(slug: string): Promise<GlbTemplate> {
  const tpl = templates.get(slug);
  if (tpl) return Promise.resolve(tpl);
  if (failed.has(slug)) return Promise.reject(new Error(`glb ${slug} failed earlier`));
  const inflight = pending.get(slug);
  if (inflight) return inflight;
  const def = glbCharDef(slug);
  const url = def?.url ?? cdn(slug);
  const p = new Promise<GlbTemplate>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const scene = gltf.scene;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = false;
            m.receiveShadow = false;
            m.frustumCulled = false;
          }
        });
        const { h } = measure(scene);
        const tpl2: GlbTemplate = {
          slug,
          scene,
          clips: gltf.animations ?? [],
          unitScale: CHAR_TARGET_H / h,
          hip: h * 0.52 * (CHAR_TARGET_H / h),
          handBone: scene.getObjectByName("attach-righthand") ?? null,
        };
        templates.set(slug, tpl2);
        pending.delete(slug);
        bump();
        resolve(tpl2);
      },
      undefined,
      (err) => {
        pending.delete(slug);
        failed.add(slug); // no retry hammering — the cartoon body stays
        bump();
        reject(err);
      },
    );
  });
  pending.set(slug, p);
  return p;
}

/** Build a poseable instance from a loaded template (null while loading/failed). */
export function makeGlbInstance(slug: string, ageScale: number): GlbInstance | null {
  const tpl = templates.get(slug);
  if (!tpl) return null;
  const scene = skeletonClone(tpl.scene);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
  const body = new THREE.Group();
  body.add(scene);
  const s = tpl.unitScale * ageScale;
  body.scale.setScalar(s);
  const mixer = new THREE.AnimationMixer(scene);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of tpl.clips) {
    if (clip.name === "Idle" || clip.name === "Walk" || clip.name === "Run") {
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(clip.name === "Idle" ? 1 : 0);
      actions[clip.name] = a;
    }
  }
  return {
    slug,
    body,
    mixer,
    actions,
    cur: actions.Idle ? "Idle" : "",
    baseScale: s,
    hip: tpl.hip * ageScale,
    handBone: scene.getObjectByName("attach-righthand") ?? null,
  };
}

/** Crossfade the live clip — cheap (two weight eases) and always smooth. */
export function crossToGlb(st: GlbInstance, name: string): void {
  if (st.cur === name) return;
  const next = st.actions[name];
  if (!next) return;
  next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
  const prev = st.actions[st.cur];
  if (prev) prev.fadeOut(0.18);
  st.cur = name;
}

/* ---------------- background preload ---------------- */

let preloadStarted = false;
/** Streams the whole cast in: downloads run in parallel, the main-thread
 *  GLB parses run one-by-one so frames stay smooth while files arrive. */
export function preloadGlbCharacters(): void {
  if (preloadStarted) return;
  preloadStarted = true;
  void (async () => {
    const todo = ALL_CHARS.filter((c) => !templates.has(c.slug));
    let bufs: ArrayBuffer[];
    try {
      bufs = await Promise.all(
        todo.map((c) =>
          fetch(c.url, { mode: "cors", cache: "force-cache" }).then((r) => {
            if (!r.ok) throw new Error(`glb ${c.slug}: HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
        ),
      );
    } catch {
      // any failed download — fall back to per-character loads (they cache
      // their own failures and leave the cartoon body in place)
      for (const c of todo) void loadGlbTemplate(c.slug).catch(() => {});
      return;
    }
    for (let i = 0; i < todo.length; i++) {
      try {
        const slug = todo[i].slug;
        if (templates.has(slug)) continue;
        loader.parse(bufs[i], "", (gltf) => {
          const scene = gltf.scene;
          scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = false;
              m.receiveShadow = false;
              m.frustumCulled = false;
            }
          });
          const { h } = measure(scene);
          const unitScale = CHAR_TARGET_H / h;
          templates.set(slug, {
            slug,
            scene,
            clips: gltf.animations ?? [],
            unitScale,
            hip: h * 0.52 * unitScale,
            handBone: scene.getObjectByName("attach-righthand") ?? null,
          });
          pending.delete(slug);
          bump();
        });
        // give the main thread a breather between parses
        await new Promise((r) => setTimeout(r, 0));
      } catch {
        failed.add(todo[i].slug);
        bump();
      }
    }
  })();
}
