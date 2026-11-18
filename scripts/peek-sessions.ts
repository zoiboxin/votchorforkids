/** one-off: peek at the relay's live sessions (mp:sessions helper) */
import { io } from "socket.io-client";
const s = io("http://127.0.0.1:3030", { transports: ["websocket"] });
s.on("connect", () => {
  s.emit("mp:sessions", {}, (r: any) => {
    console.log(JSON.stringify(r, null, 2));
    s.disconnect();
    process.exit(0);
  });
});
