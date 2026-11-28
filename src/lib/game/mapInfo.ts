/**
 * 🗺️ MAP DEFS — per-map geometry & feel.
 *
 * The 7Nights island used to be one hard-coded map: every radius lived in
 * constants.ts and the engine read those constants directly. With the
 * season system the game now boots TWO kinds of world:
 *
 *   • "lobby"  — the original town island (radius 712). Solo players land
 *                here and ROAM while the match lobby counts down.
 *   • seasonal — a 4×4 km themed BR arena (radius 2000, half of 4 km square
 *                side) generated per season kit (Christmas Village, Halloween
 *                Night, …). The real match plays out here.
 *
 * Every engine/sim/Hud read of a map radius goes through a MapInfo, so the
 * same code drives both worlds. The lobby MapInfo is a faithful snapshot of
 * the legacy constants; seasonal maps carry their own scaled bands.
 */
import {
  type Zone,
  AUTO_EJECT_R,
  CITY_RADIUS,
  DEEP_JUNGLE_RADIUS,
  DROP_ALT,
  DROP_OUTER,
  FARM_RADIUS,
  JUNGLE_RADIUS,
  MOUNTAIN_INNER,
  MOUNTAIN_OUTER,
  WALL_RADIUS,
  ZONE_RADII,
  zoneOf,
} from "./constants";
import { RING_R, terrainHeight } from "./worldgen";

export interface MapInfo {
  /** stable id — "lobby" or "s1".."s27" */
  id: string;
  /** display name (HUD / minimap / lobby cards) */
  name: string;
  /** true for generated 4×4 km season arenas */
  seasonal: boolean;
  /** hard boundary radius — bodies clamp here */
  wallR: number;
  /** city-core spawn ring (loot/scatter use cityR as the "busy" band) */
  cityR: number;
  /** farmland band outer edge (engine biome spawns scale off this) */
  farmR: number;
  /** deep-jungle band outer edge */
  deepR: number;
  /** jungle band outer edge */
  jungleR: number;
  /** climbable mountain ring (lobby only — seasonal keeps a flat rim) */
  mountInner: number;
  mountOuter: number;
  /** shrinking safe-zone radii per zone level */
  zoneRadii: readonly number[];
  /** dropship route start radius (outside the wall) */
  dropOuter: number;
  /** AFK auto-eject radius */
  autoEjectR: number;
  /** dropship cruise altitude */
  dropAlt: number;
  /** terrain height sample — per map (lobby: peaks ring; seasonal: gentle hills) */
  terrain(x: number, z: number): number;
  /** ring-road traffic lane radius (lobby: the city ring road) */
  ringR: number;
  /** zone label at a point (HUD "Farmland" etc.) */
  zones(x: number, z: number): Zone;
}

/** The original town island — every value mirrors the legacy constants. */
export const LOBBY_MAP: MapInfo = {
  id: "lobby",
  name: "7Nights Town",
  seasonal: false,
  wallR: WALL_RADIUS,
  cityR: CITY_RADIUS,
  farmR: FARM_RADIUS,
  deepR: DEEP_JUNGLE_RADIUS,
  jungleR: JUNGLE_RADIUS,
  mountInner: MOUNTAIN_INNER,
  mountOuter: MOUNTAIN_OUTER,
  zoneRadii: ZONE_RADII,
  dropOuter: DROP_OUTER,
  autoEjectR: AUTO_EJECT_R,
  dropAlt: DROP_ALT,
  ringR: RING_R,
  terrain: terrainHeight,
  zones: zoneOf,
};

/** Read the MapInfo off a world — falls back to the legacy town island. */
export function mapOf(world: { map?: MapInfo }): MapInfo {
  return world.map ?? LOBBY_MAP;
}

/** Seasonal arena dimensions — a 4×4 km play field (half-extent 2000).
 *  Per-season sizes scale this ladder (S1 is a tight 2×2 km village). */
export const SEASON_HALF = 2000;
/**
 * Safe-zone ladder for the big map — the same 7-step squeeze as the lobby,
 * stretched so the early phases breathe across the 4 km arena.
 */
export const SEASON_ZONE_RADII = [2000, 1500, 1050, 700, 430, 240, 120];
