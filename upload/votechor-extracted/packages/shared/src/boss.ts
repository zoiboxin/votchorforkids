import { range } from "./rng.ts";

export const ARENA = { x: 0, z: -85, r: 30 } as const;
export const BOSS_POS = { x: 0, z: -102 } as const;
export const BALLOT = { x: 0, z: -80 } as const;
export const STATION_POS = [{ x: -14, z: -85 }, { x: 0, z: -70 }, { x: 14, z: -85 }] as const;
export const Phase = { IDLE: 0, SPEECH: 1, BUREAU: 2, STAMP: 3, TEAM: 4, VOTE: 5, WON: 6, FAILED: 7 } as const;
export const PHASE_TEXT: Record<number, { name: string; goal: string }> = {
  0: { name: "The Great Vote Collector", goal: "Stand in the arena to summon the boss" },
  1: { name: "Phase 1: The Speech", goal: "Dodge the flying paperwork" },
  2: { name: "Phase 2: Bureaucracy", goal: "Press E at each document pile to sort it" },
  3: { name: "Phase 3: Giant Stamp", goal: "Leave the red circles before the stamp lands" },
  4: { name: "Phase 4: Teamwork", goal: "Stand on the glowing plates together" },
  5: { name: "Phase 5: Final Vote", goal: "Press E at the ballot box to cast your vote" },
  6: { name: "Victory!", goal: "The shield is gone. Rewards granted." },
  7: { name: "The committee adjourns", goal: "Everyone was detained. Try again soon." },
};
export const DIFFICULTY = { easy: { dmg: 0.6, rate: 0.7 }, normal: { dmg: 1, rate: 1 }, hard: { dmg: 1.5, rate: 1.4 } } as const;
export type DifficultyName = keyof typeof DIFFICULTY;

export const COUNTDOWN = 5, SPEECH_S = 20, STAMPS_NEEDED = 6, STATION_NEED = 6, HOLD_S = 3, FAIL_AFTER_S = 6, WON_S = 12, FAILED_S = 8, REWARD_SUPPORT = 5;

export interface BossPlayer { id: string; x: number; z: number; down: boolean }
export interface Hazard { id: number; x: number; z: number; r: number; t: number; dmg: number; kind: "paper" | "stamp" }
export interface Station { x: number; z: number; progress: number; need: number }
export type BossEvent =
  | { type: "hit"; id: string; dmg: number; msg: string }
  | { type: "reward"; id: string; support: number }
  | { type: "phase"; phase: number; msg: string };

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Server-authoritative boss state machine. Pure logic: the room feeds it player positions each tick
 * and applies the returned events. Rewards are granted at most once per player per encounter.
 */
export class BossEncounter {
  phase: number = Phase.IDLE; timer = COUNTDOWN; hp = 100; round = 1;
  hazards: Hazard[] = []; stations: Station[] = [];
  votes = new Set<string>(); participants = new Set<string>(); rewarded = new Set<string>();
  hold = 0; stamps = 0; absent = 0;
  private spawnT = 0; private nextId = 1; private ev: BossEvent[] = [];
  constructor(private rnd: () => number, private opts: { minPlayers: number; difficulty: { dmg: number; rate: number } } = { minPlayers: 1, difficulty: DIFFICULTY.normal }) {}

  private inArena = (p: BossPlayer) => dist(p, ARENA) <= ARENA.r;
  alive(ps: BossPlayer[]) { return ps.filter((p) => this.participants.has(p.id) && !p.down && this.inArena(p)); }
  private go(phase: number, msg: string, timer = 0) { this.phase = phase; this.timer = timer; this.spawnT = 0; this.hold = 0; this.stamps = 0; this.ev.push({ type: "phase", phase, msg }); }
  private makeStations() { this.stations = STATION_POS.map((s) => ({ x: s.x, z: s.z, progress: 0, need: STATION_NEED })); }
  private reset() {
    this.phase = Phase.IDLE; this.timer = COUNTDOWN; this.hp = 100; this.hazards = []; this.stations = [];
    this.votes.clear(); this.participants.clear(); this.rewarded.clear(); this.hold = 0; this.stamps = 0; this.absent = 0; this.round++;
  }
  private addHazard(x: number, z: number, r: number, t: number, dmg: number, kind: Hazard["kind"]) {
    this.hazards.push({ id: this.nextId++, x, z, r, t, dmg: Math.round(dmg * this.opts.difficulty.dmg), kind });
  }
  private paper(ps: BossPlayer[], every: number) {
    if (this.spawnT > 0) return;
    this.spawnT = every / this.opts.difficulty.rate;
    const a = this.alive(ps); if (!a.length) return;
    const p = a[Math.floor(this.rnd() * a.length)];
    this.addHazard(p.x + range(this.rnd, -5, 5), p.z + range(this.rnd, -5, 5), 3, 1.6, 5, "paper");
  }

