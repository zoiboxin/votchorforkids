/* tiny chat bot — emits one message as another player, used for E2E verification */
import { io } from "socket.io-client";

const msg = process.argv[2] ?? "boo from the dark";
const name = process.argv[3] ?? "NightBot";

const s = io("http://localhost:3003", { transports: ["websocket"] });

s.on("connect", () => {
  console.log(`bot connected as ${name}`);
  s.emit("chat:send", { name, msg });
  setTimeout(() => {
    s.disconnect();
    process.exit(0);
  }, 800);
});

s.on("connect_error", (e) => {
  console.error("bot connect error:", e.message);
  process.exit(1);
});
