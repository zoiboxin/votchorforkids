/**
 * peer-probe — a fake second player for in-browser multiplayer verification.
 * Joins the given room code BY CODE (never quick-matchmaking — the relay may
 * hold live human sessions), streams a survivor standing at (201,211) plus a
 * phase event with ambient traffic/plane data, and reports what it hears back.
 * Run: bun scripts/peer-probe.ts <ROOM_CODE> [seconds]
 */
import { io, type Socket } from "socket.io-client";
import { packState, unpackState } from "../src/lib/game/net/protocol"; // packState signature confirmed against protocol.ts:160-182

const code = (process.argv[2] ?? "").toUpperCase().trim();
const secs = Number(process.argv[3] ?? 25);
if (!code) { console.error("usage: bun scripts/peer-probe.ts <ROOM_CODE> [seconds]"); process.exit(1); }

const LOOK = { fac: "protester", outfit: "", skin: "#ffd9b3", shirt: "#f5a524", pants: "#2a2a2a", shoe: "#111111", hair: "#3a2a1a", hairStyle: "spiky", cap: false, capColor: "#000000", glasses: false, age: "young", girl: false };
const sock: Socket = io("http://127.0.0.1:3030", { transports: ["websocket"] });

sock.on("connect", () => {
  sock.emit("mp:join", { code, name: "Probe", look: LOOK }, (r: any) => {
    if (!r?.ok || r.code !== code) { console.error("[probe] join failed:", r?.err ?? JSON.stringify(r)); process.exit(1); }
    const slot = r.lobby.players.find((p: any) => p.name === "Probe")?.slot ?? 1;
    console.log(`[probe] joined room ${r.code} at slot ${slot}`);
    // packState field set matches protocol.ts (slot,x,z,y,yaw,hp + flags)
    const state = packState({ slot, x: 201, z: 211, y: 0, yaw: 0, hp: 100, sprint: false, air: false, beast: false, dead: false, drive: false, ride: false, attack: false });
    const pub = setInterval(() => sock.emit("mp:state", state), 80);
    const amb = setInterval(() => sock.emit("mp:event", {
      t: "phase", phase: "day", nightNo: 1, phaseLeft: 180, clock: 0.3,
      amb: { tr: Array.from({ length: 12 }, (_, i) => Math.round(i * 0.52 * 1000) / 1000), pl: [[201, 211, 0, 0], [210, 211, 66, 0.2], [219, 211, 33, 1.2]] },
    }), 500);
    let sawState = false; let sawPhase = false; let loggedState = false; let loggedAmb = false;
    sock.on("mp:state", (b: Buffer, s: number) => {
      if (!sawState && s !== slot) {
        sawState = true; console.log(`[probe] RECEIVING mp:state from slot ${s} (game publishes) OK`);
      }
      if (!loggedState && s !== slot) {
        loggedState = true;
        const st = unpackState(b instanceof Uint8Array ? b : new Uint8Array(b ?? []), 0);
        if (st) console.log(`[probe] game survivor decoded: slot=${st.slot} x=${st.x} z=${st.z} y=${st.y} hp=${st.hp}`);
      }
    });
    sock.on("mp:event", (ev: any) => {
      if (!sawPhase && ev?.t === "phase") { sawPhase = true; console.log("[probe] RECEIVING phase events (game publishes) OK"); }
      // guest-mirror evidence: the host's phase events carry the ambient snapshot
      if (!loggedAmb && ev?.t === "phase" && ev.amb) {
        loggedAmb = true;
        console.log(`[probe] host amb snapshot (s=${ev.s}): tr×${ev.amb.tr?.length} pl[0..2]=${JSON.stringify(ev.amb.pl?.slice(0, 3))}`);
      }
    });
    setTimeout(() => { clearInterval(pub); clearInterval(amb); console.log("[probe] done"); process.exit(0); }, secs * 1000);
  });
});
sock.on("connect_error", (e) => { console.error("[probe] connect_error:", e.message); process.exit(1); });
