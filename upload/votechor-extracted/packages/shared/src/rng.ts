/** Deterministic PRNG so server and client generate the identical world. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const range = (r: () => number, a: number, b: number) => a + r() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
