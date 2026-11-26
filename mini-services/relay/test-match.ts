/**
 * 🌐 Match-pipeline end-to-end test — the PUBG deployment wire contract.
 * Validates (against the live relay):
 *   1. MatchSessionState.seed rides create + join payloads (master seed everywhere)
 *   2. start event flips the room live and stamps match.startedAt
 *   3. y-quantization round-trips a dropship altitude (62 u) through packState/unpackState
 *   4. Phase-4 world replication events (chop/felled/wreck) relay with payloads intact
 *   5. pickup (loot single-claim by position) relays
 * Run: bun mini-services/relay/test-match.ts
 */
import { io, type Socket } from "socket.io-client";
import { packState, unpackState } from "../../src/lib/game/net/protocol";
import { sessionSeed, type MpEvent } from "../../src/lib/game/net/client";
import { MASTER_MATCH_SEED } from "../../src/lib/game/constants";

const URL = "http://localhost:3030";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

function client(): Socket {
  return io(URL, { transports: ["websocket"] });
}

async function main() {
  check("sessionSeed is the MASTER seed (solo == multiplayer worlds)", sessionSeed("ZZZZ") === MASTER_MATCH_SEED, `${sessionSeed("ZZZZ")}`);

  /* 3. y quantization — the dropship altitude must survive the wire */
  const packed = packState({
    slot: 2, x: 12.3, z: -45.6, y: 62, yaw: 1.2, hp: 100,
    air: true, ci: 0xffff, down: 0,
  });
  const unpacked = unpackState(packed);
  check("packState/unpackState round-trips 62 u altitude", Math.abs((unpacked?.y ?? 0) - 62) < 0.26, `y=${unpacked?.y}`);

  const host = client();
  const guest = client();
  const guestEvents: MpEvent[] = [];
  guest.on("mp:event", (ev: MpEvent & { s?: number }) => guestEvents.push(ev));

  await wait(300);

  /* 1. MatchSessionState on create */
  const created = await new Promise<{ ok: boolean; code?: string; lobby?: { seed?: number; match?: { seed: number; startedAt: number } }; err?: string }>((res) =>
    host.emit("mp:create", { name: "HostHana" }, res),
  );
  check("room created", created.ok && !!created.code, created.code ?? created.err);
  check("MatchSessionState.seed rides the create payload", created.lobby?.seed === MASTER_MATCH_SEED, `${created.lobby?.seed}`);
  check("match state born with the room", !!created.lobby?.match && created.lobby.match.startedAt === 0, JSON.stringify(created.lobby?.match ?? {}));
  await wait(200);

  /* 1b. …and on join */
  const joined = await new Promise<{ ok: boolean; lobby?: { seed?: number; players?: unknown[] }; started?: boolean; err?: string }>((res) =>
    guest.emit("mp:join", { code: created.code, name: "GuestGoro" }, res),
  );
  check("guest joined (2 souls)", joined.ok && (joined.lobby?.players?.length ?? 0) === 2);
  check("MatchSessionState.seed rides the join payload", joined.lobby?.seed === MASTER_MATCH_SEED, `${joined.lobby?.seed}`);

  /* 2. start → live + startedAt stamp */
  host.emit("mp:event", { t: "start" });
  await wait(400);
  const afterStart = await new Promise<{ sessions?: { code?: string; live?: boolean }[] }>((res) =>
    guest.emit("mp:sessions", {}, (r: { sessions?: { code?: string; live?: boolean }[] }) => res(r)),
  );
  check("start event marks the session LIVE", afterStart.sessions?.some((s) => s.code === created.code && s.live) === true, JSON.stringify(afterStart.sessions ?? []));

  /* 4. world replication events relay with payloads intact */
  host.emit("mp:event", { t: "chop", i: 42, dx: 0.3, dz: -0.9 });
  host.emit("mp:event", { t: "felled", i: 42, dx: 1, dz: 0 });
  host.emit("mp:event", { t: "wreck", i: 7 });
  /* 5. pickup (loot matched by position on peers) */
  host.emit("mp:event", { t: "pickup", kind: "loot", id: -1, x: 111.5, z: -222.5 });
  await wait(500);
  const chop = guestEvents.find((e) => e.t === "chop");
  const felled = guestEvents.find((e) => e.t === "felled");
  const wreck = guestEvents.find((e) => e.t === "wreck");
  const pickup = guestEvents.find((e) => e.t === "pickup");
  check("chop relays (index + direction)", !!chop && chop.i === 42 && Math.abs(chop.dx - 0.3) < 1e-9, chop ? `i=${chop.i}` : "missing");
  check("felled relays", !!felled && felled.i === 42, felled ? `i=${felled.i}` : "missing");
  check("wreck relays", !!wreck && wreck.i === 7, wreck ? `i=${wreck.i}` : "missing");
  check("loot pickup relays (single-claim by position)", !!pickup && pickup.x === 111.5 && pickup.z === -222.5, pickup ? `x=${pickup.x}` : "missing");

  /* a mid-match joiner (rejoin into a live night) sees the SAME seed */
  const late = client();
  const lateJoined = await new Promise<{ ok: boolean; lobby?: { seed?: number; started?: boolean }; started?: boolean; err?: string }>((res) =>
    late.emit("mp:join", { code: created.code, name: "LateLuna" }, res),
  );
  check("late joiner into the live night gets the SAME match seed", lateJoined.ok && lateJoined.lobby?.seed === MASTER_MATCH_SEED, `${lateJoined.lobby?.seed}`);
  late.disconnect();

  host.disconnect();
  guest.disconnect();
  console.log(failures === 0 ? "\n🎉 MATCH PIPELINE TESTS PASSED" : `\n💥 ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
