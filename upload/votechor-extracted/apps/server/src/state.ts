import { schema, t, type SchemaType } from "@colyseus/schema";

/** Replicated player entity. Bots intentionally look identical to real players on the wire. */
export const PlayerState = schema({
  name: t.string(), fac: t.string(), sex: t.string(), age: t.string(),
  cap: t.uint8(), skin: t.string(), shirt: t.string(), shoe: t.string(),
  x: t.float32(), y: t.float32(), z: t.float32(), ry: t.float32(), spd: t.float32(),
  hp: t.uint8(), stamina: t.uint8(),
  mode: t.uint8(),   // 0 free, 1 detained
  stars: t.uint8(),  // police currently chasing this player (0-5)
  squad: t.string(), // squad join code or ""
  support: t.uint16(), // support points (rescues)
}, "PlayerState");
export type PlayerState = SchemaType<typeof PlayerState>;

export const ItemState = schema({
  kind: t.uint8(), x: t.float32(), z: t.float32(), active: t.boolean(),
}, "ItemState");
export type ItemState = SchemaType<typeof ItemState>;

export const CreatureState = schema({
  kind: t.uint8(), x: t.float32(), z: t.float32(), ry: t.float32(), spd: t.float32(),
}, "CreatureState");
export type CreatureState = SchemaType<typeof CreatureState>;

export const HazardState = schema({ x: t.float32(), z: t.float32(), r: t.float32(), t: t.float32(), kind: t.uint8() }, "HazardState");
export const StationState = schema({ x: t.float32(), z: t.float32(), progress: t.uint8(), need: t.uint8() }, "StationState");
export const BossState = schema({
  phase: t.uint8(), hp: t.uint8(), timer: t.float32(), hold: t.float32(), votes: t.uint8(), need: t.uint8(),
  round: t.uint16(), participants: t.uint8(),
  hazards: t.map(HazardState), stations: t.map(StationState),
}, "BossState");
export type BossState = SchemaType<typeof BossState>;

export const CityState = schema({
  boss: BossState,
  creatures: t.map(CreatureState),
  players: t.map(PlayerState),
  items: t.map(ItemState),
  clock: t.float32(),
  real: t.uint16(),  // connected human players
  bots: t.uint16(),  // AI fillers (never counted as players)
}, "CityState");
export type CityState = SchemaType<typeof CityState>;
