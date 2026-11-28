/**
 * 🎄🎃 SEASONS — the 7Nights seasonal BR arenas.
 *
 * Every season turns the 4×4 km match map into its own themed world built
 * from a polyfork kit (attribution in public/models/CREDITS.md): the ground,
 * roads, buildings, tree line and sky all come from the season palette, and
 * the kit's vendored GLB pieces dress the named POIs.
 *
 * Season order follows the release plan: S1 Christmas Village, S2 Halloween
 * Night, then one kit per season after that.
 */
import type { SeasonAssetDef } from "./seasonAssets";
import { SEASON_ASSETS } from "./seasonAssets";

export type FoliageKind =
  | "pine"    // conifer stack (snow-capped when pal.snow)
  | "oak"     // round broadleaf blob
  | "palm"    // curved trunk + fan crown
  | "cactus"  // saguaro column + arms
  | "dead"    // bare branches
  | "sakura"  // pink blossom blob
  | "cypress" // slim dark cone
  | "bamboo"; // thin segmented stalks

export interface SeasonPalette {
  /** base grass / sand / snow ground */
  ground: number;
  /** secondary ground tint (patches) */
  ground2: number;
  /** dirt patches + plazas edge */
  dirt: number;
  road: number;
  roadLine: number;
  plaza: number;
  /** building wall pool (cycled per filler building) */
  wall: number[];
  /** roof pool (cycled per filler building) */
  roof: number[];
  /** window / trim accent */
  trim: number;
  trunk: number;
  crown: number;
  /** alternate crown tint (canopy variation) */
  crown2: number;
  /** water / ponds */
  water: number;
  skyDay: number;
  skyDusk: number;
  skyNight: number;
  fogDay: number;
  fogNight: number;
  sunDay: number;
  hemiDay: number;
  /** UI + lamp glow + kit prop accent */
  accent: number;
  /** snow caps on roofs & trees */
  snow: boolean;
}

export interface SeasonDef {
  id: string;
  title: string;
  /** polyfork kit page (attribution) */
  kit: string;
  tagline: string;
  /** arena size in km per side (default 4) — S1 is a tight 2×2 km village */
  sizeKm?: number;
  pal: SeasonPalette;
  /** tree pools to build, primary first */
  foliage: FoliageKind[];
  /** named POIs — capital (index 0) is the downtown drop */
  poiNames: string[];
}

const P = (p: SeasonPalette) => p;

