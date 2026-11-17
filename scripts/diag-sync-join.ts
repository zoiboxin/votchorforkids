/**
 * diag-sync — relay wire test: two fake clients verify room delivery of
 * mp:state / mp:event(ambient) both ways + roster events.
 * Run: bun scripts/diag-sync.ts
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://127.0.0.1:3030";
const LOOK = { fac: "protester", outfit: "", skin: "#ffd9b3", shirt: "#f5a524", pants: "#2a2a2a", shoe: "#111111", hair: "#3a2a1a", hairStyle: "spiky", cap: false, capColor: "#000000", glasses: false, age: "young", girl: false };
let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`); if (!cond) fails++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const A: Socket = io(URL, { transports: ["websocket"] });
  await new Promise<void>((res) => A.once("connect", res));
  const createAck: any = await new Promise((res) => A.emit("mp:create", { name: "Alpha", look: LOOK }, res));
  ok("A creates room", !!createAck?.ok && !!createAck?.code, String(createAck?.code ?? createAck?.err ?? ""));
  const code = String(createAck.code);

  A.emit("mp:event", { t: "start" });

  const B: Socket = io(URL, { transports: ["websocket"] });
  await new Promise<void>((res) => B.once("connect", res));
  const quickAck: any = await new Promise((res) => B.emit("mp:join", { code, name: "Bravo", look: LOOK }, res));
  ok("B joined A's room by code", !!quickAck?.ok && quickAck?.code === code, `code=${quickAck?.code}`);

  let aGotBState = false; let bGotAState = false; let bGotAmb = false; let aGotHello = false;
  const bSlot = quickAck?.lobby?.players?.find((p: any) => p.name === "Bravo")?.slot ?? -1;
  A.on("mp:state", (_buf: Buffer, slot: number) => { if (slot === bSlot) aGotBState = true; });
  B.on("mp:state", (_buf: Buffer, slot: number) => { if (slot === 0) bGotAState = true; });
  B.on("mp:event", (ev: any) => { if (ev?.t === "phase" && Array.isArray(ev.amb?.tr) && ev.amb.tr.length === 12) bGotAmb = true; });
  A.on("mp:event", (ev: any) => { if (ev?.t === "hello") aGotHello = true; });

  A.emit("mp:state", Buffer.alloc(9, 7));
  B.emit("mp:state", Buffer.alloc(9, 9));
  A.emit("mp:event", { t: "phase", phase: "day", nightNo: 1, phaseLeft: 60, clock: 0.3, amb: { tr: Array.from({ length: 12 }, (_, i) => i * 0.52), pl: [[201, 211, 0, 0], [210, 211, 66, 0.2], [219, 211, 33, 1.2]] } });
  B.emit("mp:event", { t: "hello" });

  await wait(1200);
  ok("B received A's mp:state", bGotAState);
  ok("A received B's mp:state", aGotBState);
  ok("B received phase event with 12-angle ambient", bGotAmb);
  ok("A received B's hello event", aGotHello);

  A.disconnect(); B.disconnect();
  console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
void main();
