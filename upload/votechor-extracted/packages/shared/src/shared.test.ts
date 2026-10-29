import { describe, expect, it } from "vitest";
import { SquadBook, SquadMsgSchema, SQUAD_MAX, ZOMBIE_COUNT, ANIMAL_COUNT, spawnCreatures, stepCreature, GRAVEYARD, ITEMS, ITEM_COUNT, applyItem, pickItemKind, randomItemPos, mulberry32, resolve, nightFactor, botsNeeded, placePlayer, generateWorld, newBody, stepBody, parseJoinOptions, InputSchema, WALL_RADIUS, zoneOf } from "./index.ts";

const idle = { f: 0, r: 0, yaw: 0, sprint: false, jump: false };

describe("bot-fill rule", () => {
  it("keeps real + bots at 100", () => {
    for (const n of [0, 1, 50, 99, 100]) expect(n + botsNeeded(n)).toBe(100);
    expect(botsNeeded(150)).toBe(0);
  });
  it("opens a new room on the 101st player", () => {
    let rooms: number[] = [];
    for (let i = 0; i < 100; i++) rooms = placePlayer(rooms);
    expect(rooms).toEqual([100]);
    rooms = placePlayer(rooms);
    expect(rooms).toEqual([100, 1]);
    expect(botsNeeded(rooms[1])).toBe(99);
  });
});

describe("movement simulation", () => {
  const world = generateWorld();
  it("is deterministic across worlds with the same seed", () => {
    expect(generateWorld().buildings[5]).toEqual(world.buildings[5]);
  });
  it("moves forward relative to camera and sprints faster", () => {
    const a = newBody(0, 6), b = newBody(0, 6);
    for (let i = 0; i < 40; i++) { stepBody(a, { ...idle, f: 1 }, 0.05, "young", world); stepBody(b, { ...idle, f: 1, sprint: true }, 0.05, "young", world); }
    expect(a.z).toBeLessThan(6);
    expect(Math.abs(b.z - 6)).toBeGreaterThan(Math.abs(a.z - 6));
  });
  it("jumps and lands on the ground", () => {
    const b = newBody(0, 6);
    stepBody(b, { ...idle, jump: true }, 0.05, "teen", world);
    expect(b.y).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) stepBody(b, idle, 0.05, "teen", world);
    expect(b.y).toBe(0);
  });
  it("blocks buildings and the mountain wall", () => {
    const bd = world.buildings[0];
    const b = newBody(bd.x - bd.w - 3, bd.z);
    for (let i = 0; i < 80; i++) stepBody(b, { ...idle, f: 0, r: 1, yaw: 0 }, 0.05, "young", world);
    expect(b.x).toBeLessThanOrEqual(bd.x - bd.w + 0.01);
    const w = newBody(300, 0);
    for (let i = 0; i < 200; i++) stepBody(w, { ...idle, r: 1, yaw: 0 }, 0.05, "teen", world);
    expect(Math.hypot(w.x, w.z)).toBeLessThanOrEqual(WALL_RADIUS + 0.001);
  });
  it("drains stamina while sprinting", () => {
    const b = newBody(0, 6);
    for (let i = 0; i < 60; i++) stepBody(b, { ...idle, f: 1, sprint: true }, 0.05, "young", world);
    expect(b.stamina).toBeLessThan(60);
  });
  it("computes a finite night factor", () => { expect(nightFactor(0.5)).toBe(0); expect(nightFactor(0)).toBe(1); expect(nightFactor(NaN)).toBe(0); });
  it("classifies zones", () => { expect(zoneOf(0, 0)).toBe("City"); expect(zoneOf(-185, 165)).toBe("Graveyard"); });
});

describe("input validation", () => {
  it("rejects malformed input and sanitizes join options", () => {
    expect(InputSchema.safeParse({ f: 9, r: 0, yaw: 0, sprint: false, jump: false }).success).toBe(false);
    expect(InputSchema.safeParse({ f: 1 }).success).toBe(false);
    const bad = parseJoinOptions({ name: "<script>", fac: "admin" });
    expect(bad.name).toBe("script"); expect(bad.fac).toBe("protester");
    expect(parseJoinOptions(null).name).toBe("Guest");
  });
});

