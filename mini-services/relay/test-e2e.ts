/**
 * Relay end-to-end test — simulates a host and a guest client.
 * Validates: create → join → roster broadcasts → binary state streams →
 * events → chat → disconnect. Run: bun mini-services/relay/test-e2e.ts
 */
import { io, type Socket } from "socket.io-client";

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
  const host = client();
  const guest = client();

  // collect every roster broadcast from the very start (no attach races)
  const hostRosters: { players: { name: string; ready: boolean; slot: number }[] }[] = [];
  const guestRosters: { players: unknown[] }[] = [];
  host.on("mp:lobby", (m: { lobby?: { players: { name: string; ready: boolean; slot: number }[] } }) => { if (m.lobby) hostRosters.push(m.lobby); });
  guest.on("mp:lobby", (m: { lobby?: { players: unknown[] } }) => { if (m.lobby) guestRosters.push(m.lobby); });

  await wait(300);

  /* create */
  const created = await new Promise<{ ok: boolean; code?: string; err?: string }>((res) =>
    host.emit("mp:create", { name: "HostHana", look: { shirt: "#f00" } }, res),
  );
  check("room created", created.ok && !!created.code && created.code?.length === 4, created.code ?? created.err);
  await wait(200);

  /* join */
  const joined = await new Promise<{ ok: boolean; lobby?: { players: unknown[] }; err?: string }>((res) =>
    guest.emit("mp:join", { code: created.code, name: "GuestGoro", look: { shirt: "#0f0" } }, res),
  );
  check("guest joined", joined.ok && (joined.lobby?.players?.length ?? 0) === 2);
  await wait(300);

  /* roster broadcast reached both */
  check("guest saw roster of 2", guestRosters.some((l) => l.players.length === 2));
  check("host saw roster of 2", hostRosters.some((l) => l.players.length === 2));

  /* ready + name updates */
  guest.emit("mp:ready", true);
  await wait(300);
  const goro = hostRosters.at(-1)?.players.find((p) => p.name === "GuestGoro");
  check("ready flag propagates", goro?.ready === true);

  /* binary state stream: host → guest */
  const gotState = new Promise<{ buf: Buffer; slot: number }>((res) =>
    guest.on("mp:state", (buf: Buffer, slot: number) => res({ buf, slot })),
  );
  const payload = Buffer.alloc(9);
  payload.writeUInt8(0, 0);           // slot 0
  payload.writeInt16LE(12345, 1);     // x = 123.45
  payload.writeInt16LE(-5432, 3);     // z = -54.32
  payload.writeUInt8(16, 5);          // y = 2
  payload.writeUInt8(128, 6);         // yaw ≈ π
  payload.writeUInt8(88, 7);          // hp
  payload.writeUInt8(0b000101, 8);    // sprint + drive
  host.emit("mp:state", payload);
  const st = await Promise.race([gotState, wait(1500).then(() => null)]);
  check("state stream relayed", !!st, st ? `${st.buf.readInt16LE(1) / 100},${st.buf.readInt16LE(3) / 100} slot=${st.slot}` : "timeout");

  /* events: guest → host (relay stamps sender slot) */
  const gotEv = new Promise<Record<string, unknown>>((res) => host.on("mp:event", (ev: Record<string, unknown>) => res(ev)));
  guest.emit("mp:event", { t: "claw", x: 10.5, z: -3 });
  const ev = await Promise.race([gotEv, wait(1500).then(() => null)]);
  check("event relayed + slot stamped", !!ev && ev.t === "claw" && ev.s === 1, ev ? `s=${ev.s}` : "timeout");

  /* chat */
  const gotChat = new Promise<{ name: string; msg: string }>((res) => host.on("mp:chat", (m: { name: string; msg: string }) => res(m)));
  guest.emit("mp:chat", "hello camp");
  const chat = await Promise.race([gotChat, wait(1500).then(() => null)]);
  check("chat relayed", !!chat && chat.msg === "hello camp", chat ? `${chat.name}: ${chat.msg}` : "timeout");

  /* ping ack */
  const pinged = await new Promise<{ t: number }>((res) => guest.timeout(800).emit("mp:ping", {}, (err: unknown, r: { t: number }) => { if (!err) res(r); }));
  check("ping ack", !!pinged?.t);

  /* disconnect cleanup — guest leaves, host sees roster of 1 */
  guest.disconnect();
  await wait(500);
  check("leave prunes roster", hostRosters.at(-1)?.players.length === 1);

  host.disconnect();
  console.log(failures === 0 ? "\n🎉 ALL RELAY TESTS PASSED" : `\n💥 ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
