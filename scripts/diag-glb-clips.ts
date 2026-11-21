/**
 * Diagnose embedded animation clip names across the Polyfork cast GLBs.
 * Reads the GLB JSON chunk directly (no three.js needed) and prints
 * every animation name per character, flagging the expected trio.
 */
const CAST = [
  "airline-pilot-63226a",
  "flight-attendant-befaf4",
  "traveller-92f20c",
  "baggage-handler-0823f5",
  "ground-marshaller-8e8631",
  "fuel-technician-df4ce0",
  "bellhop-053c4d",
  "blackjack-dealer-fc0ab1",
  "lounge-bartender-9d425a",
  "carving-chef-102bf5",
  "pit-boss-234a94",
  "cocktail-server-eb211b",
  "airport-security-officer-8fd38a",
];

async function clipNames(slug: string): Promise<string[]> {
  const res = await fetch(`https://polyfork.dev/cdn/${slug}.glb`, { mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new DataView(await res.arrayBuffer());
  // GLB: 12-byte header (magic, version, length), then chunks: [len(u32), type(u32), data]
  let off = 12;
  while (off < buf.byteLength) {
    const len = buf.getUint32(off, true);
    const type = buf.getUint32(off + 4, true);
    if (type === 0x4e4f534a) { // 'JSON'
      const json = new TextDecoder().decode(new Uint8Array(buf.buffer, off + 8, len));
      const parsed = JSON.parse(json) as { animations?: { name?: string }[] };
      return (parsed.animations ?? []).map((a) => a.name ?? "(unnamed)");
    }
    off += 8 + len;
  }
  return [];
}

for (const slug of CAST) {
  const names = await clipNames(slug);
  const has = (n: string) => names.includes(n) ? "ok" : "MISSING";
  console.log(
    `${slug}\n  clips: ${names.join(", ") || "(none)"}\n  Idle:${has("Idle")} Walk:${has("Walk")} Run:${has("Run")}`,
  );
}
