#!/usr/bin/env node
/* cdp-eval.js — evaluate JS in the live 7Nights tab via raw CDP (bypasses the
 * agent-browser daemon's wedge-replacement, which kills the tab whenever the
 * game's main thread stalls longer than its eval timeout).
 * Usage: node scripts/cdp-eval.js "<expression>"
 * Prints the JSON result (or the exception) to stdout. */
const http = require("http");

const expr = process.argv[2] ?? "location.href";
const SHOT = process.argv[2] === "--shot" ? process.argv[3] : null;
const BROWSER_URL = "http://127.0.0.1:37265/json";

async function main() {
  const res = await new Promise((resolve, reject) => {
    http.get(BROWSER_URL, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
  // pick the 7Nights tab (first page target on localhost:81)
  const page = res.find((t) => t.type === "page" && (t.url || "").includes("localhost:81"))
    ?? res.find((t) => t.type === "page" && t.url === "about:blank");
  if (!page) throw new Error("no page target");
  if (!page.webSocketDebuggerUrl) throw new Error("no ws url for target");
  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res2, rej2) => { ws.on("open", res2); ws.on("error", rej2); });
  const result = await new Promise((resolve) => {
    const id = 1;
    const onMsg = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === id) {
        ws.off("message", onMsg);
        resolve(m);
      }
    };
    ws.on("message", onMsg);
    if (SHOT) {
      ws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "jpeg", quality: 55 } }));
    } else {
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: expr, returnByValue: true, awaitPromise: false, timeout: 120000 },
      }));
    }
    setTimeout(() => resolve({ error: "TIMEOUT-120s" }), 120000);
  });
  if (SHOT) {
    const data = result.result && result.result.data;
    if (data) {
      require("fs").writeFileSync(SHOT, Buffer.from(data, "base64"));
      console.log("saved " + SHOT);
    } else console.log("SHOT-FAIL", JSON.stringify(result).slice(0, 200));
  } else if (result.error) console.log(JSON.stringify(result.error));
  else if (result.result && result.result.exceptionDetails) {
    const e = result.result.exceptionDetails;
    console.log("EXC:", e.exception && (e.exception.description || e.exception.value));
  } else console.log(JSON.stringify(result.result && result.result.result && result.result.result.value));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error("CDP-ERR:", e.message); process.exit(1); });
