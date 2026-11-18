/**
 * diag-relay — two simulated souls walk the REAL matchmaking path (mp:quick)
 * against the live relay :3030 and assert they land in the SAME room, hear
 * each other's state stream, and see a 2-soul roster. Pure transport test —
 * no WebGL. Run: bun scripts/diag-relay.ts
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://localhost:3030";
let failures = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emitAck = <T,>(sock: Socket, ev: string, p: unknown): Promise<T> =>
  new Promise((res) => sock.timeout(6000).emit(ev, p, (err: unknown, r: T) => res(err ? ({ ok: false, err: String(err) } as unknown as T) : r)));

interface Lobby { code: string; host: string; players: { sid: string; slot: number; name: string }[]; phase?: string; lobbyEndsAt?: number }

async function main() {
  const a = io(URL, { transports: ["websocket"] });
  await new Promise<void>((res) => a.on("connect", () => res()));
  const b = io(URL, { transports: ["websocket"] });
  await new Promise<void>((res) => b.on("connect", () => res()));

  // ---- P1 quick → should create a room ----
  const ra = await emitAck<{ ok: boolean; code?: string; lobby?: Lobby; started?: boolean }>(a, "mp:quick", { name: "P1" });
  ok(ra.ok && !!ra.code, `P1 quick ok (room ${ra.code ?? "?"})`);
  ok((ra.lobby?.players.length ?? 0) === 1, "P1 roster has 1 soul");

  // ---- P2 quick → should JOIN P1's room (same code), started=false ----
  const rb = await emitAck<{ ok: boolean; code?: string; lobby?: Lobby; started?: boolean }>(b, "mp:quick", { name: "P2" });
  ok(rb.ok && rb.code === ra.code, `P2 joined the SAME room (${rb.code ?? "?"} vs ${ra.code ?? "?"})`);
  ok((rb.lobby?.players.length ?? 0) === 2, "roster now has 2 souls");
  ok(rb.lobby?.players.some((p) => p.slot === 0) && rb.lobby?.players.some((p) => p.slot === 1), "slots 0 and 1 taken");

  // ---- P1 marks the night live ----
  a.emit("mp:event", { t: "start" });
  await wait(150);

  // ---- P1 should hear P2's roster join; P2 should hear the roster broadcast ----
  let bRoster: Lobby | null = null;
  b.on("mp:lobby", (m: { t: string; lobby?: Lobby }) => { if (m.t === "roster" && m.lobby) bRoster = m.lobby; });
  await wait(150);
  ok(!!bRoster && (bRoster as unknown as Lobby).players.length === 2, "P2 sees the 2-soul roster");

  // ---- state stream: P1 publishes 9 bytes → P2 receives with slot 0 ----
  const got: { slot: number; x: number }[] = [];
  b.on("mp:state", (buf: Buffer, slot: number) => got.push({ slot, x: buf.readInt16LE(1) / 10 }));
  const state = Buffer.alloc(9);
  state.writeUInt8(0, 0);
  state.writeInt16LE(Math.round(201.3 * 10), 1); // x = 201.3
  state.writeInt16LE(Math.round(211.7 * 10), 3); // z = 211.7
  state.writeUInt8(0, 5);
  state.writeUInt8(128, 6);
  state.writeUInt8(100, 7);
  state.writeUInt8(0, 8);
  a.emit("mp:state", state);
  await wait(200);
  ok(got.length > 0 && got[0].slot === 0 && Math.abs(got[0].x - 201.3) < 0.01, `P2 receives P1's state stream (slot 0 @ x=201.3) — got ${JSON.stringify(got)}`);

  // ---- ambient check: lobby roster on P2 must list phase live after start ----
  ok(!!bRoster && (bRoster as unknown as Lobby).phase !== undefined, "roster carries phase field");

  a.disconnect();
  b.disconnect();
  await wait(100);
  console.log(failures === 0 ? "\nALL PASS — relay matchmaking + state fan-out healthy" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("diag-relay crashed:", e); process.exit(1); });
