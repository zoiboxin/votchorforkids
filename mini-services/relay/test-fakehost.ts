/**
 * Fake-host harness — a scripted HOST peer for diagnosing the guest sync path.
 *
 * Creates a room, marks it live, then streams the story clock exactly the way
 * the real host does (2 Hz `phase` events with phase/clock/phaseLeft/nightNo).
 * Run it, join the printed code from a browser, and compare the guest's
 * engine.clock / phase against the values this script publishes.
 *
 *   bun mini-services/relay/test-fakehost.ts [--speed 4] [--night]
 *
 * A state stream (walking survivor + a driven car) is also published so the
 * facing / passenger-visibility fixes can be verified visually.
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://localhost:3030";
const argv = process.argv.slice(2);
const argOf = (k: string, d: string) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : Number(d);
};
const SPEED = argOf("--speed", "3"); // phase-time multiplier (3 = 3× fast clock)
const START_NIGHT = argv.includes("--night"); // begin mid-night (join-snap test)

const PHASES = { day: 24, dusk: 10, night: 20, dawn: 10 } as const;
type Phase = keyof typeof PHASES;

const sock: Socket = io(URL, { transports: ["websocket"] });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const packState = (slot: number, x: number, z: number, yaw: number, flags: number, ci = 0xffff) => {
  const b = Buffer.alloc(11);
  b.writeUInt8(slot, 0);
  b.writeInt16LE(Math.round(Math.max(-3276, Math.min(3276, x)) * 10), 1);
  b.writeInt16LE(Math.round(Math.max(-3276, Math.min(3276, z)) * 10), 3);
  b.writeUInt8(0, 5); // y = 0
  b.writeUInt8(Math.round(((yaw % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 255), 6);
  b.writeUInt8(90, 7); // hp
  b.writeUInt8(flags, 8);
  b.writeUInt16LE(ci, 9);
  return b;
};
const packCar = (ci: number, x: number, z: number, rot: number, lights: boolean) => {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(ci, 0);
  b.writeInt16LE(Math.round(x * 10), 2);
  b.writeInt16LE(Math.round(z * 10), 4);
  b.writeUInt8(Math.round(((rot % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 255), 6);
  b.writeUInt8(lights ? 1 : 0, 7);
  return b;
};

/** engine-style clock synthesis: day .30 · dusk slide .46→.74 · night .80 · dawn .30→.74 */
function clockFor(phase: Phase, phaseT: number): number {
  const T = PHASES[phase];
  if (phase === "day") return 0.3;
  if (phase === "night") return 0.8;
  if (phase === "dusk") return 0.46 + (1 - Math.max(0, phaseT) / T) * 0.28;
  return 0.3 + (Math.max(0, phaseT) / T) * 0.44; // dawn
}

