import { Room, CloseCode, type Client } from "@colyseus/core";
import {
  AGE_STATS, InputSchema, ROOM_CAPACITY, SPAWN, TICK_HZ, advanceClock, botsNeeded, generateWorld,
  mulberry32, newBody, nightFactor, parseJoinOptions, randomAppearance, range, stepBody,
  BossEncounter, DIFFICULTY, Phase, type BossPlayer, InteractSchema, RESCUE_RADIUS, SquadBook, SquadMsgSchema, ITEMS, ITEM_COUNT, spawnCreatures, stepCreature, type Creature, ITEM_RESPAWN_S, PICKUP_RADIUS, applyItem, pickItemKind, randomItemPos,
  type AgeGroup, type Appearance, type Body, type PlayerInput,
} from "@votechor/shared";
import { BossState, CityState, CreatureState, HazardState, ItemState, PlayerState, StationState } from "./state.ts";
import { createAgent, lanePoint, stepAgent, type Agent, type Target } from "./agents.ts";

const POLICE_BOTS = 15, DETAIN_SECONDS = 3.5, RECONNECT_SECONDS = 20;
const IDLE: PlayerInput = { f: 0, r: 0, yaw: 0, sprint: false, jump: false };
interface Runtime { actCd: number; body: Body; input: PlayerInput; age: AgeGroup; imm: number; hitCd: number; det: number; calm: number }

/**
 * One 100-entity city instance. The server owns movement, health, detention and AI;
 * clients only send input intent. Real players replace bots 1:1 (real + bots = capacity).
 */
export class CityRoom extends Room<{ state: CityState }> {
  maxClients = ROOM_CAPACITY;
  maxMessagesPerSecond = 60;
  private world = generateWorld();
  private rnd = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  private humans = new Map<string, Runtime>();
  private agents = new Map<string, Agent>();
  private botSeq = 0;
  private respawn = new Map<string, number>();
  private conns = new Map<string, Client>();
  private creatures: Creature[] = [];
  private squads = new SquadBook(this.rnd);
  private boss!: BossEncounter;

  private strikes = new Map<string, number>();
  private kicked = new Set<string>();

  /** Validate untrusted client payloads; ignore bad ones and remove persistent abusers. */
  private parse<T>(client: Client, schema: { safeParse(v: unknown): { success: boolean; data?: T } }, raw: unknown): T | null {
    const r = schema.safeParse(raw);
    if (r.success) return r.data as T;
    const n = (this.strikes.get(client.sessionId) ?? 0) + 1;
    this.strikes.set(client.sessionId, n);
    if (n >= 30) { this.kicked.add(client.sessionId); client.leave(4001, "too many invalid messages"); }
    return null;
  }
  private notice(id: string, msg: string) { this.conns.get(id)?.send("notice", { msg }); }

  messages = {
    input: (client: Client, raw: unknown) => {
      const rt = this.humans.get(client.sessionId); if (!rt) return;
      const m = this.parse(client, InputSchema, raw); if (m) rt.input = m;
    },
    squad: (client: Client, raw: unknown) => {
      const m = this.parse(client, SquadMsgSchema, raw); if (m) this.squadAction(client.sessionId, m.action, m.code);
    },
    interact: (client: Client, raw: unknown) => {
      if (!this.parse(client, InteractSchema, raw)) return;
      const rt = this.humans.get(client.sessionId); if (!rt || rt.actCd > 0) return;
      if (this.boss.interact(this.bossPlayer(client.sessionId, rt))) { rt.actCd = 0.25; return; }
      this.rescue(client.sessionId);
    },
  };

  onCreate(options?: { difficulty?: string; minBossPlayers?: number }) {
    const diff = DIFFICULTY[(options?.difficulty as keyof typeof DIFFICULTY) ?? "normal"] ?? DIFFICULTY.normal;
    const minPlayers = Math.min(10, Math.max(1, Math.floor(Number(options?.minBossPlayers) || 1)));
    this.boss = new BossEncounter(this.rnd, { minPlayers, difficulty: diff });
    this.state = new CityState();
    this.state.boss = new BossState();
    this.state.clock = 0.33; // 08:00
    for (let i = 0; i < botsNeeded(0); i++) this.spawnBot(i < POLICE_BOTS);
    this.creatures = spawnCreatures(this.rnd);
    for (const c of this.creatures) {
      const cs = new CreatureState(); cs.kind = c.kind; cs.x = c.x; cs.z = c.z; cs.ry = 0; cs.spd = 0;
      this.state.creatures.set(c.id, cs);
    }
    for (let i = 0; i < ITEM_COUNT; i++) this.placeItem(`item-${i}`);
    this.syncCounts();
    this.setSimulationInterval((ms) => this.tick(Math.min(0.1, ms / 1000)), 1000 / TICK_HZ);
  }

