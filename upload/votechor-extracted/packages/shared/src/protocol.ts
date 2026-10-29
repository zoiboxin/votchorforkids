import { z } from "zod";
import { CIVIL_COLORS, POLICE_COLORS, SKIN_TONES, SHOE_COLORS } from "./constants.ts";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const AppearanceSchema = z.object({
  fac: z.enum(["protester", "police"]),
  sex: z.enum(["boy", "girl"]),
  age: z.enum(["kid", "teen", "young", "old"]),
  cap: z.number().int().min(0).max(1),
  skin: hex,
  shirt: hex,
  shoe: hex,
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const JoinOptionsSchema = AppearanceSchema.extend({
  name: z.string().trim().min(1).max(16),
});
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

/** Client -> server input. Clients send intent only; the server owns all outcomes. */
export const InputSchema = z.object({
  f: z.number().min(-1).max(1),
  r: z.number().min(-1).max(1),
  yaw: z.number().min(-1000).max(1000),
  sprint: z.boolean(),
  jump: z.boolean(),
});
export type PlayerInput = z.infer<typeof InputSchema>;

export const defaultAppearance = (): Appearance => ({
  fac: "protester", sex: "boy", age: "young", cap: 1,
  skin: SKIN_TONES[2], shirt: CIVIL_COLORS[0], shoe: SHOE_COLORS[0],
});

/** Strip control chars/markup and cap length so names are safe to render. */
export function sanitizeName(raw: string): string {
  const s = raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16);
  return s || "Guest";
}

/**
 * Parse untrusted join options. Appearance and name are validated independently so one bad
 * field never discards the other; anything invalid falls back to a safe default.
 */
export function parseJoinOptions(raw: unknown): JoinOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const look = AppearanceSchema.safeParse(o);
  const name = sanitizeName(typeof o.name === "string" ? o.name : "");
  return { ...(look.success ? look.data : defaultAppearance()), name };
}
export { POLICE_COLORS };
