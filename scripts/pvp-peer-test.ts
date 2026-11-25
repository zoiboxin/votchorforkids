/**
 * PvP wire test — a scripted "Player B" that speaks the relay protocol like a
 * real client, so the full cross-wire loop can be verified without a second
 * WebGL session:
 *   1. join the room        (mp:join)
 *   2. publish B's state    (mp:state binary @12 Hz — parked at a fixed spot)
 *   3. listen for mp:event  → expects { t:"dmg", target: OUR slot, pvp:true, from:"Alice" }
 *      when the REAL player swings at our streamed position
 *   4. reply with a PvP dmg event targeting Alice's slot — her client must
 *      bleed, floor her at the first lethal blow (down byte streams 1..120)
 *      and the get-up byte (121..240) must follow
 */
import { io } from "socket.io-client";
import { unpackState } from "../src/lib/game/net/protocol";

const code = process.argv[2];
if (!code) { console.error("usage: bun scripts/pvp-peer-test.ts <ROOMCODE>"); process.exit(1); }

const sock = io("http://localhost:3030", { transports: ["websocket", "polling"], timeout: 8000 });

// B parks near the town centre; Alice will be teleported next to us
const B = { x: 40, z: 12, y: 0, yaw: 1.2, hp: 100 };
let mySlot = -1;
let aliceSlot = -1;
let dmgEvents = 0;
let downSeen = false, getupSeen = false, aliceHpLast = -1, aliceFloorHits = 0;

const enc = new TextEncoder();

function packB(): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  const v = new DataView(buf);
  v.setUint8(0, mySlot & 0xff);
  v.setInt16(1, Math.round(Math.max(-3276, Math.min(3276, B.x)) * 10), true);
  v.setInt16(3, Math.round(Math.max(-3276, Math.min(3276, B.z)) * 10), true);
  v.setUint8(5, Math.max(0, Math.min(25.5, B.y)) * 8 | 0);
  v.setUint8(6, Math.round(((B.yaw % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 255));
  v.setUint8(7, Math.max(0, Math.min(100, Math.round(B.hp))));
  v.setUint8(8, 0); // flags: on foot, alive
  v.setUint16(9, 0xffff, true); // ci — on foot
  v.setUint8(11, 0); // down — standing
  return buf;
}

sock.on("connect", () => {
  console.log("[peer] connected", sock.id);
  sock.timeout(8000).emit("mp:join", { code, name: "Bob", look: null }, (err: unknown, r: { ok: boolean; err?: string; lobby?: { players: { sid: string; slot: number; name: string }[] } }) => {
    if (err || !r?.ok) { console.error("[peer] join failed:", err, r?.err); process.exit(1); }
    const me = r.lobby!.players.find((p) => p.sid === sock.id);
    mySlot = me?.slot ?? -1;
    console.log(`[peer] joined room ${code} at slot ${mySlot}; roster:`, r.lobby!.players.map((p) => `${p.name}@${p.slot}`).join(", "));
    setInterval(() => { if (sock.connected) sock.emit("mp:state", packB()); }, 84);
    console.log("[peer] publishing state @12 Hz — waiting for Alice's swings…");
  });
});

sock.on("mp:lobby", (m: { t: string; lobby?: { players: { sid: string; slot: number; name: string }[] } }) => {
  if (m.t === "roster" && m.lobby) {
    const alice = m.lobby.players.find((p) => p.sid !== sock.id);
    if (alice) aliceSlot = alice.slot;
  }
});

sock.on("mp:state", (buf: Buffer, slot: number) => {
  const s = unpackState(new Uint8Array(buf), performance.now());
  if (!s || slot === mySlot) return;
  if (aliceSlot < 0) aliceSlot = slot;
  // track Alice's hp + the down byte she publishes
  if (s.hp !== aliceHpLast) {
    if (aliceHpLast >= 0) console.log(`[peer] Alice(slot ${slot}) hp ${aliceHpLast} -> ${s.hp}`);
    aliceHpLast = s.hp;
  }
  if (s.down >= 1 && s.down <= 120 && !downSeen) { downSeen = true; console.log(`[peer] 🥊 ALICE FLOORED — down byte ${s.down} (downT ≈ ${(s.down / 40).toFixed(2)} s)`); }
  if (s.down >= 121 && s.down <= 240 && !getupSeen && downSeen) { getupSeen = true; console.log(`[peer] 🪫 ALICE GETTING UP — getup byte ${s.down} (getupT ≈ ${((s.down - 121) / 40).toFixed(2)} s)`); }
});

sock.on("mp:event", (ev: { t: string; target?: number; amount?: number; pvp?: boolean; from?: string; x?: number; z?: number; s?: number }) => {
  if (ev.t === "dmg" && ev.target === mySlot) {
    dmgEvents++;
    console.log(`[peer] 🩸 HIT ${dmgEvents}: ${ev.amount} dmg from "${ev.from ?? "?"}" (pvp=${ev.pvp === true}) at (${ev.x?.toFixed(1)}, ${ev.z?.toFixed(1)}) — my hp ${B.hp} -> ${Math.max(0, B.hp - (ev.amount ?? 0))}`);
    B.hp = Math.max(0, B.hp - (ev.amount ?? 0));
    // after the third hit, swing BACK at Alice — a real victim fights back
    if (dmgEvents === 3 && aliceSlot >= 0) {
      const sx = ev.x ?? B.x, sz = ev.z ?? B.z;
      console.log(`[peer] 🥊 Bob swings BACK at Alice (slot ${aliceSlot}) — 95 dmg (lethal → mercy floor expected)`);
      sock.emit("mp:event", { t: "dmg", target: aliceSlot, amount: 95, x: B.x, z: B.z, pvp: true, from: "Bob" });
      setTimeout(() => {
        sock.emit("mp:event", { t: "dmg", target: aliceSlot, amount: 95, x: B.x, z: B.z, pvp: true, from: "Bob" });
        console.log("[peer] 🥊 Bob's SECOND lethal blow — this one should END the run (hp -> 0)");
      }, 4000);
    }
  }
});

const WINDOW_MS = Number(process.argv[3] ?? 110000);
setTimeout(() => {
  console.log(`\n[peer] ===== RESULT =====`);
  console.log(`dmg events received: ${dmgEvents}`);
  console.log(`Alice floored byte seen: ${downSeen} · getup byte seen: ${getupSeen}`);
  const pass = dmgEvents >= 3 && downSeen && getupSeen;
  console.log(pass ? "✅ PvP WIRE LOOP VERIFIED" : "❌ PvP wire loop FAILED");
  process.exit(pass ? 0 : 2);
}, WINDOW_MS);
