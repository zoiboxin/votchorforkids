/** probe-room — join a room by code and log EVERYTHING heard for 6 s. */
import { io } from "socket.io-client";
const code = process.argv[2] ?? "ASWT";
const sock = io("http://127.0.0.1:3030", { transports: ["websocket"] });
sock.on("connect", () => {
  console.log("[probe] connected", sock.id);
  sock.emit("mp:join", { code, name: "Probe", look: null }, (r: unknown) => console.log("[probe] join ack:", JSON.stringify(r)));
  sock.onAny((ev: string, ...args: unknown[]) => console.log(`[probe] recv ${ev}`, JSON.stringify(args).slice(0, 200)));
  sock.on("mp:state", () => {}); // binary noise — already logged via onAny slice
});
setTimeout(() => { console.log("[probe] done"); process.exit(0); }, 6000);
