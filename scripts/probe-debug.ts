/** probe-debug — anonymous socket that asks the relay for the deep debug dump. */
import { io } from "socket.io-client";
const sock = io("http://127.0.0.1:3030", { transports: ["websocket"] });
sock.on("connect", () => {
  sock.timeout(4000).emit("mp:debug", {}, (err: unknown, r: unknown) => {
    if (err) { console.error("[debug] timeout", err); process.exit(1); }
    console.log(JSON.stringify(r, null, 1));
    process.exit(0);
  });
});
setTimeout(() => { console.error("[debug] no connect"); process.exit(1); }, 6000);