describe("items", () => {
  const world = generateWorld();
  it("caps health and stamina at 100 and ignores unknown kinds", () => {
    expect(applyItem(95, 90, 4)).toEqual({ hp: 100, stamina: 90 });
    expect(applyItem(50, 10, 5)).toEqual({ hp: 50, stamina: 70 });
    expect(applyItem(50, 50, 99)).toEqual({ hp: 50, stamina: 50 });
  });
  it("spawns only on free ground and picks every kind eventually", () => {
    const r = mulberry32(5), seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const p = randomItemPos(r, world), q = { ...p }; resolve(q, 1, world);
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(0.01);
      seen.add(pickItemKind(r));
    }
    expect(seen.size).toBe(ITEMS.length); expect(ITEM_COUNT).toBeGreaterThan(0);
  });
});

describe("creatures", () => {
  const r = mulberry32(3);
  it("spawns 14 zombies in the graveyard and 26 animals in the wild", () => {
    const cs = spawnCreatures(r);
    expect(cs.filter((c) => c.kind === 0).length).toBe(ZOMBIE_COUNT);
    expect(cs.filter((c) => c.kind > 0).length).toBe(ANIMAL_COUNT);
    for (const z of cs.filter((c) => c.kind === 0)) expect(Math.hypot(z.x - GRAVEYARD.x, z.z - GRAVEYARD.z)).toBeLessThan(40);
  });
  it("zombies chase an unprotected player and touch them, but ignore protected ones", () => {
    const z = spawnCreatures(r).find((c) => c.kind === 0)!;
    const touched: string[] = [];
    const target = { id: "p", x: z.x + 10, z: z.z, safe: false };
    for (let i = 0; i < 200; i++) stepCreature(z, 0.05, 0, [target], r, (id) => touched.push(id));
    expect(touched.length).toBeGreaterThan(0);
    const z2 = spawnCreatures(r).find((c) => c.kind === 0)!, t2: string[] = [];
    for (let i = 0; i < 200; i++) stepCreature(z2, 0.05, 0, [{ id: "p", x: z2.x + 5, z: z2.z, safe: true }], r, (id) => t2.push(id));
    expect(t2.length).toBe(0);
  });
  it("animals flee from nearby players and stay inside the wild ring", () => {
    const a = spawnCreatures(r).find((c) => c.kind === 1)!;
    const p = { id: "p", x: a.x + 3, z: a.z, safe: false };
    const d0 = Math.hypot(p.x - a.x, p.z - a.z);
    for (let i = 0; i < 10; i++) stepCreature(a, 0.05, 0, [p], r, () => {});
    expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeGreaterThan(d0);
    for (let i = 0; i < 4000; i++) stepCreature(a, 0.05, 0, [], r, () => {});
    const rr = Math.hypot(a.x, a.z); expect(rr).toBeGreaterThan(120); expect(rr).toBeLessThan(330);
  });
});

describe("squads", () => {
  it("creates, joins, enforces the size limit and cleans up", () => {
    const b = new SquadBook(mulberry32(1));
    const code = b.create("a");
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    for (let i = 1; i < SQUAD_MAX; i++) expect(b.join(`p${i}`, code)).toBe("ok");
    expect(b.join("extra", code)).toBe("full");
    expect(b.join("p1", code)).toBe("already");
    expect(b.join("x", "ZZZZ")).toBe("missing");
    expect(b.sameSquad("a", "p1")).toBe(true); expect(b.sameSquad("a", "extra")).toBe(false);
    b.leave("p1"); expect(b.members(code).length).toBe(SQUAD_MAX - 1);
    for (const id of b.members(code)) b.leave(id);
    expect(b.members(code)).toEqual([]);
  });
  it("moving to another squad leaves the old one", () => {
    const b = new SquadBook(mulberry32(2)), c1 = b.create("a"), c2 = b.create("b");
    b.join("a", c2); expect(b.squadOf("a")).toBe(c2); expect(b.members(c1)).toEqual([]);
  });
  it("validates squad messages", () => {
    expect(SquadMsgSchema.safeParse({ action: "join", code: " ab3k " }).data?.code).toBe("AB3K");
    expect(SquadMsgSchema.safeParse({ action: "join", code: "<script>" }).success).toBe(false);
    expect(SquadMsgSchema.safeParse({ action: "ban" }).success).toBe(false);
  });
});