  onJoin(client: Client, options: unknown) {
    const opts = parseJoinOptions(options);
    this.removeOneBot();
    const p = new PlayerState();
    this.applyAppearance(p, opts, opts.name);
    p.x = SPAWN.x + range(this.rnd, -3, 3); p.z = SPAWN.z + range(this.rnd, -2, 2);
    p.hp = 100; p.stamina = 100; p.squad = ""; p.support = 0;
    this.state.players.set(client.sessionId, p);
    this.conns.set(client.sessionId, client);
    this.humans.set(client.sessionId, {
      body: newBody(p.x, p.z), input: IDLE, age: opts.age, imm: 3, hitCd: 0, det: 0, calm: 0, actCd: 0,
    });
    this.syncCounts();
  }

  async onLeave(client: Client, code?: number) {
    const rt = this.humans.get(client.sessionId);
    if (rt) rt.input = IDLE;
    if (code !== CloseCode.CONSENTED && !this.kicked.has(client.sessionId)) {
      try { await this.allowReconnection(client, RECONNECT_SECONDS); return; } catch { /* timed out */ }
    }
    this.squads.leave(client.sessionId);
    this.humans.delete(client.sessionId);
    this.conns.delete(client.sessionId);
    this.strikes.delete(client.sessionId);
    this.kicked.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.spawnBot(this.agentsPolice() < POLICE_BOTS);
    this.syncCounts();
  }

