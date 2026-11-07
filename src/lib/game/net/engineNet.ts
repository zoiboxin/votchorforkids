/**
 * engineNet — the glue between a local GameEngine and the relay.
 *
 * Responsibilities (the engine stays simulation-pure):
 *   • publish OUR survivor snapshot @12 Hz (binary, 9 bytes — protocol.ts)
 *   • ease REMOTE survivors' streams into engine.remotes (engine AI + HUD read them)
 *   • host: broadcast the story clock (phase/night/phaseLeft) @2 Hz + transitions
 *   • guest: drift-correct our story clock toward the host's
 *   • everyone: report our score @5 s, mirror remote events into the engine
 */
import type { GameEngine } from "../engine";
import type { Appearance } from "../constants";
import { packState } from "./protocol";
import { net, type LobbyPlayer, type MpEvent } from "./client";

export interface AttachNetOpts {
  engine: GameEngine;
  code: string;
  slot: number;
  isHost: boolean;
  name: string;
  look: Appearance;
  /** fired when the host restarts the session (everyone rewinds to night 1) */
  onReset: () => void;
  /** fired when the run ends for us (death) — lets the UI stop the stream */
  onSelfDead?: () => void;
}

export interface NetHandle {
  detach: () => void;
}

const lastRaw = new Map<number, { x: number; z: number; t: number }>(); // slot → last raw sample (velocity estimate)