export const SEASONS: SeasonDef[] = [
  {
    id: "s1", title: "Christmas Village", kit: "christmas-village-fbc27a",
    tagline: "Silent night, zombie night — survive under the snow",
    sizeKm: 2,
    pal: P({
      ground: 0xeef2f6, ground2: 0xe0e9f0, dirt: 0xa8bcc8, road: 0xb8c8d4, roadLine: 0xe8f0f6,
      plaza: 0xd4e2ec, wall: [0x8a4a2a, 0xb5533c, 0x7c6f5d, 0x4a6741], roof: [0xb03a2e, 0x7b3f2e, 0x3f5e44, 0x54636e],
      trim: 0xf0e2c0, trunk: 0x5d4632, crown: 0x2e6b45, crown2: 0x3a7d52, water: 0x9cc8e0,
      skyDay: 0xa8cce8, skyDusk: 0xf0a35e, skyNight: 0x0a1228, fogDay: 0xd0e0ec, fogNight: 0x0a1122,
      sunDay: 0xfff2dd, hemiDay: 0xcfe4f2, accent: 0xe4572e, snow: true,
    }),
    foliage: ["pine", "oak"],
    poiNames: ["Workshop Plaza", "Gingerbread Lane", "Candy Cane Corner", "Ice Rink", "Toy Market", "Pine Hollow", "Snowman Field", "Reindeer Stables", "Fir Camp", "Cocoa Row", "Crystal Pines", "Sleigh Yard", "Nutcracker Keep", "Mistletoe Mill", "Frost Fair", "Tinsel Town", "Toy Workshop"],
  },
  {
    id: "s2", title: "Halloween Night", kit: "halloween-night-46ade4",
    tagline: "Trick or treat — the horde is already wearing a costume",
    pal: P({
      ground: 0x544a3c, ground2: 0x443d31, dirt: 0x37322a, road: 0x3a352e, roadLine: 0xe8862e,
      plaza: 0x4a4436, wall: [0x3d3345, 0x54465e, 0x2e2a38, 0x6e5a3c], roof: [0x553d6e, 0x443253, 0x6b4a2e, 0x3c3444],
      trim: 0xe8862e, trunk: 0x3c3428, crown: 0x6b5a34, crown2: 0x8a6a30, water: 0x2e3a44,
      skyDay: 0xa8a294, skyDusk: 0xe8763a, skyNight: 0x120820, fogDay: 0xb0a898, fogNight: 0x160a24,
      sunDay: 0xf0e0c0, hemiDay: 0xb8a890, accent: 0xe8862e, snow: false,
    }),
    foliage: ["dead", "oak"],
    poiNames: ["Haunted Manor", "Pumpkin Patch", "Graveyard Row", "Corn Maze", "Candy Street", "Spider Woods", "Cemetery Gate", "Giant Skeleton Lawn", "Witch Hollow", "Foggy Thicket", "Thorn Ridge", "Hearse Depot"],
  },
  {
    id: "s3", title: "Fiestas Patrias", kit: "chile-fiestas-patrias-87e847",
    tagline: "Dieciocho under the Andes — cueca till you drop",
    pal: P({
      ground: 0xb0a470, ground2: 0x9c9060, dirt: 0x8a7c50, road: 0x9c8a62, roadLine: 0xf0e6c8,
      plaza: 0xc4b490, wall: [0xe8dcc0, 0xd2b894, 0xc4523a, 0x8fa8b8], roof: [0xb5443c, 0x8a5c38, 0x3c6e8f, 0x7a6a4c],
      trim: 0xf0e2c0, trunk: 0x6a5238, crown: 0x6a8a4a, crown2: 0x7e9c56, water: 0x3a88b0,
      skyDay: 0x9cc8e8, skyDusk: 0xf0b060, skyNight: 0x0c1426, fogDay: 0xccd8d8, fogNight: 0x0c1424,
      sunDay: 0xfff0d0, hemiDay: 0xc4d8dc, accent: 0xd23c3c, snow: false,
    }),
    foliage: ["oak", "cypress"],
    poiNames: ["Plaza de Armas", "La Fonda", "El Ramada", "Band Stage", "Adobe Farm", "Flag Hill", "Palm Grove", "Empanada Row", "Country Well", "Cart Yard", "Poplar Row", "Guirnalda Gate"],
  },
  {
    id: "s4", title: "Campground & Lake", kit: "campground-lake-ad32b0",
    tagline: "The lake is calm. The campers aren't.",
    pal: P({
      ground: 0x5e8a4a, ground2: 0x4e7a3e, dirt: 0x8a7450, road: 0x8a7a5c, roadLine: 0xe0d8b8,
      plaza: 0x8a7a5c, wall: [0x6e5238, 0x8a6a48, 0x4e3e2c, 0x3c6a8a], roof: [0x4a6a3a, 0x7a5c3c, 0x3c5a6e, 0x5c4432],
      trim: 0xe0d0a8, trunk: 0x5c4630, crown: 0x2e6b45, crown2: 0x3c7d50, water: 0x3a7ca8,
      skyDay: 0x9cc4e4, skyDusk: 0xefa45e, skyNight: 0x0a1424, fogDay: 0xc8dcd0, fogNight: 0x0a1424,
      sunDay: 0xfff2d8, hemiDay: 0xc4dcc8, accent: 0xe8a03c, snow: false,
    }),
    foliage: ["pine", "oak"],
    poiNames: ["Camp Square", "The Lake Dock", "Lookout Tower", "Tent Field", "Ranger Station", "Reed Shore", "Pine Ridge", "Swing Tree", "Wash House", "Trailhead", "Fire Ring", "Cabin Row"],
  },
  {
    id: "s5", title: "Countryside Railway", kit: "countryside-railway-9b4c57",
    tagline: "All aboard the last train before dusk",
    pal: P({
      ground: 0x7ca85e, ground2: 0x6a9650, dirt: 0x9a8a5e, road: 0x8a8468, roadLine: 0xe8e0c0,
      plaza: 0xb8b09a, wall: [0x9a5a44, 0xe0d4b4, 0x5c6a7a, 0xa89478], roof: [0x4a5a6e, 0x7a4a3c, 0x3c6a5a, 0x5c5244],
      trim: 0xe8d8b0, trunk: 0x5c4a34, crown: 0x5c8a48, crown2: 0x6e9c54, water: 0x3a88b0,
      skyDay: 0x9cc4e8, skyDusk: 0xf0a55e, skyNight: 0x0a1226, fogDay: 0xccdcd4, fogNight: 0x0a1226,
      sunDay: 0xfff0d4, hemiDay: 0xc4d8c4, accent: 0xc4463c, snow: false,
    }),
    foliage: ["oak", "cypress"],
    poiNames: ["Country Station", "Engine Shed", "Trestle Bridge", "Goods Yard", "Signal Box", "Level Crossing", "Platform Two", "Trackside Farm", "Semaphore Row", "Buddleia Bend", "Cow Parsley Field", "Siding Cottages"],
  },
  {
    id: "s6", title: "Skatepark", kit: "skatepark-0922a9",
    tagline: "Kickflip over the apocalypse",
    pal: P({
      ground: 0x8a9a84, ground2: 0x7a8a72, dirt: 0x6a6a5e, road: 0x6a6a6a, roadLine: 0xf0e04c,
      plaza: 0x9aa8a0, wall: [0xc4523a, 0x3a7ca8, 0xe0b53c, 0x4a4a4c], roof: [0x5a5a5e, 0x3a7ca8, 0xc4523a, 0x6a6a66],
      trim: 0xf0e04c, trunk: 0x5c4a34, crown: 0x5c8a48, crown2: 0x6e9c54, water: 0x3a88b0,
      skyDay: 0xa0c8e8, skyDusk: 0xefa45c, skyNight: 0x0c1224, fogDay: 0xccd4d0, fogNight: 0x0c1224,
      sunDay: 0xfff2dc, hemiDay: 0xc8d4cc, accent: 0xe0b53c, snow: false,
    }),
    foliage: ["oak"],
    poiNames: ["Main Bowl", "Grind Plaza", "The Overpass", "Skate Hall", "Snack Kiosk", "Rules Court", "Half-Pipe Hill", "Rail Garden", "Shop Corner", "Banner Row", "Sapling Street", "Floodlight Field"],
  },
  {
    id: "s7", title: "Construction Site", kit: "construction-site-9e40b0",
    tagline: "Hard hats required. Handguns optional.",
    pal: P({
      ground: 0xb0a080, ground2: 0x9c8c6e, dirt: 0x8a7a5c, road: 0x5c5c54, roadLine: 0xf0c83c,
      plaza: 0xa89878, wall: [0xe8b53c, 0x5a6a7a, 0xb0b0a8, 0x8a8a84], roof: [0xe8b53c, 0x7a8a96, 0x5c5c54, 0x6a6a66],
      trim: 0xf0c83c, trunk: 0x5c4a34, crown: 0x6a7a4a, crown2: 0x7c8a52, water: 0x4a6a7a,
      skyDay: 0xa8c4d8, skyDusk: 0xefa45c, skyNight: 0x0c1222, fogDay: 0xccd0cc, fogNight: 0x0c1222,
      sunDay: 0xfff0d4, hemiDay: 0xccd4c8, accent: 0xf0c83c, snow: false,
    }),
    foliage: ["dead"],
    poiNames: ["Core Site", "Crane Yard", "Cabin Row", "Steel Bay", "Mixer Depot", "Excavator Field", "Gantry Gate", "Formwork Plaza", "Scaffold Row", "Cone Street", "Walkway Tunnel", "Signpost Hill"],
  },
  {
    id: "s8", title: "Coast & Boardwalk", kit: "coast-and-boardwalk-d883fd",
    tagline: "Salt in the air, sand in your boots",
    pal: P({
      ground: 0xd8c88e, ground2: 0xcab880, dirt: 0xb8a472, road: 0xa8784e, roadLine: 0xf0e2c0,
      plaza: 0xb8a47c, wall: [0xe8e0d0, 0x4aa8c0, 0xe0705c, 0x3c788e], roof: [0xc05c48, 0x3c8898, 0x8a6a4e, 0x5c6a6e],
      trim: 0xf0e8d0, trunk: 0x7a5c3c, crown: 0x4e8a52, crown2: 0x5e9c5e, water: 0x2ea8c8,
      skyDay: 0xa4d0ec, skyDusk: 0xf0a862, skyNight: 0x081428, fogDay: 0xd0e4ec, fogNight: 0x081428,
      sunDay: 0xfff4dc, hemiDay: 0xccdce4, accent: 0xe86a5c, snow: false,
    }),
    foliage: ["palm", "oak"],
    poiNames: ["Pier Head", "Boardwalk Row", "Beach Huts", "Dune Field", "Lifeguard Bay", "Harbour Hut", "Amusement Arcade", "Boat Shed", "Marram Meadow", "Bollard Quay", "Dinghy Beach", "Sandcastle Cove"],
  },
  {
    id: "s9", title: "Alpine & Snow", kit: "alpine-and-snow-092f66",
    tagline: "The avalanche hides the horde. Barely.",
    pal: P({
      ground: 0xe8eef4, ground2: 0xd8e4ee, dirt: 0x9ca8b8, road: 0xc4d2de, roadLine: 0xf0f6fa,
      plaza: 0xd0dce6, wall: [0x6e4a30, 0x8a5c3c, 0x3c5a6e, 0x54432e], roof: [0x8a3530, 0x3c5a6e, 0x5c4432, 0x6a4a3a],
      trim: 0xf0e8d8, trunk: 0x4e3e2e, crown: 0x2e6448, crown2: 0x3a7654, water: 0x8ab8d8,
      skyDay: 0xa8d0f0, skyDusk: 0xf0a862, skyNight: 0x081224, fogDay: 0xdce8f2, fogNight: 0x081224,
      sunDay: 0xfff6e4, hemiDay: 0xd4e4f0, accent: 0xd8483c, snow: true,
    }),
    foliage: ["pine", "dead"],
    poiNames: ["Refuge Hut", "Ski Lift Base", "Lift Top Station", "Frozen Falls", "Chalet Row", "Hay Barn", "Piste Markers", "Snow Fence Run", "Toboggan Hill", "Boulder Field", "Rowan Ridge", "Fingerpost Fork"],
  },
  {
    id: "s10", title: "Stadium", kit: "stadium-5db167",
    tagline: "Final whistle? The night says otherwise.",
    pal: P({
      ground: 0x5e8e4e, ground2: 0x527e44, dirt: 0x8a8a6a, road: 0x5a5a5a, roadLine: 0xf0f0f0,
      plaza: 0x8a8a86, wall: [0x3c4a5a, 0xc8b23c, 0x6a6a72, 0x4a5a68], roof: [0x5a5a5e, 0xc8b23c, 0x3c4a5a, 0x6a6a66],
      trim: 0xf0f0f0, trunk: 0x5c4a34, crown: 0x5c8a48, crown2: 0x6e9c54, water: 0x3a88b0,
      skyDay: 0x9cc4e8, skyDusk: 0xefa45c, skyNight: 0x0a1224, fogDay: 0xccd4cc, fogNight: 0x0a1224,
      sunDay: 0xfff2d8, hemiDay: 0xc8d4c8, accent: 0xc8b23c, snow: false,
    }),
    foliage: ["oak"],
    poiNames: ["Main Gate", "Scoreboard End", "Grandstand Row", "Dugout Field", "Players' Tunnel", "Turnstile Court", "Floodlight Corner", "Press Box", "Clubhouse", "Ticket Row", "Goal Practice Field", "Store Shed"],
  },
  {
    id: "s11", title: "Frontier Town", kit: "frontier-town-a0085b",
    tagline: "High noon somewhere. Midnight here.",
    pal: P({
      ground: 0xc2a76a, ground2: 0xb0945c, dirt: 0x9c8450, road: 0xa08a5c, roadLine: 0xf0e4c0,
      plaza: 0xb8a070, wall: [0xa8764a, 0x8a5c38, 0xc89868, 0x6e4c30], roof: [0x7a4a2e, 0x5c3a26, 0x8a5c38, 0x6a4430],
      trim: 0xf0e0bc, trunk: 0x6a5234, crown: 0x6a7a44, crown2: 0x7c8a4e, water: 0x3c7a9c,
      skyDay: 0xa8c8e0, skyDusk: 0xefa45c, skyNight: 0x0e1226, fogDay: 0xd8ccac, fogNight: 0x0e1226,
      sunDay: 0xfff2d4, hemiDay: 0xd0c4a0, accent: 0xc4463c, snow: false,
    }),
    foliage: ["cactus", "dead"],
    poiNames: ["Main Street", "Saloon Row", "Sheriff's Office", "Mine Headframe", "Water Tower", "Livery Stable", "Schoolhouse", "Stagecoach Stop", "Wanted Corner", "Hitching Post", "Sagebrush Flats", "Saguaro Ridge"],
  },
  {
    id: "s12", title: "Día de Muertos", kit: "dia-de-muertos-f2f8f8",
    tagline: "Marigolds for the dead. They're still coming.",
    pal: P({
      ground: 0x8a7a5c, ground2: 0x7a6c50, dirt: 0x6a5c44, road: 0x6e6450, roadLine: 0xf0a03c,
      plaza: 0x9c8c6c, wall: [0xf0a03c, 0x3c7a8a, 0xe8d8b8, 0x5c6a7a], roof: [0xd85c3c, 0x3c7a8a, 0x8a5c38, 0x6a4a3a],
      trim: 0xf0a03c, trunk: 0x5c4a34, crown: 0x5a7a44, crown2: 0x6c8a4e, water: 0x3a7a9c,
      skyDay: 0xa0c4e0, skyDusk: 0xf0904c, skyNight: 0x100a1e, fogDay: 0xd0c8b0, fogNight: 0x100a1e,
      sunDay: 0xffeec8, hemiDay: 0xccccac, accent: 0xf0a03c, snow: false,
    }),
    foliage: ["oak", "cypress"],
    poiNames: ["Plaza Kiosco", "Ofrenda Square", "Parish Church", "Panteón Gate", "Mercado Row", "Cempasúchil Arch", "Colonial Street", "Cypress Walk", "Mesquite Field", "Agave Garden", "Papel Picado Lane", "Papel Plaza"],
  },
  {
    id: "s13", title: "Salvage Commons", kit: "salvage-commons-d0be9f",
    tagline: "One town's junk. Your survival.",
    pal: P({
      ground: 0x6e8a5c, ground2: 0x5e7a4e, dirt: 0x8a7c5c, road: 0x6a6a62, roadLine: 0xe0d8b8,
      plaza: 0x8a8a80, wall: [0x8a8a8a, 0xa87a3c, 0x5c6a7a, 0x7c7468], roof: [0x7a8a8a, 0x6a7a84, 0xa87a3c, 0x5c646a],
      trim: 0xe8d8a0, trunk: 0x5c4a34, crown: 0x5a8a48, crown2: 0x6c9c54, water: 0x3a7c94,
      skyDay: 0x9cc4dc, skyDusk: 0xefa45c, skyNight: 0x0a1222, fogDay: 0xccd4cc, fogNight: 0x0a1222,
      sunDay: 0xfff0d0, hemiDay: 0xc4d0c4, accent: 0xc88a3c, snow: false,
    }),
    foliage: ["oak", "dead"],
    poiNames: ["Arch Gatehouse", "Boiler Hall", "Gantry Loft", "Copper Dome", "Salvage Yard", "Cart Depot", "Fence Row", "Brass Lamp Way", "Fruit Grove", "Rock Field", "Grass Flats", "Plate Cottages"],
  },
  {
    id: "s14", title: "Cozy Farm", kit: "cozy-farm-cc979f",
    tagline: "Fresh hay, warm bread, cold undead",
    pal: P({
      ground: 0x6a9a4e, ground2: 0x5a8a42, dirt: 0x9a8054, road: 0x9a8a60, roadLine: 0xf0e4bc,
      plaza: 0x8a7c5c, wall: [0xb5443c, 0xe0d5bc, 0x8a5c38, 0x6e5a3c], roof: [0x8a3530, 0x4e6a44, 0x7a5c3c, 0x5c4a38],
      trim: 0xf0e8cc, trunk: 0x5c4a34, crown: 0x5c8a48, crown2: 0x6e9c54, water: 0x3a88b0,
      skyDay: 0x9cc8e4, skyDusk: 0xefa85e, skyNight: 0x0a1426, fogDay: 0xccd8c4, fogNight: 0x0a1426,
      sunDay: 0xfff2d8, hemiDay: 0xc8d8c0, accent: 0xd8a03c, snow: false,
    }),
    foliage: ["oak", "pine"],
    poiNames: ["Red Barn", "Farmhouse Yard", "Greenhouse Row", "Silo Field", "Stable Lane", "Orchard Grove", "Hay Field", "Farm Stand", "Windpump Rise", "Berry Patch", "Fence Corner", "Crate Yard"],
  },
  {
    id: "s15", title: "Little Tokyo", kit: "japanese-suburban-city-street-baa482",
    tagline: "Cherry blossoms fall. The horde doesn't.",
    pal: P({
      ground: 0x7a9a6a, ground2: 0x6a8a5c, dirt: 0x8a8468, road: 0x5c5c5c, roadLine: 0xf0f0f0,
      plaza: 0x9a9a92, wall: [0xe8e0d4, 0xc4523a, 0x5a6a7a, 0x8a8478], roof: [0x3c5a7a, 0x4a6a84, 0x5c5c5c, 0x3c4450],
      trim: 0xf0f0e8, trunk: 0x5c4a3c, crown: 0xe8a8c4, crown2: 0xd88cb0, water: 0x3a7ca8,
      skyDay: 0xa4c8e8, skyDusk: 0xefa05c, skyNight: 0x0a1224, fogDay: 0xd0d8d8, fogNight: 0x0a1224,
      sunDay: 0xfff2dc, hemiDay: 0xccd8d4, accent: 0xc4523a, snow: false,
    }),
    foliage: ["sakura", "pine"],
    poiNames: ["Torii Square", "Shrine Hill", "Shophouse Row", "Bathhouse Lane", "Conbini Corner", "Lion Statue Way", "Lantern Street", "Blossom Park", "Vending Row", "Stone Lantern Garden", "Machiya Lane", "Paper Light Row"],
  },
  {
    id: "s16", title: "Nature & Forest", kit: "nature-forest-kit-f29d6a",
    tagline: "Deep woods. Deeper trouble.",
    pal: P({
      ground: 0x4e7a3c, ground2: 0x446e34, dirt: 0x7a6a4c, road: 0x7a704e, roadLine: 0xe8e0c0,
      plaza: 0x7a6e50, wall: [0x5c4a34, 0x8a6a48, 0x3c5a44, 0x6a5a40], roof: [0x4a5a3e, 0x5c4432, 0x3c5a6e, 0x6a4a34],
      trim: 0xe0d0a8, trunk: 0x4e3e2c, crown: 0x2e6440, crown2: 0x3c7a50, water: 0x2e7c9c,
      skyDay: 0x94c4e4, skyDusk: 0xefa45e, skyNight: 0x081224, fogDay: 0xc4d8c4, fogNight: 0x081224,
      sunDay: 0xfff0d0, hemiDay: 0xc0d4bc, accent: 0xe0a03c, snow: false,
    }),
    foliage: ["pine", "oak", "cypress"],
    poiNames: ["Ranger Station", "Fire Lookout", "Log Cabin Row", "Rock Spire", "Trail Head", "Camp Firepit", "Birch Stand", "Maple Grove", "Oak Hollow", "Lean-To Row", "Fence Line", "Lantern Post Way"],
  },
  {
    id: "s17", title: "New York City", kit: "nyc-city-kit-fbca88",
    tagline: "If you can survive here…",
    pal: P({
      ground: 0x6e6e6e, ground2: 0x5e5e5e, dirt: 0x7a7a72, road: 0x4a4a4a, roadLine: 0xf0f0f0,
      plaza: 0x8a8a86, wall: [0x8a6a52, 0xc8b898, 0x7a7a82, 0x9a8468], roof: [0x5a5a5c, 0x4a4a4e, 0x6a5a4a, 0x54545a],
      trim: 0xf0f0f0, trunk: 0x4e4436, crown: 0x4e8a48, crown2: 0x5e9c54, water: 0x3a6a8a,
      skyDay: 0x9cc0e0, skyDusk: 0xefa05c, skyNight: 0x0a1222, fogDay: 0xcccccc, fogNight: 0x0a1222,
      sunDay: 0xfff0d0, hemiDay: 0xc8c8c4, accent: 0xe0b53c, snow: false,
    }),
    foliage: ["oak"],
    poiNames: ["Times Corner", "Brownstone Row", "Bank Block", "Movie Theater", "School Yard", "Fire House", "Hot Dog Row", "Subway Entrance", "Water Tower Roof", "Newsstand Way", "Bus Shelter Court", "Theater Street"],
  },
  {
    id: "s18", title: "Medieval Village", kit: "medieval-village-kit-ca0b43",
    tagline: "The plague doctor was right about the night",
    pal: P({
      ground: 0x7a9a5c, ground2: 0x6a8a4e, dirt: 0x8a7a54, road: 0x9a8a62, roadLine: 0xf0e4c0,
      plaza: 0xa89874, wall: [0xc8b898, 0x8a5c38, 0xa89878, 0xb0a484], roof: [0xb09a5c, 0x6a5238, 0x7c6a48, 0x5c4a38],
      trim: 0xf0e4c0, trunk: 0x5c4a34, crown: 0x5a8a44, crown2: 0x6c9c50, water: 0x3a80a0,
      skyDay: 0x9cc4e0, skyDusk: 0xefa45c, skyNight: 0x0a1224, fogDay: 0xccd4c0, fogNight: 0x0a1224,
      sunDay: 0xfff0d4, hemiDay: 0xc8d4bc, accent: 0xc8a03c, snow: false,
    }),
    foliage: ["oak", "cypress"],
    poiNames: ["Village Gate", "Tavern Square", "Stone Chapel", "Water Mill", "Market Row", "Well Yard", "Thatched Lane", "Blacksmith Forge", "Orchard Grove", "Windmill Rise", "Anvil Court", "Cart Way"],
  },
  {
    id: "s19", title: "Storybook Sandbox", kit: "this-is-a-whimsical-dd1bde",
    tagline: "Once upon a very bad night",
    pal: P({
      ground: 0x6ab85c, ground2: 0x5aa84e, dirt: 0x9a8a5c, road: 0xc8b88c, roadLine: 0xf0e8c8,
      plaza: 0xb8cc9a, wall: [0xf0b8c8, 0xa8d8e8, 0xf0e0a0, 0xc8e8b0], roof: [0xe86a8a, 0x5aa8c8, 0xe8b84c, 0x8ac8a0],
      trim: 0xf0f0e0, trunk: 0x6a5a42, crown: 0x5cb86a, crown2: 0x74cc7e, water: 0x4ab8d0,
      skyDay: 0xa8d8f0, skyDusk: 0xf0a870, skyNight: 0x0e1428, fogDay: 0xd4e8ec, fogNight: 0x0e1428,
      sunDay: 0xfff4e0, hemiDay: 0xd0e4e0, accent: 0xe86a8a, snow: false,
    }),
    foliage: ["oak", "pine"],
    poiNames: ["Carousel Plaza", "Lighthouse Point", "Candy Cart Row", "Cube House Court", "Toy School", "Toy Hospital", "Dragon Boat Dock", "Swan Lake", "Queue Rail Yard", "Entrance Arch", "Topiary Garden", "Lollipop Lane"],
  },
  {
    id: "s20", title: "Ancient Egypt", kit: "ancient-egypt-3a3a52",
    tagline: "The pyramids keep their secrets. The mounds don't.",
    pal: P({
      ground: 0xd8c090, ground2: 0xc8b080, dirt: 0xb09a6c, road: 0xb8a478, roadLine: 0xf0e4c0,
      plaza: 0xc8b488, wall: [0xc8a868, 0xb89858, 0xd8c088, 0xa88848], roof: [0xc8a868, 0xb09050, 0xa88848, 0xc0a058],
      trim: 0xe8d0a0, trunk: 0x6e5638, crown: 0x5a8a48, crown2: 0x6c9c54, water: 0x2e8ab0,
      skyDay: 0xa4cce8, skyDusk: 0xefa45c, skyNight: 0x0c1224, fogDay: 0xdcd0b0, fogNight: 0x0c1224,
      sunDay: 0xfff2d0, hemiDay: 0xd0ccb0, accent: 0xd8a03c, snow: false,
    }),
    foliage: ["palm"],
    poiNames: ["Great Pyramid", "Sphinx Plaza", "Obelisk Row", "Temple of Columns", "River Landing", "Scribe Quarters", "Scarab Court", "Tomb Field", "Palm Oasis", "Bazaar Lane", "Boat Dock", "Sphinx Lawn"],
  },
  {
    id: "s21", title: "Myths of Olympus", kit: "myths-of-olympus-d03622",
    tagline: "Zeus is watching. So are the dead.",
    pal: P({
      ground: 0x8aa878, ground2: 0x7a9a68, dirt: 0x8a8a6c, road: 0xb0a888, roadLine: 0xf0ead0,
      plaza: 0xc8c0ac, wall: [0xe8e4d8, 0xd8d0bc, 0xc8a850, 0xb8b0a0], roof: [0xa8a294, 0xc8a850, 0x8a8478, 0xb0aa9c],
      trim: 0xe8c860, trunk: 0x5c4a34, crown: 0x4a7a44, crown2: 0x5c8a50, water: 0x3a8ab0,
      skyDay: 0x9cc8e8, skyDusk: 0xefa05c, skyNight: 0x0a1224, fogDay: 0xd0d8d0, fogNight: 0x0a1224,
      sunDay: 0xfff4dc, hemiDay: 0xccd8d0, accent: 0xd8b050, snow: false,
    }),
    foliage: ["cypress", "oak"],
    poiNames: ["Golden Gate", "Throne of Zeus", "Hall of the Gods", "Peripteral Temple", "Tholos Circle", "Fountain House", "Propylon Way", "Brazier Row", "Chariot Field", "Laurel Grove", "Statue Court", "Tripod Plaza"],
  },
  {
    id: "s22", title: "Three Kingdoms", kit: "three-kingdoms-settlements-a-1e817b",
    tagline: "Three banners. One horde.",
    pal: P({
      ground: 0x7a9a6a, ground2: 0x6a8a5c, dirt: 0x8a805c, road: 0x8a8060, roadLine: 0xf0e4c0,
      plaza: 0xa89c78, wall: [0xa8422e, 0xe0d0b0, 0x5c6a7a, 0x8a7c60], roof: [0x4a5a6e, 0x3c5a6a, 0x8a5c38, 0x54545c],
      trim: 0xf0e4c0, trunk: 0x5c4a34, crown: 0x5a8a48, crown2: 0x6c9c54, water: 0x3a7ca4,
      skyDay: 0x9cc4e4, skyDusk: 0xefa45c, skyNight: 0x0a1224, fogDay: 0xccd4c4, fogNight: 0x0a1224,
      sunDay: 0xfff0d0, hemiDay: 0xc8d4c0, accent: 0xc8422e, snow: false,
    }),
    foliage: ["oak", "bamboo"],
    poiNames: ["City Gate", "Audience Hall", "Ancestral Shrine", "Courtyard Homes", "Beacon Tower", "Wall Run", "Market Court", "Willow Pond", "Jujube Grove", "Well Yard", "Bridge Plaza", "Farm Fields"],
  },
  {
    id: "s23", title: "Mediterranean Island", kit: "mediterranean-island-village-4ac936",
    tagline: "Azure water, white walls, red eyes at night",
    pal: P({
      ground: 0xb0a878, ground2: 0xa09868, dirt: 0x96885c, road: 0xb8ac8c, roadLine: 0xf0ead8,
      plaza: 0xd8d0bc, wall: [0xe8e0d0, 0xf0ead8, 0x3c78a8, 0xd8c8b0], roof: [0x4a78a8, 0x3c6a9c, 0x8a8478, 0x5c7a94],
      trim: 0x3c78a8, trunk: 0x6e5a3c, crown: 0x3e6e44, crown2: 0x4c7e4e, water: 0x2e9ac0,
      skyDay: 0xa4d0ec, skyDusk: 0xf0a862, skyNight: 0x081428, fogDay: 0xd4e4ec, fogNight: 0x081428,
      sunDay: 0xfff4dc, hemiDay: 0xccdce4, accent: 0x3c78a8, snow: false,
    }),
    foliage: ["cypress", "palm"],
    poiNames: ["Bell Tower Plaza", "Blue-Dome Chapel", "Kafeneio Row", "Taverna Quay", "Domed Church", "Cube House Court", "Olive Grove", "Harbour Jetty", "Cactus Ridge", "Pot Stall Lane", "Bench Garden", "Fishing Dock"],
  },
  {
    id: "s24", title: "Airport", kit: "airport-43b137",
    tagline: "Last flight out left hours ago",
    pal: P({
      ground: 0x7a8a7a, ground2: 0x6a7a6c, dirt: 0x8a8a7c, road: 0x3c3c3e, roadLine: 0xf0f0f0,
      plaza: 0x8a8a88, wall: [0x8a92a0, 0xc8b23c, 0x5a6470, 0x7a828e], roof: [0x5a6470, 0xc8b23c, 0x4a525c, 0x6a7280],
      trim: 0xf0f0f0, trunk: 0x54443a, crown: 0x4e8a48, crown2: 0x5e9c52, water: 0x3a7c9c,
      skyDay: 0x9cc4e8, skyDusk: 0xefa45c, skyNight: 0x0a1224, fogDay: 0xccd4d4, fogNight: 0x0a1224,
      sunDay: 0xfff0d4, hemiDay: 0xc8d4d4, accent: 0xc8b23c, snow: false,
    }),
    foliage: ["oak"],
    poiNames: ["Control Tower", "Terminal Bay", "Runway Alpha", "Hangar Row", "Hotel Block", "Car Park Deck", "Cargo Shed", "Fire Station", "Jet Bridge Court", "Baggage Yard", "Windsock Field", "Follow-Me Lane"],
  },
  {
    id: "s25", title: "Easter Island", kit: "easter-island-rapa-nui-368e86",
    tagline: "The moai never blink. The dead never stop.",
    pal: P({
      ground: 0x5e8e4c, ground2: 0x527e40, dirt: 0x8a7a54, road: 0x9a8a62, roadLine: 0xf0e4c0,
      plaza: 0x8a8a7c, wall: [0x7a7468, 0x8a8478, 0x9a9488, 0x6e6a5e], roof: [0x5c5448, 0x6a6458, 0x7a6a4c, 0x54544c],
      trim: 0xe8e0cc, trunk: 0x5c4c38, crown: 0x4a8a4c, crown2: 0x5c9c58, water: 0x2e8ac0,
      skyDay: 0x9cc8e8, skyDusk: 0xefa45c, skyNight: 0x0a1226, fogDay: 0xccd8cc, fogNight: 0x0a1226,
      sunDay: 0xfff0d0, hemiDay: 0xc8d4c4, accent: 0x8a8478, snow: false,
    }),
    foliage: ["palm", "oak"],
    poiNames: ["Moai Terrace", "Kneeling Row", "Boat House Bay", "Chicken House", "Orongo Village", "Stone Tower", "Petroglyph Field", "Topknot Quarry", "Reed Bed", "Basalt Boulders", "Jetty Landing", "Canoe Beach"],
  },
  {
    id: "s26", title: "Roadside Americana", kit: "roadside-americana-50d40c",
    tagline: "Route 66 ends here. The night doesn't.",
    pal: P({
      ground: 0xc2a878, ground2: 0xb09868, dirt: 0x9c8454, road: 0x6a6a6c, roadLine: 0xf0d04c,
      plaza: 0xb8a474, wall: [0xd85c3c, 0x3ca8a0, 0xe8c03c, 0xc8b088], roof: [0xc04a3c, 0x3ca8a0, 0x8a8478, 0x5c6a6e],
      trim: 0xf0d04c, trunk: 0x6a5438, crown: 0x6a7a44, crown2: 0x7c8a4e, water: 0x3a7c9c,
      skyDay: 0xa4c8e4, skyDusk: 0xefa45c, skyNight: 0x0e1226, fogDay: 0xd8ccb0, fogNight: 0x0e1226,
      sunDay: 0xfff2d0, hemiDay: 0xd0c8ac, accent: 0xe86a5c, snow: false,
    }),
    foliage: ["cactus", "dead"],
    poiNames: ["Motel Row", "Neon Sign Court", "Diner Plaza", "Gas Pump Row", "Garage Bay", "Billboard Field", "Route Shield", "Souvenir Stand", "Joshua Flats", "Mileage Corner", "Water Tower", "Tumbleweed Basin"],
  },
  {
    id: "s27", title: "Medieval Japan", kit: "medieval-japan-cb01ad",
    tagline: "The pagoda bells toll for the living",
    pal: P({
      ground: 0x7a9a6a, ground2: 0x6a8a5c, dirt: 0x8a7c58, road: 0x8a8468, roadLine: 0xf0e8cc,
      plaza: 0xa89c7c, wall: [0x8a5c38, 0xe8e0d0, 0x5c6a7a, 0x7c7468], roof: [0x4a5a6a, 0x3c4a58, 0x5c646e, 0x444450],
      trim: 0xc4523a, trunk: 0x54443a, crown: 0xe8a8c4, crown2: 0xd88cb0, water: 0x3a7ca4,
      skyDay: 0xa0c8e8, skyDusk: 0xefa05c, skyNight: 0x0a1224, fogDay: 0xd0d8d0, fogNight: 0x0a1224,
      sunDay: 0xfff2dc, hemiDay: 0xccd8d4, accent: 0xc4523a, snow: false,
    }),
    foliage: ["sakura", "pine"],
    poiNames: ["Castle Gate", "Tenshu Keep", "Pagoda Hill", "Temple Hall", "Machiya Row", "Kura Storehouse", "Stone Wall Path", "Bamboo Grove", "Maple Garden", "Fire Basket Way", "Basin Court", "Sculpted Pine Yard"],
  },
];

export const SEASON_BY_ID: Record<string, SeasonDef> = Object.fromEntries(
  SEASONS.map((s) => [s.id, s]),
);

/** arena side length in km for a season def (default 4). */
export function seasonSizeKm(def: { sizeKm?: number } | null | undefined): number {
  return def?.sizeKm ?? 4;
}

/** Ordered list for the season picker (S1 → S27). */
export function seasonList(): { id: string; title: string; tagline: string; kit: string; sizeKm: number }[] {
  return SEASONS.map((s) => ({ id: s.id, title: s.title, tagline: s.tagline, kit: s.kit, sizeKm: seasonSizeKm(s) }));
}

/** Does a season have vendored kit pieces (all but the procedural-only S20)? */
export function seasonHasAssets(id: string): boolean {
  return (SEASON_ASSETS[id] ?? []).length > 0;
}

export type { SeasonAssetDef };
