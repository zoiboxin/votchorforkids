/** Silent host — creates a room, marks it live, then goes CLOCK-SILENT while
 *  keeping the socket alive (a throttled/backgrounded host tab: the relay sees
 *  a healthy member, but no phase stream ever arrives). Used to verify the
 *  guest-side hold-at-the-boundary guard in stepPhase. */
import { io, type Socket } from "socket.io-client";
const sock: Socket = io("http://localhost:3030", { transports: ["websocket"] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  await wait(400);
  const created = await new Promise<{ ok: boolean; code?: string }>((res) =>
    sock.emit("mp:create", { name: "SilentHost", look: { fac: "protester", shirt: "#ff8800" } }, res));
  if (!created.ok || !created.code) { console.error("create failed", created); process.exit(1); }
  console.log(`ROOM CODE: ${created.code}`);
  sock.emit("mp:event", { t: "start" });
  // phase burst for 40 s (time to join from a browser), then SILENCE forever
  for (let i = 0; i < 180; i++) {
    sock.emit("mp:event", { t: "phase", phase: "night", nightNo: 2, phaseLeft: 30, clock: 0.8 });
    await wait(500);
  }
  console.log("host silent from here — socket stays connected (throttled-tab simulation)");
  setInterval(() => console.log("[silenthost] still connected, still silent"), 10000);
}
main().catch((e) => { console.error(e); process.exit(1); });