async function main() {
  await wait(400);
  const created = await new Promise<{ ok: boolean; code?: string; err?: string }>((res) =>
    sock.emit("mp:create", { name: "FakeHost", look: { fac: "survivor", shirt: "#ff8800" } }, res),
  );
  if (!created.ok || !created.code) { console.error("create failed", created); process.exit(1); }
  console.log(`ROOM CODE: ${created.code}`);
  sock.emit("mp:event", { t: "start" }); // mark the session LIVE so joiners auto-launch
  // re-arm the launch backstop every 3 s — late joiners catch the next one
  // (the real host sends it once, but a live-room joiner can arrive after that)
  const startTimer = setInterval(() => sock.emit("mp:event", { t: "start" }), 3000);

  await wait(600);

  // story clock state
  let phase: Phase = START_NIGHT ? "night" : "day";
  let nightNo = START_NIGHT ? 3 : 1;
  let phaseT = START_NIGHT ? PHASES.night : PHASES.day;

  const phaseTimer = setInterval(() => {
    phaseT -= 0.5 * SPEED;
    if (phaseT <= 0) {
      const order: Phase[] = ["day", "dusk", "night", "dawn"];
      const next = order[(order.indexOf(phase) + 1) % 4];
      if (phase === "dawn" && next === "day") nightNo++;
      phase = next;
      phaseT = PHASES[next];
      console.log(`[fakehost] → ${phase} (night ${nightNo})`);
    }
    sock.emit("mp:event", {
      t: "phase",
      phase,
      nightNo,
      phaseLeft: Math.max(0, Math.round(phaseT)),
      clock: Math.round(clockFor(phase, phaseT) * 100) / 100,
    });
  }, 500);

  // a walking survivor at slot 0 (the host itself) + its driven car, 12/15 Hz
  // + a second fake soul RIDING shotgun in that car + one bot joyrider car.
  // Together they exercise: facing convention, driver seat, passenger seat,
  // and the mp:botcar mirror — the exact fixes under test.
  const rider: Socket = io(URL, { transports: ["websocket"] });
  await wait(300);
  const joined = await new Promise<{ ok: boolean; err?: string }>((res) =>
    rider.emit("mp:join", { code: created.code, name: "FakeRider", look: { fac: "protester", shirt: "#22cc88" } }, (r: { ok: boolean; err?: string }) => res(r)),
  );
  if (!joined.ok) console.error("rider join failed", joined);

  let t = 0;
  // --freeze: park the convertible at a fixed pose so a human camera can walk
  // up and inspect the seats (driver + passenger bodies glued to the car)
  const FROZEN = argv.includes("--freeze");
  const walkTimer = setInterval(() => {
    if (!FROZEN) t += 0.083;
    // ---- slot 0: drives a CONVERTIBLE (car 61 → t7 CONVERTIBLE) ----
    const cx = FROZEN ? 8 : Math.sin(t * 0.22) * 14;
    const cz = FROZEN ? 8 : Math.cos(t * 0.22) * 14;
    const rot = FROZEN ? 0.9 : t * 0.4;
    sock.emit("mp:state", packState(0, cx, cz, rot, 1 << 4, 61)); // drive flag + car 13
    sock.emit("mp:car", packCar(61, cx, cz, rot, true));
    // ---- slot 1: rides shotgun in the same convertible ----
    rider.emit("mp:state", packState(1, cx, cz, rot, 1 << 6, 61));
    // ---- one bot joyrider on mp:botcar (car 1 → t5 JEEP, glass all round) ----
    const bx = FROZEN ? -10 : Math.sin(t * 0.11) * 30;
    const bz = FROZEN ? -6 : Math.cos(t * 0.11) * 30;
    sock.emit("mp:botcar", packCar(1, bx, bz, FROZEN ? 2.2 : t * 0.4, true));

    // ---- 🤖 crew AI stream (AIKIND_CREW=3) — three bots marching a ring ----
    // Exercises the host-authoritative crew mirror: once these land, the guest
    // parks its private bot brains and renders the streamed truth.
    const crewBuf = Buffer.alloc(2 + 3 * 7);
    crewBuf.writeUInt8(3, 0); // AIKIND_CREW
    crewBuf.writeUInt8(3, 1); // count
    for (let k = 0; k < 3; k++) {
      const o = 2 + k * 7;
      const ang = (FROZEN ? k * 2.1 : t * 0.5 + k * 2.1);
      crewBuf.writeUInt8(k, o);
      crewBuf.writeInt16LE(Math.round(Math.cos(ang) * 10 * 10), o + 1);
      crewBuf.writeInt16LE(Math.round(Math.sin(ang) * 10 * 10), o + 3);
      crewBuf.writeUInt8(Math.round(((ang + Math.PI / 2) % (Math.PI * 2)) / (Math.PI * 2) * 255), o + 5); // face travel dir
      crewBuf.writeUInt8(0, o + 6); // alive, no attack
    }
    sock.emit("mp:ai", crewBuf);
  }, 83);

  setInterval(() => {
    console.log(`[fakehost] phase=${phase} night=${nightNo} phaseT=${phaseT.toFixed(1)} clock=${clockFor(phase, phaseT).toFixed(2)}`);
  }, 5000);

  process.on("SIGINT", () => { clearInterval(phaseTimer); clearInterval(walkTimer); clearInterval(startTimer); sock.disconnect(); rider.disconnect(); process.exit(0); });
  console.log("streaming… (Ctrl+C to stop)");
}

main().catch((e) => { console.error(e); process.exit(1); });
