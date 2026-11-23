/* 🐉 Mythic Vault hero audit — verify every downloaded kit GLB is a RIGGED,
 * ANIMATED character before it gets registered in glbCharacters.ts.
 *
 * The game's hero loader needs Idle/Walk/Run-style clips — a static T-pose
 * file is unusable — so a file with animations.length < 3 is REJECTED and
 * must be EXCLUDED from MYTHIC_HEROES (leave the file on disk, just skip it).
 *
 * Follows the scripts/measure-weapons.ts pattern (bun-run, direct file reads)
 * but parses the GLB container manually instead of going through three.js:
 *
 * GLB layout (glTF 2.0 spec, "Binary glTF"):
 *   12-byte header : magic u32 0x46546C67 ("glTF") · version u32 · total length u32
 *   first chunk    : length u32 · type u32 0x4E4F534A ("JSON") · JSON payload
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "/home/z/my-project/public/models/heroes";
const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const MIN_ANIMS = 3; // Idle/Walk/Run trio minimum

interface GlbJson {
  animations?: { name?: string; channels?: unknown[] }[];
  meshes?: unknown[];
  skins?: unknown[];
}

interface Row {
  slug: string;
  kb: number;
  anims: number;
  clips: string[];
  meshes: number;
  skins: number;
  ok: boolean;
  why: string;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".glb")).sort();
const rows: Row[] = [];

for (const f of files) {
  const path = join(DIR, f);
  const slug = f.replace(/\.glb$/, "");
  const kb = Math.round(statSync(path).size / 1024);
  try {
    const buf = readFileSync(path);
    const magic = buf.readUInt32LE(0);
    const version = buf.readUInt32LE(4);
    const chunkLen = buf.readUInt32LE(12);
    const chunkType = buf.readUInt32LE(16);
    if (magic !== GLB_MAGIC || version !== 2 || chunkType !== JSON_CHUNK) {
      rows.push({ slug, kb, anims: 0, clips: [], meshes: 0, skins: 0, ok: false, why: "bad GLB header" });
      continue;
    }
    const json = JSON.parse(buf.toString("utf8", 20, 20 + chunkLen)) as GlbJson;
    const anims = json.animations?.length ?? 0;
    const clips = (json.animations ?? []).map((a) => a.name ?? "unnamed");
    const meshes = json.meshes?.length ?? 0;
    const skins = json.skins?.length ?? 0;
    const ok = anims >= MIN_ANIMS && meshes > 0 && skins > 0;
    rows.push({
      slug, kb, anims, clips, meshes, skins, ok,
      why: ok ? "OK"
        : anims < MIN_ANIMS ? `only ${anims} clip(s) — static/T-pose, unusable`
        : meshes === 0 ? "no meshes"
        : "no skin (not rigged)",
    });
  } catch (e) {
    rows.push({ slug, kb, anims: 0, clips: [], meshes: 0, skins: 0, ok: false, why: `parse error: ${e}` });
  }
}

/* ---- table ---- */
const W = 28; // slug column width (longest: hooded-staff-acolyte-f24f63)
console.log(
  "slug".padEnd(W) + "  sizeKB".padStart(7) + "  anims  skins  meshes  clips (first 5)" + " ".repeat(24) + "verdict",
);
console.log("-".repeat(110));
for (const r of rows) {
  const clips = r.clips.slice(0, 5).join(" · ") + (r.clips.length > 5 ? ` …(+${r.clips.length - 5})` : "");
  console.log(
    r.slug.padEnd(W) +
    String(r.kb).padStart(7) +
    String(r.anims).padStart(7) +
    String(r.skins).padStart(7) +
    String(r.meshes).padStart(7) +
    "  " + clips.padEnd(34) +
    (r.ok ? "  ✅ OK" : `  ❌ REJECT (${r.why})`),
  );
}
console.log("-".repeat(110));

const rejected = rows.filter((r) => !r.ok);
console.log(
  `\n${rows.length} files · ${rows.length - rejected.length} OK · ${rejected.length} REJECTED` +
  (rejected.length ? `\nEXCLUDE from registration: ${rejected.map((r) => r.slug).join(", ")}` : "\nAll files pass — register every slug."),
);
