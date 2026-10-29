import { describe, expect, it } from "vitest";
import { ARENA, BALLOT, BossEncounter, DIFFICULTY, Phase, STATION_POS, mulberry32, type BossPlayer } from "./index.ts";

const mk = (id: string, x: number = ARENA.x, z: number = ARENA.z): BossPlayer => ({ id, x, z, down: false });
/** Step the encounter, dodging hazards like a competent player. Returns all events. */
function run(b: BossEncounter, ps: BossPlayer[], seconds: number, dodge = true) {
  const evs: any[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    if (dodge) for (const p of ps) {
      if (p.down) continue;
      const near = b.hazards.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < h.r + 2);
      if (near) { p.x = p.x < 0 ? 22 : -22; p.z = ARENA.z; }
    }
    evs.push(...b.update(0.05, ps));
  }
  return evs;
}
const advanceTo = (b: BossEncounter, ps: BossPlayer[], phase: number, max = 200) => {
  for (let t = 0; t < max && b.phase !== phase; t += 0.05) {
    if (b.phase === Phase.BUREAU) for (const s of b.stations) { const p = ps[0]; p.x = s.x; p.z = s.z; while (s.progress < s.need) b.interact(p); }
    if (b.phase === Phase.TEAM) ps.forEach((p, i) => { p.x = STATION_POS[i % 3].x; p.z = STATION_POS[i % 3].z; });
    b.update(0.05, ps);
  }
};

