/**
 * diag-car-driver — a headless fake soul that joins a relay room, streams
 * survivor state @12 Hz, then DRIVES a car far away via 8-byte mp:car packets
 * @15 Hz before "hopping out" (car stream stops, state stream continues).
 * The human browser session in the same room is the watcher: a healthy mirror
 * parks the car exactly where the fake driver left it — never back at spawn.
 * Run: bun scripts/diag-car-driver.ts [roomCode] [carIndex] [targetZ]
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://localhost:3030";
const ROOM = process.argv[2] ?? "";
const CAR = Number(process.argv[3] ?? 100);
const TARGET_Z = Number(process.argv[4] ?? -300);
const START_X = Number(process.argv[5] ?? 15);
const START_Z = Number(process.argv[6] ?? 5);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Lobby { code: string; host: string; players: { sid: string; slot: number; name: string }[]; phase?: string; started?: boolean }

async function main() {
  const sock: Socket = io(URL, { transports: ["websocket"] });
  await new Promise<void>((res) => sock.on("connect", () => res()));
  console.log("connected", sock.id);

  const emitAck = <T,>(ev: string, p: unknown): Promise<T> =>
    new Promise((res) => sock.timeout(6000).emit(ev, p, (err: unknown, r: T) => res(err ? ({ ok: false } as unknown as T) : r)));

  let seat: { ok: boolean; code?: string; started?: boolean; lobby?: Lobby } | undefined;
  if (ROOM) seat = await emitAck("mp:join", { code: ROOM, name: "FakeDriver" });
  if (!seat?.ok) seat = await emitAck("mp:quick", { name: "FakeDriver" });
  console.log("seat:", JSON.stringify({ ok: seat?.ok, code: seat?.code, started: seat?.started }));

  let slot = -1;
  sock.on("mp:lobby", (m: { t: string; lobby?: Lobby }) => {
    if (m.t === "roster" && m.lobby) {
      const me = m.lobby.players.find((p) => p.sid === sock.id);
      if (me) slot = me.slot;
    }
  });
  await wait(400);
  console.log("slot:", slot);

  // --- survivor state @12 Hz (on foot) ---
  const packState = (fx: number, fz: number, flags: number) => {
    const b = new ArrayBuffer(9);
    const v = new DataView(b);
    v.setUint8(0, Math.max(0, slot) & 0xff);
    v.setInt16(1, Math.round(Math.max(-3276, Math.min(3276, fx)) * 10), true);
    v.setInt16(3, Math.round(Math.max(-3276, Math.min(3276, fz)) * 10), true);
    v.setUint8(5, 0);            // y = 0
    v.setUint8(6, 128);          // yaw mid
    v.setUint8(7, 100);          // hp
    v.setUint8(8, flags);        // FLAG_DRIVE bit when behind the wheel
    return b;
  };

  let px = START_X + 3, pz = START_Z;
  const stateT = setInterval(() => sock.emit("mp:state", packState(px, pz, 0)), 84);
  await wait(1500);
  console.log("on-foot stream live — now driving car", CAR, "toward z =", TARGET_Z);

  // --- drive the car @15 Hz — 8-byte mp:car: ci u16 LE, x i16 LE, z i16 LE, rot u8, lights u8 ---
  let cz = START_Z;
  const carT = setInterval(() => {
    cz += (TARGET_Z - cz) * 0.02; // glide toward the target
    const b = new ArrayBuffer(8);
    const v = new DataView(b);
    v.setUint16(0, CAR, true);
    v.setInt16(2, Math.round(Math.max(-3276, Math.min(3276, START_X)) * 10), true);
    v.setInt16(4, Math.round(Math.max(-3276, Math.min(3276, cz)) * 10), true);
    v.setUint8(6, Math.round(((0 + Math.PI) / (Math.PI * 2)) * 255)); // rot = 0 → facing +z
    v.setUint8(7, 1); // lights on
    sock.emit("mp:car", b);
    // the driver's own state follows the car with the DRIVE flag up
    px = START_X; pz = cz;
  }, 66);
  await wait(12000);
  clearInterval(carT);
  console.log("driver hopped out at z =", Math.round(cz), "— car stream STOPS, state stream continues on foot");

  // --- on foot next to the parked car (the watcher's sweep window elapses) ---
  px = START_X + 2; pz = cz + 3;
  await wait(8000);
  clearInterval(stateT);
  console.log("done — watcher should see car", CAR, "parked at (x≈", START_X, ", z≈", Math.round(cz), ")");
  sock.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error("diag-car-driver crashed:", e); process.exit(1); });