export function attachNet(opts: AttachNetOpts): NetHandle {
  const { engine, code, slot, isHost, name, look } = opts;
  const unsubs: (() => void)[] = [];

  engine.mp = true;
  engine.mpHost = isHost;
  engine.mpSlot = slot;
  engine.mpCode = code;
  engine.playerName = name;
  void look; // the player's own look is already baked into the engine

  /* ---------- seed remotes from the current lobby roster ---------- */
  const syncFromLobby = (players: LobbyPlayer[]) => {
    engine.syncRemotes(
      players.map((p) => ({ sid: p.sid, slot: p.slot, name: p.name, look: p.look })),
      net.mySid,
    );
  };
  if (net.lobby) syncFromLobby(net.lobby.players);
  unsubs.push(net.onLobby((l) => syncFromLobby(l.players)));

  /* ---------- publish our own survivor @12 Hz ---------- */
  net.startPublishing(() =>
    packState({
      slot,
      x: engine.drive ? engine.drive.x : engine.player.x,
      z: engine.drive ? engine.drive.z : engine.player.z,
      y: engine.player.y,
      yaw: engine.drive ? engine.drive.rot : engine.input.yaw,
      hp: engine.hp,
      sprint: engine.player.sprinting,
      air: engine.player.y > 0.12,
      beast: engine.youPossessed && engine.phase === "night",
      dead: engine.lost,
      drive: !!engine.drive,
      attack: engine.attackCd > 0.3, // just-swung window (ATTACK_CD = 0.45)
    }),
  );

  /* ---------- remote streams → engine.remotes ---------- */
  const streamTimer = setInterval(() => {
    engine.mpPing = net.ping;
    for (const r of engine.remotes) {
      const s = net.sampleRemote(r.slot);
      if (!s) continue;
      r.lastSeen = performance.now();
      const now = performance.now();
      const prev = lastRaw.get(r.slot) ?? { x: s.x, z: s.z, t: now };
      const dtms = Math.max(16, now - prev.t);
      r.vx = ((s.x - prev.x) / dtms) * 1000;
      r.vz = ((s.z - prev.z) / dtms) * 1000;
      lastRaw.set(r.slot, { x: s.x, z: s.z, t: now });
      r.x = s.x; r.z = s.z; r.y = s.y; r.face = s.yaw;
      r.hp = s.hp;
      r.alive = !s.dead;
      r.beast = s.beast || (r.beast && engine.phase === "night");
      r.drive = s.drive;
      r.sprint = s.sprint;
      r.air = s.air;
      if (s.attack) r.attackT = 0.35;
    }
  }, 80); // 12.5 Hz matches the stream rate

  /* ---------- reliable gameplay events ---------- */
  const on = <K extends MpEvent["t"]>(t: K, h: (ev: Extract<MpEvent, { t: K }>, from: number) => void) =>
    unsubs.push(net.on(t, h as (ev: MpEvent, from: number) => void));

  on("roster", (ev) => engine.applyRoster(ev.possessed, ev.beastSlots));

  on("phase", (ev, from) => {
    if (isHost || from !== 0) return; // only the host's clock speaks (slot 0 = host)
    const ph = ev.phase as typeof engine.phase;
    if (engine.phase !== ph) {
      engine.phase = ph;
      engine.phaseT = ev.phaseLeft;
      // a phase jump must land with its side effects (our local machine missed them)
      if (ph === "night") {
        for (const idx of engine.possessed) {
          const c = engine.crew[idx];
          if (c && c.alive) { c.mode = "possessed"; c.hp = 70; }
        }
      } else if (ph === "day" || ph === "dawn") {
        for (const c of engine.crew) if (c.mode === "possessed") c.mode = "hide";
        engine.possessed = [];
        engine.youPossessed = false;
        engine.mpBeastSlots = [];
        for (const r of engine.remotes) r.beast = false;
      }
      engine.nightNo = ev.nightNo;
    } else {
      if (Math.abs(engine.phaseT - ev.phaseLeft) > 1.5) engine.phaseT = ev.phaseLeft;
      if (engine.nightNo !== ev.nightNo) engine.nightNo = ev.nightNo;
    }
  });

  on("crewDeath", (ev) => engine.netCrewDeath(ev.idx, ev.clue, ev.slain, ev.loot));

  on("dmg", (ev) => {
    if (ev.target === slot) engine.netTakeDmg(ev.amount);
  });

  on("claw", (ev) => engine.netClawHit(ev.x, ev.z));

  on("loot", (ev) => {
    engine.loot.push({
      id: Math.floor(Math.random() * 1e9), // local id only — pickups match by position
      x: ev.x, z: ev.z, amt: Math.round(ev.amt), label: ev.label, bob: Math.random() * 6,
    });
  });

  on("pickup", (ev) => engine.netPickup(ev.kind, ev.id, ev.x, ev.z));

  on("build", (ev) => engine.netBuild(ev.kind, ev.x, ev.z, ev.rot));

  on("score", (ev, from) => {
    const r = engine.remotes.find((x) => x.slot === from);
    if (r) { r.points = ev.points; r.kills = ev.kills; r.money = ev.money; }
  });

  on("dead", (_ev, from) => {
    const r = engine.remotes.find((x) => x.slot === from);
    if (r && r.alive) {
      r.alive = false;
      engine.toast(`🩸 ${r.name}'s light went out on night ${engine.nightNo}…`, "bad");
    }
  });

  // 🪪🤝 a teammate handed their driving license across the table — only the
  // targeted survivor pockets it (the event broadcasts to the whole room)
  on("gift", (ev) => {
    if (ev.kind === "license" && ev.toSlot === slot) engine.receiveLicense(ev.from);
  });

  on("hello", (_ev, from) => {
    const r = engine.remotes.find((x) => x.slot === from);
    if (r) engine.toast(`🌐 ${r.name} is back in town!`, "good");
  });

  on("reset", () => {
    if (!isHost) opts.onReset();
  });

  /* ---------- periodic duties: story clock (host) + score (everyone) ---------- */
  let acc = 0;
  const slowTimer = setInterval(() => {
    if (!engine.running) return;
    acc += 0.5;
    if (acc < 5) return;
    acc = 0;
    net.send({ t: "score", points: engine.points, kills: engine.kills, money: engine.money });
    if (isHost) {
      net.send({ t: "phase", phase: engine.phase, nightNo: engine.nightNo, phaseLeft: Math.max(0, Math.round(engine.phaseT)) });
    }
  }, 500);
  // host keeps a tight 2 Hz clock so guest transitions never drift far
  const phaseTimer = setInterval(() => {
    if (!isHost || !engine.running) return;
    net.send({ t: "phase", phase: engine.phase, nightNo: engine.nightNo, phaseLeft: Math.max(0, Math.round(engine.phaseT)) });
  }, 500);

  /* ---------- our death → tell the room ---------- */
  let ended = false;
  const endWatcher = setInterval(() => {
    if (engine.lost && !ended) {
      ended = true;
      net.send({ t: "dead" });
      opts.onSelfDead?.();
    }
  }, 600);

  /* ---------- wire the engine's emit hook ---------- */
  engine.netEmit = (ev) => net.send(ev);

  return {
    detach() {
      for (const u of unsubs) u();
      clearInterval(streamTimer);
      clearInterval(slowTimer);
      clearInterval(phaseTimer);
      clearInterval(endWatcher);
      net.stopPublishing();
      engine.netEmit = null;
      engine.netTick = null;
      engine.mp = false;
      engine.remotes = [];
      lastRaw.clear();
    },
  };
}