describe("boss encounter", () => {
  it("waits idle, then counts down and starts when a player is in the arena", () => {
    const b = new BossEncounter(mulberry32(1));
    const away = [mk("a", 0, 50)];
    run(b, away, 10); expect(b.phase).toBe(Phase.IDLE);
    const ps = [mk("a")]; run(b, ps, 6); expect(b.phase).toBe(Phase.SPEECH);
  });
  it("hazards are telegraphed first and only hurt players who stay", () => {
    const b = new BossEncounter(mulberry32(2)), p = mk("a");
    run(b, [p], 5.5, false);
    let hits = 0; for (let t = 0; t < 6; t += 0.05) hits += b.update(0.05, [p]).filter((e) => e.type === "hit").length;
    expect(hits).toBeGreaterThan(0);                       // standing still gets hit
    const b2 = new BossEncounter(mulberry32(2)), q = mk("a"), evs = run(b2, [q], 25, true);
    expect(evs.filter((e) => e.type === "hit").length).toBeLessThan(hits + 3);
    expect(b2.hazards.every((h) => h.t > 0)).toBe(true);
  });
  it("plays all five phases in order with a shrinking health bar and grants rewards exactly once", () => {
    const b = new BossEncounter(mulberry32(3)), ps = [mk("a"), mk("b")], seen: number[] = [], rewards: any[] = [];
    for (let t = 0; t < 400 && b.phase !== Phase.WON; t += 0.05) {
      if (b.phase === Phase.VOTE) { ps.forEach((p) => { p.x = BALLOT.x; p.z = BALLOT.z; b.interact(p); }); }
      advanceToStep(b, ps);
      for (const e of b.update(0.05, ps)) { if (e.type === "phase") seen.push(e.phase); if (e.type === "reward") rewards.push(e); }
    }
    expect(seen.slice(0, 5)).toEqual([Phase.SPEECH, Phase.BUREAU, Phase.STAMP, Phase.TEAM, Phase.VOTE]);
    expect(b.phase).toBe(Phase.WON); expect(b.hp).toBe(0);
    expect(rewards.map((r) => r.id).sort()).toEqual(["a", "b"]);
    // keep ticking while WON: no duplicate rewards
    const more = run(b, ps, 3, false).filter((e) => e.type === "reward"); expect(more.length).toBe(0);
  });
  it("is replayable: resets after victory and can be won again with fresh rewards", () => {
    const b = new BossEncounter(mulberry32(4)), ps = [mk("a")];
    const win = () => { let rw = 0; for (let t = 0; t < 500 && b.phase !== Phase.WON; t += 0.05) { if (b.phase === Phase.VOTE) { ps[0].x = BALLOT.x; ps[0].z = BALLOT.z; b.interact(ps[0]); } advanceToStep(b, ps); rw += b.update(0.05, ps).filter((e) => e.type === "reward").length; } return rw; };
    expect(win()).toBe(1);
    run(b, ps, 13, false); expect(b.phase).toBe(Phase.IDLE); expect(b.round).toBe(2);
    ps[0].x = ARENA.x; ps[0].z = ARENA.z; expect(win()).toBe(1);
  });
  it("fails when everyone is detained, then resets", () => {
    const b = new BossEncounter(mulberry32(5)), ps = [mk("a")];
    run(b, ps, 6); expect(b.phase).toBe(Phase.SPEECH);
    ps[0].down = true; run(b, ps, 7, false); expect(b.phase).toBe(Phase.FAILED);
    ps[0].down = false; run(b, ps, 9, false); expect(b.phase).toBe(Phase.IDLE);
  });
  it("needs distinct players on plates in the teamwork phase, and a ballot majority to win", () => {
    const b = new BossEncounter(mulberry32(6)), ps = [mk("a"), mk("b"), mk("c")];
    advanceTo(b, ps, Phase.TEAM);
    ps.forEach((p) => { p.x = STATION_POS[0].x; p.z = STATION_POS[0].z; });     // everyone on ONE plate
    run(b, ps, 6, false); expect(b.phase).toBe(Phase.TEAM);
    ps.forEach((p, i) => { p.x = STATION_POS[i].x; p.z = STATION_POS[i].z; });  // spread out
    run(b, ps, 4, false); expect(b.phase).toBe(Phase.VOTE);
    ps.forEach((p) => { p.x = BALLOT.x; p.z = BALLOT.z; });
    b.interact(ps[0]); b.update(0.05, ps); expect(b.phase).toBe(Phase.VOTE);     // 1 of 3 is not a majority
    b.interact(ps[1]); b.update(0.05, ps); expect(b.phase).toBe(Phase.WON);       // 2 of 3 = ceil(1.8)
  });
  it("ignores interaction from outsiders, detained players, or the wrong phase; harder modes hurt more", () => {
    const b = new BossEncounter(mulberry32(7)), a = mk("a"), out = mk("o", 0, 60);
    expect(b.interact(a)).toBe(false);                    // idle
    advanceTo(b, [a], Phase.BUREAU);
    a.x = STATION_POS[0].x; a.z = STATION_POS[0].z;
    expect(b.interact(out)).toBe(false); a.down = true; expect(b.interact(a)).toBe(false);
    a.down = false; expect(b.interact(a)).toBe(true);
    const e = new BossEncounter(mulberry32(8), { minPlayers: 1, difficulty: DIFFICULTY.easy }), h = new BossEncounter(mulberry32(8), { minPlayers: 1, difficulty: DIFFICULTY.hard });
    const dmg = (x: BossEncounter) => { const p = mk("a"); let d = 0; for (let t = 0; t < 12; t += 0.05) for (const ev of x.update(0.05, [p])) if (ev.type === "hit") d += ev.dmg; return d; };
    expect(dmg(h)).toBeGreaterThan(dmg(e));
  });
});
function advanceToStep(b: BossEncounter, ps: BossPlayer[]) {
  if (b.phase === Phase.BUREAU) for (const s of b.stations) { const p = ps[0]; p.x = s.x; p.z = s.z; while (s.progress < s.need) b.interact(p); }
  if (b.phase === Phase.TEAM) ps.forEach((p, i) => { p.x = STATION_POS[i % 3].x; p.z = STATION_POS[i % 3].z; });
  if (b.phase === Phase.STAMP || b.phase === Phase.SPEECH) for (const p of ps) { const near = b.hazards.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < h.r + 2); if (near) { p.x = p.x < 0 ? 22 : -22; p.z = ARENA.z; } }
}
