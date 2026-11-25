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
import { mulberry32 } from "../rng";
import { AIKIND_HOUND, AIKIND_HUNTER, AIKIND_ZOMBIE, AIKIND_CREW, CARIDX_NONE, packAi, packState, packCar, packDown, unpackDown, type AiEntry } from "./protocol";
import { net, sessionSeed, type LobbyPlayer, type MpEvent } from "./client";

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
  /** 🏟️ re-seed remote souls from the current roster (after a local engine reset) */
  resync: () => void;
}

const lastRaw = new Map<number, { x: number; z: number; t: number }>(); // slot → last raw sample (velocity estimate)
const slotCars = new Map<number, { ci: number; at: number }>(); // slot → their last streamed car (staleness bookkeeping)
const botCars = new Map<number, { at: number }>(); // 🤖 car idx → last bot-car packet (staleness bookkeeping)

export function attachNet(opts: AttachNetOpts): NetHandle {
  const { engine, code, name, look } = opts;
  let slot = opts.slot; // mutable — a mid-game rejoin can reseat us
  let isHost = opts.isHost; // mutable — host migration can crown us mid-run
  const unsubs: (() => void)[] = [];

  // 🛡️ a seat can only ever ride a SESSION-seeded engine. An engine booted
  // before the relay answered (solo fallback) carries a RANDOM private RNG
  // stream — its bots, loot, vote cards & plane schedule would differ from
  // every peer forever (the "same buildings, different vehicles" bug). Stamp
  // the session seed NOW so the boot's reset() rebuilds the world on the
  // shared stream; harmless (already-equal) on engines constructed with it.
  if (engine.rngSeed === undefined) {
    engine.rngSeed = sessionSeed(code);
    engine.rnd = mulberry32(2024 + (engine.rngSeed % 1000000));
    engine.trace(`🌐 seat attached to a solo-built engine — world re-seeded to session seed of room ${code}`);
  }

  engine.mp = true;
  engine.mpHost = isHost;
  engine.mpSlot = slot;
  engine.mpCode = code;
  engine.playerName = name;
  engine.ambientMirror = false; // a fresh seat restarts the ambient mirror cleanly
  engine.applySeatSpawn(slot); // 🎲 pin our drop to the deterministic seat spot
  void look; // the player's own look is already baked into the engine

  // 🛡️ a reconnect reclaims our seat — possibly at a NEW slot: re-bind the
  // engine's identity and the publish stream live
  unsubs.push(net.onSlotChange((s) => { slot = s; engine.mpSlot = s; }));

  /* ---------- seed remotes from the current lobby roster ---------- */
  const syncFromLobby = (players: LobbyPlayer[]) => {
    engine.syncRemotes(
      players.map((p) => ({ sid: p.sid, slot: p.slot, name: p.name, look: p.look })),
      net.mySid,
    );
  };
  if (net.lobby) syncFromLobby(net.lobby.players);
  unsubs.push(net.onLobby((l) => {
    syncFromLobby(l.players);
    // 👑 host migration — the crown landed on OUR socket mid-run: take over the
    // AI truth + the ambient world (traffic clock & bot planes the old host's
    // stream froze) so the room keeps a live clock and a flying fleet.
    if (!isHost && l.host === net.mySid && engine.mp) {
      isHost = true;
      engine.mpHost = true;
      engine.resumeAmbientOwnership();
    }
  }));

  /* ---------- publish our own survivor @12 Hz ----------
   * 😦 THE FACING FIX — the old stream published `engine.input.yaw`, the
   * CAMERA heading. But a body rendered with rotation.y = θ faces (sin θ,
   * cos θ), while the camera yaw convention has forward = (−sin yaw, −cos yaw)
   * — a 180° flip! Every peer's screen showed each soul facing EXACTLY
   * AWAY from where they looked: stand face-to-face and the other player
   * appears reversed. We now publish the BODY's real facing (player.face —
   * the same value the local renderer turns the hero with), so what you see
   * on your screen is what every peer sees. Driving/riding publishes the
   * vehicle heading (the body glues to it anyway). */
  net.startPublishing(() =>
    packState({
      slot,
      x: engine.drive ? engine.drive.x : engine.player.x,
      z: engine.drive ? engine.drive.z : engine.player.z,
      y: engine.player.y,
      yaw: engine.drive ? engine.drive.rot
        : engine.ride ? engine.world.cars[engine.ride.ci]?.rot ?? engine.player.face
        : engine.player.face,
      hp: engine.hp,
      sprint: engine.player.sprinting,
      air: engine.player.y > 0.12,
      beast: engine.youPossessed && engine.phase === "night",
      dead: engine.lost,
      drive: !!engine.drive,
      ride: !!engine.ride, // 🚗 riding shotgun in someone else's car
      attack: engine.attackCd > 0.3, // just-swung window (ATTACK_CD = 0.45)
      // ⏸ personal pause — our world keeps living, our body stands still; peers
      // swap the name tag for a ⏸ one so the frozen survivor reads as AFK,
      // never as a laggy ghost or a disconnected soul
      paused: engine.personalPause && !engine.lost,
      // 🚗 WHICH car we occupy — peers seat us on the open-top styles and
      // glue us to the exact vehicle instead of guessing
      ci: engine.drive ? engine.drive.ci : engine.ride ? engine.ride.ci : CARIDX_NONE,
      // 🥊 our floored/get-up clock — a rival's punch that FLOORS us plays the
      // fall + push-off on every peer's screen, not just our own
      down: packDown(engine.downT, engine.getupT),
    }),
  );

  /* ---------- 🚗 publish our driven car @15 Hz (pose + headlights) ----------
   * The deterministic world makes the car INDEX mean the same vehicle on every
   * client, so 8 bytes of pose are enough — every peer re-renders the exact
   * body, colliders, wheels & blazing lamps in real time. The light flag is
   * the driver's REAL headlamp state (L toggles it) — never a hardcoded lie.
   * On foot → no packet. */
  net.startCarPublishing(() => {
    const d = engine.drive;
    if (!d) return null;
    return packCar({ ci: d.ci, x: d.x, z: d.z, rot: d.rot, lights: d.lights !== false });
  });

  /* ---------- 🤖 publish our BOT joyriders @15 Hz (host only) ----------
   * The host's crew cars are the shared truth now — every bot behind the
   * wheel streams the same 8-byte pose packet the real drivers use (on the
   * dedicated `mp:botcar` channel, keyed by the deterministic car index), so
   * every peer sees the town's taxis & vans roaming on their own. */
  const botCarTimer = setInterval(() => {
    if (!isHost || !engine.running || !net.sockConnected) return;
    for (const c of engine.crew) {
      if (!c.alive || !c.drive) continue;
      const d = c.drive;
      net.emitBotCar(packCar({ ci: d.ci, x: d.x, z: d.z, rot: d.rot, lights: d.lights !== false }));
    }
  }, 66); // ~15 Hz

  /* ---------- 🧟 AI replication — host publishes, guests mirror ----------
   * The night's horde is ONE shared drama: the host's simulation is the truth
   * (it already hunts real players and streams the damage), and every guest
   * mirrors its zombies / possessed hunters / zombie hounds from these 12 Hz
   * packets instead of running a private RNG night of their own. The timer
   * runs on EVERY seat but only the current host emits — a host migration
   * (crown lands on our socket mid-run) starts publishing automatically. */
  const aiTimer = setInterval(() => {
    if (!isHost || !engine.running || !net.sockConnected) return;
    // zombies — array indices are deterministic (same roster on every client)
    const zombies: AiEntry[] = engine.zombies.map((zb, idx) => ({
      idx, x: zb.x, z: zb.z, yaw: zb.face, dead: !!zb.dead, atk: false,
    }));
    const zb = packAi(AIKIND_ZOMBIE, zombies);
    if (zb) net.emitAi(zb);
    // possessed hunters — the night's stalking beasts
    const hunters: AiEntry[] = [];
    for (const idx of engine.possessed) {
      const c = engine.crew[idx];
      if (!c || !c.alive) continue;
      hunters.push({ idx, x: c.x, z: c.z, yaw: c.face, dead: false, atk: c.attackAnimT > 0 });
    }
    const hu = packAi(AIKIND_HUNTER, hunters);
    if (hu) net.emitAi(hu);
    // zombie hounds — the turned strays (animals with the rot)
    const hounds: AiEntry[] = [];
    engine.animals.forEach((an, idx) => {
      if (!an.zombie) return;
      hounds.push({ idx, x: an.x, z: an.z, yaw: an.face, dead: !!an.dead, atk: false });
    });
    const ho = packAi(AIKIND_HOUND, hounds);
    if (ho) net.emitAi(ho);
    // 🤖 the crew contestants — the host's bot town is the shared truth.
    // Possessed bots stream as hunters (skip them here); replaced/dead souls
    // are known via the roster + crewDeath events and never stream.
    const crew: AiEntry[] = [];
    engine.crew.forEach((c, idx) => {
      if (!c.alive || c.mode === "possessed") return;
      crew.push({ idx, x: c.x, z: c.z, yaw: c.face, dead: false, atk: c.attackAnimT > 0 });
    });
    const cr = packAi(AIKIND_CREW, crew);
    if (cr) net.emitAi(cr);
  }, 84); // ~12 Hz — the horde shambles, this is plenty

  /* ---------- remote streams → engine.remotes ---------- */
  const streamTimer = setInterval(() => {
    engine.mpPing = net.ping;
    const now = performance.now();
    for (const r of engine.remotes) {
      const s = net.sampleRemote(r.slot);
      if (!s) continue;
      r.lastSeen = now;
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
      r.ride = s.ride;
      r.sprint = s.sprint;
      r.air = s.air;
      // 🚗 WHICH car they occupy — the seat index rides the state packet, so
      // peers can sit them in the exact vehicle (open-top styles render the
      // body glued to its seat instead of vanishing)
      r.carCi = s.ci !== CARIDX_NONE && s.ci !== undefined ? s.ci : undefined;
      r.paused = s.paused && !s.dead; // a dead soul isn't "paused", they're gone
      if (s.attack) r.attackT = 0.35;
      // 🥊 their floored/get-up clock — the renderer plays the fall + push-off
      // choreography on their mirrored body (same clocks the local body uses)
      const dn = unpackDown(s.down);
      r.downT = dn.downT;
      r.getupT = dn.getupT;
      // 🚗 their car stream — mirror pose + headlights so the vehicle MOVES on
      // our world (and its lamps BLAZE at night) exactly like it does on theirs.
      // Only FRESH packets keep the mirror alive — a driver who parked lets the
      // car settle here and its lamps fold off via the sweep. The window is
      // generous (2.5 s @15 Hz ≈ 37 missed packets): a busy main thread (heavy
      // scene, GC pause, throttled tab) delays arrivals well past a second, and
      // the old 1.2 s window kept DROPPING the mirror mid-drive — the car sat
      // parked with dead lights while its driver was still streaming (the
      // "their headlights show off" bug), then popped back a beat later.
      const cs = net.sampleCar(r.slot);
      if (cs && now - cs.t < 2500) {
        slotCars.set(r.slot, { ci: cs.ci, at: now });
        engine.netRemoteCar(cs.ci, cs.x, cs.z, cs.rot, cs.lights);
      }
    }
    // a driver who parked (no more car packets) leaves their car parked here —
    // lamps fold off; passengers it carried are set back on their feet
    for (const [sl, e] of Array.from(slotCars)) {
      if (now - e.at > 3000) {
        engine.netRemoteCarStop(e.ci);
        slotCars.delete(sl);
      }
    }
    // 🧟 guests mirror the host's horde — one apply per kind, ~12.5 Hz
    if (!isHost) {
      const zb = net.sampleAi(AIKIND_ZOMBIE);
      if (zb) engine.applyNetAi(AIKIND_ZOMBIE, zb);
      const hu = net.sampleAi(AIKIND_HUNTER);
      if (hu) engine.applyNetAi(AIKIND_HUNTER, hu);
      const ho = net.sampleAi(AIKIND_HOUND);
      if (ho) engine.applyNetAi(AIKIND_HOUND, ho);
      const cr = net.sampleAi(AIKIND_CREW);
      if (cr) engine.applyNetAi(AIKIND_CREW, cr);
      // 🤖 bot joyrider cars — mirror pose + lamps for the host's fleet.
      // A car the LOCAL player is driving is never mirrored (their own
      // physics is the truth; a host bot grabbing "their" car on the host's
      // world must not yank the player out of the driver's seat here).
      const nowB = performance.now();
      for (const cs of net.allBotCars()) {
        if (engine.drive?.ci === cs.ci) { botCars.delete(cs.ci); continue; }
        if (nowB - cs.t < 2500) {
          botCars.set(cs.ci, { at: nowB });
          engine.netRemoteCar(cs.ci, cs.x, cs.z, cs.rot, cs.lights);
        }
      }
      for (const [ci, e] of Array.from(botCars)) {
        if (nowB - e.at > 3000) {
          engine.netRemoteCarStop(ci);
          botCars.delete(ci);
        }
      }
    }
  }, 80); // 12.5 Hz matches the stream rate

  /* ---------- reliable gameplay events ---------- */
  const on = <K extends MpEvent["t"]>(t: K, h: (ev: Extract<MpEvent, { t: K }>, from: number) => void) =>
    unsubs.push(net.on(t, h as (ev: MpEvent, from: number) => void));

  on("roster", (ev) => engine.applyRoster(ev.possessed, ev.beastSlots));

  // 🧱 THE WALL — the host's dawn shrink lands here the moment it fires: the
  // same circle, the same second, on every seat. Guests never self-shrink.
  on("zone", (ev) => engine.applyNetZone(ev.level, ev.nightNo));

  on("phase", (ev, from) => {
    if (isHost) return; // we own the clock
    // only the host's clock speaks — resolve the host's slot LIVE (host
    // migration after a disconnect can move the crown past slot 0)
    const hostSlot = net.lobby?.players.find((p) => p.sid === net.lobby?.host)?.slot ?? 0;
    if (from !== hostSlot) return;
    // 🕐 stamp the freshest host word — the story clock's hold-at-the-boundary
    // guard reads this (a stale stamp = the host's tab froze; never cross a
    // transition on our own)
    engine.netPhaseAt = performance.now();
    const ph = ev.phase as typeof engine.phase;
    if (engine.phase !== ph) {
      engine.phase = ph;
      engine.phaseT = ev.phaseLeft;
      // 🕐 a mid-night join must land on the host's SKY too — without the clock
      // sync a guest dropping into night 4 stares at day-1 morning light while
      // the roster hunts in the dark. Snap when the drift is big, ease when small.
      // Clock is time-of-day 0..1 (it WRAPS at midnight) — take the shortest
      // path around the circle, and snap past ⅓ of a day. The old `|dc| > 3`
      // threshold could NEVER fire (max diff is 1), so joiners EASED through
      // noon for ~10 s — their lamps rendered day-plain while the night raged.
      if (ev.clock !== undefined) {
        let dc = ev.clock - engine.clock;
        dc = ((dc + 0.5) % 1 + 1) % 1 - 0.5; // shortest path across midnight
        if (Math.abs(dc) > 0.34) engine.clock = (engine.clock + dc + 1) % 1;
        else engine.clock = (engine.clock + dc * 0.25 + 1) % 1;
      }
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
      // gentle clock drift-correction keeps every client's sky on the same beat
      // (shortest path around the wrap, same ⅓-day snap rule as above)
      if (ev.clock !== undefined) {
        let dc = ev.clock - engine.clock;
        dc = ((dc + 0.5) % 1 + 1) % 1 - 0.5;
        engine.clock = Math.abs(dc) > 0.34
          ? (engine.clock + dc + 1) % 1
          : (engine.clock + dc * 0.15 + 1) % 1;
      }
    }
    // 🧱 the wall level rides every clock packet — the reliable `zone` event is
    // the fast path, this is the catch-up that re-arms anyone who missed it
    // (packet loss) or joined mid-match with no dawns of their own
    if (ev.zone !== undefined) engine.applyNetZone(ev.zone, ev.nightNo);
    // ⚰️ the hearse state rides along too — a mid-run joiner never re-fights
    // a guardian pack that was broken before they dropped in
    if (ev.hu) engine.netHearseUnlockCatchUp();
    // 🌐✈️ ambient mirror — snap traffic angles + the bot-plane fleet onto the
    // host's truth (guest-side; the host's own sim IS the truth)
    if (ev.amb) engine.applyNetAmbient(ev.amb);
  });

  on("crewDeath", (ev) => engine.netCrewDeath(ev.idx, ev.clue, ev.slain, ev.loot));

  on("dmg", (ev, from) => {
    if (ev.target === slot) engine.netTakeDmg(ev.amount, ev.x, ev.z, ev.pvp === true, ev.from, from);
  });
  // 🥊 the victim's client announces WHO floored them for good — the killer's
  // HUD scores it exactly like a bot kill (points, kills, finisher, toast)
  on("pvpkill", (ev) => {
    if (ev.toSlot === slot) engine.netPvpKill(ev.from);
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

  // 🗡️ a teammate's swing connected with the horde — the HOST'S hp is the truth
  on("zhit", (ev) => {
    if (!isHost) return; // guests get the verdict via the AI stream's dead flag
    engine.netZombieHit(ev.kind, ev.idx, ev.amt);
  });

  // 📦🪪 a teammate DROPPED their license on the ground — spawn the card here
  // so everyone can race over and snatch it
  on("dropLicense", (ev) => engine.spawnDroppedLicense(ev.x, ev.z, ev.from));

  // ⚰️🚗 a teammate broke the phantom hearse's guardian pack — the unlock is
  // WORLD truth: every licensed soul can now walk up and drive (or steal) it
  // without fighting a pack that's already dust
  on("hearseUnlock", (ev) => engine.netHearseUnlock(ev.from));

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
      net.send({ t: "phase", phase: engine.phase, nightNo: engine.nightNo, phaseLeft: Math.max(0, Math.round(engine.phaseT)), clock: Math.round(engine.clock * 100) / 100, zone: engine.zoneLevel, hu: engine.hearseUnlocked });
    }
  }, 500);
  // host keeps a tight 2 Hz clock so guest transitions never drift far
  const phaseTimer = setInterval(() => {
    if (!isHost || !engine.running) return;
    // 🌐✈️ ride the ambient-world snapshot along with the clock — ring-traffic
    // angles + the bot-plane fleet pose, so every guest's screen shows the SAME
    // vehicles in the SAME places (only streamed when someone else is listening)
    const amb = net.lobby && net.lobby.players.length > 1
      ? {
          tr: engine.traffic.map((t) => Math.round(t.a * 1000) / 1000),
          pl: engine.planes.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, Math.round(p.alt * 10) / 10, Math.round(p.hdg * 1000) / 1000]),
        }
      : undefined;
    net.send({ t: "phase", phase: engine.phase, nightNo: engine.nightNo, phaseLeft: Math.max(0, Math.round(engine.phaseT)), clock: Math.round(engine.clock * 100) / 100, zone: engine.zoneLevel, hu: engine.hearseUnlocked, amb });
    // 🌐 the possession roster rides along at night — a mid-night quick-joiner
    // lands with NO local dusk (they never ran choosePossessed), so unless the
    // roster arrives on a timer they'd stare at an empty, zombie-less night
    if (engine.phase === "night") {
      net.send({ t: "roster", possessed: [...engine.possessed], beastSlots: [...engine.mpBeastSlots], nightNo: engine.nightNo });
    }
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
    /** 🏟️ re-seed the remote roster (engine.reset doesn't re-run attachNet —
     *  after a restart-together the host re-syncs souls from the lobby) */
    resync() {
      if (net.lobby) syncFromLobby(net.lobby.players);
    },
    detach() {
      for (const u of unsubs) u();
      clearInterval(streamTimer);
      clearInterval(slowTimer);
      clearInterval(phaseTimer);
      clearInterval(endWatcher);
      clearInterval(aiTimer);
      clearInterval(botCarTimer);
      net.stopPublishing();
      net.stopCarPublishing();
      engine.netEmit = null;
      engine.netTick = null;
      engine.mp = false;
      engine.remotes = [];
      engine.remoteDriven.clear();
      engine.netCrewMirror = false;
      engine.netPhaseAt = 0;
      lastRaw.clear();
      slotCars.clear();
      botCars.clear();
    },
  };
}
