/** Type shims for the polyfork parametric car modules (plain-JS ESM). */
declare module "*.mjs" {
  import type { Group } from "three";
  export function createAsset(opts?: Record<string, unknown>): Group;
  export const rig: Record<string, { axis: string; range: [number, number] }>;
  export const detach: string[];
  export const night: Record<string, { color: string; intensity: number; describe: string }>;
  export default createAsset;
}
