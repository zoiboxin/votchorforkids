import { range, resolve, type World } from "@votechor/shared";

export interface Target { id: string; x: number; z: number; sprinting: boolean; safe: boolean }
export interface Agent {
  id: string; police: boolean; axis: 0 | 1; line: number; off: number; dir: 1 | -1; speed: number;
  mode: "patrol" | "chase" | "return"; target: string | null; lost: number; rt: number;
}
export interface Pose { x: number; z: number; ry: number; spd: number }

export function createAgent(id: string, rnd: () => number, police: boolean): Agent {
  return {
    id, police, axis: rnd() < 0.5 ? 0 : 1, line: Math.round(range(rnd, -2, 2)) * 60,
    off: rnd() < 0.5 ? -5 : 5, dir: rnd() < 0.5 ? -1 : 1,
    speed: police ? 2.2 : range(rnd, 1.2, 2.4), mode: "patrol", target: null, lost: 0, rt: 0,
  };
}
/** Lane position along the agent's road. */
export const lanePoint = (a: Agent, along: number) =>
  a.axis ? { x: a.line + a.off, z: along } : { x: along, z: a.line + a.off };

const CHASE_SPEED = 7.6, RETURN_SPEED = 4;

/** One AI step. Police: patrol -> notice -> chase -> lose -> return. Civilians just walk their lane. */
export function stepAgent(
  a: Agent, p: Pose, dt: number, night: number,
  targets: Map<string, Target>, world: World, onBump: (id: string) => void,
): void {
  if (a.mode === "patrol") {
    const m = a.dir * a.speed * dt;
    if (a.axis) p.z += m; else p.x += m;
    if (Math.abs(a.axis ? p.z : p.x) > 125) a.dir = (a.dir * -1) as 1 | -1;
    p.ry = a.axis ? (a.dir > 0 ? 0 : Math.PI) : a.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.spd = a.speed;
    if (a.police) {
      const range = 22 * (1 - 0.4 * night);
      let best: Target | null = null, bd = Infinity;
      for (const t of targets.values()) {
        if (t.safe) continue;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d < range && (t.sprinting || d < 11) && d < bd) { best = t; bd = d; }
      }
      if (best) { a.mode = "chase"; a.target = best.id; a.lost = 0; }
    }
    return;
  }
  if (a.mode === "chase") {
    const t = a.target ? targets.get(a.target) : undefined;
    if (!t || t.safe) { a.mode = "return"; a.target = null; a.rt = 0; return; }
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 0.01;
    p.x += (dx / d) * CHASE_SPEED * dt; p.z += (dz / d) * CHASE_SPEED * dt;
    resolve(p, 0.5, world);
    p.ry = Math.atan2(dx, dz); p.spd = CHASE_SPEED;
    if (d < 1.5) onBump(t.id);
    a.lost = d > 48 ? a.lost + dt : 0;
    if (a.lost > 5) { a.mode = "return"; a.target = null; a.rt = 0; }
    return;
  }
  // return to lane
  a.rt += dt;
  const lane = lanePoint(a, a.axis ? p.z : p.x);
  const ex = lane.x - p.x, ez = lane.z - p.z, e = Math.hypot(ex, ez);
  if (e < 1.2) { p.x = lane.x; p.z = lane.z; a.mode = "patrol"; a.rt = 0; return; }
  p.x += (ex / e) * RETURN_SPEED * dt; p.z += (ez / e) * RETURN_SPEED * dt;
  resolve(p, 0.5, world);
  p.ry = Math.atan2(ex, ez); p.spd = RETURN_SPEED;
}
