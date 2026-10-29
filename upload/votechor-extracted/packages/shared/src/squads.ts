import { z } from "zod";

export const SQUAD_MAX = 4;
export const RESCUE_RADIUS = 3.5;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const SquadMsgSchema = z.object({
  action: z.enum(["create", "join", "leave"]),
  code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{4}$/).optional(),
});
export const InteractSchema = z.object({}).strict();
export type SquadResult = "ok" | "full" | "missing" | "already";

/** Server-side squad registry: join codes, size limit, one squad per player. */
export class SquadBook {
  private byCode = new Map<string, Set<string>>();
  private of = new Map<string, string>();
  constructor(private rnd: () => number, private max = SQUAD_MAX) {}
  squadOf(id: string): string { return this.of.get(id) ?? ""; }
  members(code: string): string[] { return [...(this.byCode.get(code) ?? [])]; }
  sameSquad(a: string, b: string): boolean { const s = this.of.get(a); return !!s && s === this.of.get(b); }
  create(id: string): string {
    this.leave(id);
    let code = "";
    do { code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(this.rnd() * ALPHABET.length)]).join(""); } while (this.byCode.has(code));
    this.byCode.set(code, new Set([id])); this.of.set(id, code);
    return code;
  }
  join(id: string, code: string): SquadResult {
    const s = this.byCode.get(code);
    if (!s) return "missing";
    if (s.has(id)) return "already";
    if (s.size >= this.max) return "full";
    this.leave(id); s.add(id); this.of.set(id, code);
    return "ok";
  }
  /** Returns the code the player left (empty squads are deleted). */
  leave(id: string): string {
    const code = this.of.get(id); if (!code) return "";
    this.of.delete(id);
    const s = this.byCode.get(code); s?.delete(id);
    if (s && s.size === 0) this.byCode.delete(code);
    return code;
  }
}