  // ---- population ----
  private agentsPolice() { let n = 0; for (const a of this.agents.values()) if (a.police) n++; return n; }
  private syncCounts() { this.state.real = this.humans.size; this.state.bots = this.agents.size; }
  private applyAppearance(p: PlayerState, a: Appearance, name: string) {
    p.name = name; p.fac = a.fac; p.sex = a.sex; p.age = a.age; p.cap = a.cap; p.skin = a.skin; p.shirt = a.shirt; p.shoe = a.shoe;
  }
  private spawnBot(police: boolean) {
    const id = `bot-${this.botSeq++}`;
    const ag = createAgent(id, this.rnd, police);
    const p = new PlayerState();
    this.applyAppearance(p, randomAppearance(this.rnd, police), police ? "Officer" : `Citizen ${this.botSeq}`);
    // Spawn on its lane, away from real players.
    let along = range(this.rnd, -120, 120);
    for (let i = 0; i < 10; i++) {
      const c = lanePoint(ag, along);
      if (![...this.humans.values()].some((h) => Math.hypot(h.body.x - c.x, h.body.z - c.z) < 60)) break;
      along = range(this.rnd, -120, 120);
    }
    const c = lanePoint(ag, along);
    p.x = c.x; p.z = c.z; p.hp = 100; p.stamina = 100; p.squad = ""; p.support = 0;
    this.state.players.set(id, p);
    this.agents.set(id, ag);
  }
  /** Remove the bot farthest from spawn, preferring civilians so the police count stays stable. */
  private removeOneBot() {
    let pick: string | null = null, score = -1;
    for (const [id, ag] of this.agents) {
      const p = this.state.players.get(id)!;
      const s = Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) + (ag.police ? -1000 : 0) + (ag.mode === "chase" ? -2000 : 0);
      if (s > score) { score = s; pick = id; }
    }
    if (pick) { this.agents.delete(pick); this.state.players.delete(pick); }
  }

  // ---- boss encounter (server-authoritative; see packages/shared/src/boss.ts) ----
  private bossPlayer(id: string, rt: Runtime): BossPlayer { return { id, x: rt.body.x, z: rt.body.z, down: rt.det > 0 }; }
  private tickBoss(dt: number) {
    const players = [...this.humans].map(([id, rt]) => this.bossPlayer(id, rt));
    for (const e of this.boss.update(dt, players)) {
      if (e.type === "hit") this.hurt(e.id, e.dmg, 0, e.msg);
      else if (e.type === "phase") this.broadcast("notice", { msg: e.msg });
      else { const p = this.state.players.get(e.id); if (p) { p.support += e.support; this.notice(e.id, `Boss defeated! +${e.support} support points.`); } }
    }
    const b = this.boss, st = this.state.boss;
    st.phase = b.phase; st.hp = b.hp; st.timer = Math.max(0, b.timer); st.hold = b.hold; st.votes = b.votes.size; st.round = b.round; st.participants = b.participants.size;
    st.need = Math.max(1, Math.ceil(0.6 * b.alive(players).length));
    const hz = new Set<string>();
    for (const h of b.hazards) {
      const k = String(h.id); hz.add(k);
      let hs = st.hazards.get(k); if (!hs) { hs = new HazardState(); hs.x = h.x; hs.z = h.z; hs.r = h.r; hs.kind = h.kind === "stamp" ? 1 : 0; st.hazards.set(k, hs); }
      hs.t = h.t;
    }
    for (const k of [...st.hazards.keys()]) if (!hz.has(k)) st.hazards.delete(k);
    if (b.stations.length !== st.stations.size) {
      st.stations.clear();
      b.stations.forEach((s, i) => { const ss = new StationState(); ss.x = s.x; ss.z = s.z; ss.need = s.need; ss.progress = s.progress; st.stations.set(String(i), ss); });
    } else b.stations.forEach((s, i) => { const ss = st.stations.get(String(i)); if (ss) { ss.progress = s.progress; ss.need = s.need; } });
  }

  // ---- squads and rescue (server-validated) ----
  private setSquad(id: string, code: string) { const p = this.state.players.get(id); if (p) p.squad = code; }
  private squadAction(id: string, action: "create" | "join" | "leave", code?: string) {
    if (!this.humans.has(id)) return;
    if (action === "create") { const c = this.squads.create(id); this.setSquad(id, c); this.notice(id, `Squad ${c} created. Share the code!`); }
    else if (action === "leave") { const old = this.squads.leave(id); this.setSquad(id, ""); if (old) this.notice(id, "You left the squad."); }
    else if (code) {
      const r = this.squads.join(id, code);
      if (r === "ok") { this.setSquad(id, code); this.notice(id, `Joined squad ${code}.`); }
      else this.notice(id, { full: "That squad is full.", missing: "No squad with that code.", already: "You are already in that squad.", ok: "" }[r]);
    }
  }
  /** E key: free the nearest detained squadmate within reach. */
  private rescue(id: string) {
    const rt = this.humans.get(id), me = this.state.players.get(id);
    if (!rt || !me || rt.det > 0 || rt.actCd > 0) return;
    rt.actCd = 0.5;
    let best: string | null = null, bd = RESCUE_RADIUS;
    for (const [oid, ort] of this.humans) {
      if (oid === id || ort.det <= 0 || !this.squads.sameSquad(id, oid)) continue;
      const d = Math.hypot(ort.body.x - rt.body.x, ort.body.z - rt.body.z);
      if (d <= bd) { bd = d; best = oid; }
    }
    if (!best) { this.notice(id, "Nobody to rescue nearby."); return; }
    const ort = this.humans.get(best)!, op = this.state.players.get(best)!;
    ort.det = 0; op.mode = 0; op.hp = 40; ort.imm = 4; ort.calm = 0;
    me.support += 1;
    this.notice(id, `You rescued ${op.name}! +1 support point.`);
    this.notice(best, `${me.name} rescued you. Democracy thanks them.`);
  }

  // ---- items (server-authoritative: clients never claim pickups) ----
  private placeItem(id: string) {
    const it = this.state.items.get(id) ?? new ItemState();
    const pos = randomItemPos(this.rnd, this.world);
    it.kind = pickItemKind(this.rnd); it.x = pos.x; it.z = pos.z; it.active = true;
    this.state.items.set(id, it);
  }
  private tickItems(dt: number) {
    for (const [id, left] of this.respawn) {
      if (left - dt <= 0) { this.respawn.delete(id); this.placeItem(id); } else this.respawn.set(id, left - dt);
    }
    for (const [cid, rt] of this.humans) {
      if (rt.det > 0) continue;
      const p = this.state.players.get(cid)!;
      for (const [id, it] of this.state.items) {
        if (!it.active || Math.hypot(it.x - rt.body.x, it.z - rt.body.z) > PICKUP_RADIUS) continue;
        const r = applyItem(p.hp, rt.body.stamina, it.kind);
        p.hp = r.hp; rt.body.stamina = r.stamina; it.active = false;
        this.respawn.set(id, ITEM_RESPAWN_S);
        this.conns.get(cid)?.send("pickup", { name: ITEMS[it.kind].name, msg: ITEMS[it.kind].msg });
      }
    }
  }

  // ---- simulation ----
  private tick(dt: number) {
    const st = this.state;
    st.clock = advanceClock(st.clock, dt);
    const night = nightFactor(st.clock);
    const targets = new Map<string, Target>();
    for (const [id, rt] of this.humans) {
      const p = st.players.get(id)!;
      rt.actCd = Math.max(0, rt.actCd - dt);
      rt.imm = Math.max(0, rt.imm - dt); rt.hitCd = Math.max(0, rt.hitCd - dt); rt.calm += dt;
      if (rt.det > 0) {
        rt.det -= dt;
        if (rt.det <= 0) this.release(rt, p);
      } else {
        stepBody(rt.body, rt.input, dt, rt.age, this.world);
        if (rt.calm > 8 && p.hp < 100) p.hp = Math.min(100, p.hp + 2 * dt * 5); // slow recovery out of trouble
      }
      p.x = rt.body.x; p.y = rt.body.y; p.z = rt.body.z; p.ry = rt.body.face;
      p.spd = Math.hypot(rt.body.vx, rt.body.vz); p.stamina = Math.round(rt.body.stamina); p.hp = Math.round(p.hp);
      p.stars = 0;
      targets.set(id, { id, x: p.x, z: p.z, sprinting: rt.body.sprinting, safe: rt.imm > 0 || rt.det > 0 });
    }
    this.tickItems(dt);
    this.tickBoss(dt);
    const ct = [...targets.values()];
    for (const c of this.creatures) {
      stepCreature(c, dt, night, ct, this.rnd, (id) => this.hurt(id, 4, 15, "A zombie wants your autograph. -4 health."));
      const cs = st.creatures.get(c.id)!; cs.x = c.x; cs.z = c.z; cs.ry = c.dir; cs.spd = c.spd;
    }
    for (const ag of this.agents.values()) {
      const p = st.players.get(ag.id)!;
      const pose = { x: p.x, z: p.z, ry: p.ry, spd: p.spd };
      stepAgent(ag, pose, dt, night, targets, this.world, (id) => this.hurt(id, 8, 0, "Bumped by an enthusiastic officer. -8 health."));
      p.x = pose.x; p.z = pose.z; p.ry = pose.ry; p.spd = pose.spd;
      if (ag.mode === "chase" && ag.target) {
        const tp = st.players.get(ag.target);
        if (tp) tp.stars = Math.min(5, tp.stars + 1);
      }
    }
  }
  /** Cartoon hit: server-validated health loss (with cooldown + spawn protection), detention at 0 hp. */
  private hurt(id: string, dmg: number, stamina: number, msg: string) {
    const rt = this.humans.get(id), p = this.state.players.get(id);
    if (!rt || !p || rt.hitCd > 0 || rt.det > 0 || rt.imm > 0) return;
    rt.hitCd = 1.2; rt.calm = 0;
    p.hp = Math.max(0, p.hp - dmg);
    rt.body.stamina = Math.max(0, rt.body.stamina - stamina);
    this.conns.get(id)?.send("hit", { msg });
    if (p.hp <= 0) { rt.det = DETAIN_SECONDS; p.mode = 1; }
  }
  private release(rt: Runtime, p: PlayerState) {
    rt.body = newBody(SPAWN.x, SPAWN.z);
    rt.imm = 5; rt.calm = 0; p.hp = 60; p.mode = 0;
  }
}
export const AGE_KEYS = Object.keys(AGE_STATS);