  /** Player pressed E. Returns true if it advanced a boss objective. */
  interact(p: BossPlayer): boolean {
    if (p.down || !this.participants.has(p.id) || !this.inArena(p)) return false;
    if (this.phase === Phase.BUREAU) {
      const s = this.stations.find((s) => s.progress < s.need && dist(p, s) <= 3);
      if (s) { s.progress++; return true; }
    }
    if (this.phase === Phase.VOTE && dist(p, BALLOT) <= 3.5) { this.votes.add(p.id); return true; }
    return false;
  }

  update(dt: number, ps: BossPlayer[]): BossEvent[] {
    this.ev = [];
    const here = ps.filter((p) => !p.down && this.inArena(p));
    if (this.phase === Phase.IDLE) {
      if (here.length >= this.opts.minPlayers) {
        this.timer -= dt;
        if (this.timer <= 0) { here.forEach((p) => this.participants.add(p.id)); this.go(Phase.SPEECH, "The Great Vote Collector clears his throat. Speech time!", SPEECH_S); }
      } else this.timer = COUNTDOWN;
      return this.ev;
    }
    if (this.phase === Phase.WON || this.phase === Phase.FAILED) {
      this.timer -= dt; if (this.timer <= 0) this.reset(); return this.ev;
    }
    here.forEach((p) => this.participants.add(p.id));
    const alive = this.alive(ps);
    this.absent = alive.length === 0 ? this.absent + dt : 0;
    if (this.absent >= FAIL_AFTER_S) { this.hazards = []; this.go(Phase.FAILED, "The Boss Has Requested Another Committee Meeting.", FAILED_S); return this.ev; }

    this.spawnT = Math.max(0, this.spawnT - dt);
    switch (this.phase) {
      case Phase.SPEECH:
        this.paper(ps, 1.2); this.timer -= dt;
        if (this.timer <= 0) { this.hp = 80; this.makeStations(); this.go(Phase.BUREAU, "Bureaucracy attack! Sort the documents."); }
        break;
      case Phase.BUREAU:
        if (this.stations.every((s) => s.progress >= s.need)) { this.hp = 60; this.stations = []; this.go(Phase.STAMP, "The Giant Stamp rises. Watch the ground!"); }
        break;
      case Phase.STAMP:
        if (this.spawnT <= 0 && alive.length) {
          this.spawnT = 2.2 / this.opts.difficulty.rate;
          const p = alive[Math.floor(this.rnd() * alive.length)];
          this.addHazard(p.x, p.z, 6, 1.8, 10, "stamp");
        }
        if (this.stamps >= STAMPS_NEEDED) { this.hp = 40; this.makeStations(); this.go(Phase.TEAM, "Teamwork! Stand on the plates together."); }
        break;
      case Phase.TEAM: {
        this.paper(ps, 3);
        const need = Math.min(3, Math.max(1, alive.length));
        const occupied = this.stations.filter((s) => alive.some((p) => dist(p, s) <= 2.5)).length;
        this.hold = occupied >= need ? this.hold + dt : 0;
        if (this.hold >= HOLD_S) { this.hp = 20; this.stations = []; this.votes.clear(); this.go(Phase.VOTE, "Final vote! Cast your ballots."); }
        break;
      }
      case Phase.VOTE: {
        const need = Math.max(1, Math.ceil(0.6 * alive.length));
        if (this.votes.size >= need) {
          this.hp = 0;
          for (const id of this.participants) if (!this.rewarded.has(id)) { this.rewarded.add(id); this.ev.push({ type: "reward", id, support: REWARD_SUPPORT }); }
          this.hazards = [];
          this.go(Phase.WON, "Democracy has been restored. The shield is gone!", WON_S);
        }
        break;
      }
    }
    // resolve hazards: telegraph, then damage anyone still inside
    for (const h of this.hazards) h.t -= dt;
    for (const h of this.hazards.filter((h) => h.t <= 0)) {
      for (const p of alive) if (dist(p, h) <= h.r) this.ev.push({ type: "hit", id: p.id, dmg: h.dmg, msg: h.kind === "stamp" ? "Stamped! Application denied." : "Paper cut by red tape." });
      if (h.kind === "stamp") this.stamps++;
    }
    this.hazards = this.hazards.filter((h) => h.t > 0);
    return this.ev;
  }
}
