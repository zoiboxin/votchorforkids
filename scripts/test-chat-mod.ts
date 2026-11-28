/** End-to-end chat moderation test — run: bun scripts/test-chat-mod.ts */
import { io, type Socket } from "socket.io-client";

const KEY = "7nights-cpanel-chat-key-v1";
const admin = (path: string, body?: unknown, method = "POST") =>
  fetch(`http://localhost:3004${path}`, {
    method,
    headers: { "x-admin-key": KEY, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

const connect = (name: string): Promise<{ s: Socket; got: string[] }> =>
  new Promise((res) => {
    const s = io("http://localhost:3003/", { transports: ["websocket"] });
    const got: string[] = [];
    for (const ev of ["chat:message", "chat:blocked", "chat:muted", "chat:banned", "chat:delete"]) {
      s.on(ev, (p: unknown) => got.push(`${ev}:${JSON.stringify(p).slice(0, 90)}`));
    }
    s.on("connect", () => res({ s, got }));
  });

const send = (s: Socket, name: string, msg: string) => s.emit("chat:send", { name, msg });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = await connect("Alice");
  const b = await connect("Bob");
  await wait(400);

  /* 1. abusive message → blocked, never broadcast */
  send(a.s, "Alice", "this is shit mate");
  await wait(500);
  console.log("1 blocked event:", a.got.find((g) => g.startsWith("chat:blocked")) ?? "NONE");
  console.log("  bob saw it?", b.got.some((g) => g.includes("shit")) ? "YES (BAD)" : "no (good)");

  /* 2. admin mute → refused with chat:muted */
  await admin("/admin/mute", { name: "alice", hours: 0.5, reason: "test mute" });
  send(a.s, "Alice", "normal message after mute");
  await wait(400);
  console.log("2 muted event:", a.got.find((g) => g.startsWith("chat:muted")) ?? "NONE");
  await admin("/admin/unmute", { name: "alice" });

  /* 3. chat ban */
  await admin("/admin/ban", { name: "bob", reason: "test ban" });
  send(b.s, "Bob", "bob trying to speak");
  await wait(400);
  console.log("3 banned event:", b.got.find((g) => g.startsWith("chat:banned")) ?? "NONE");
  await admin("/admin/unban", { name: "bob" });

  /* 4. clean message broadcasts */
  send(a.s, "Alice", "hello clean world");
  await wait(400);
  console.log("4 bob saw clean msg?", b.got.some((g) => g.includes("hello clean world")) ? "yes (good)" : "NO (BAD)");

  /* 5. broadcast */
  await admin("/admin/broadcast", { message: "Nightline test announcement" });
  await wait(400);
  console.log("5 broadcast seen by bob?", b.got.some((g) => g.includes("Nightline test announcement")) ? "yes (good)" : "NO (BAD)");

  /* 6. flagged lands in admin feed */
  const feed = (await admin("/admin/chat?limit=30", undefined, "GET")) as { messages: { msg: string; flagged: boolean }[] };
  const flagged = feed.messages.find((m) => m.msg.includes("this is shit"));
  console.log("6 flagged in admin feed?", flagged ? `yes flagged=${flagged.flagged} (good)` : "NO (BAD)");

  /* 7. delete a message everywhere */
  if (feed.messages[0]) {
    await admin("/admin/delete", { id: feed.messages[0].id });
    await wait(400);
    console.log("7 delete event seen by alice?", a.got.some((g) => g.startsWith("chat:delete")) ? "yes (good)" : "NO (BAD)");
  }

  a.s.disconnect();
  b.s.disconnect();
  await wait(200);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
