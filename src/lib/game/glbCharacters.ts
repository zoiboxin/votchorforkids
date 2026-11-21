import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/* 🧍 Polyfork character cast — real rigged, animated low-poly humans  */
/*                                                                     */
/* The Polyfork catalog (polyfork.dev, CC BY 4.0 — credited in the     */
/* graveyard kit too) serves ~206 self-contained character GLBs: one   */
/* shared Mixamo-style skeleton, ~3–5k triangles, vertex colors (no    */
/* textures) and embedded "Idle" / "Walk" / "Run" clips in every file. */
/* Real-world scale (~1.7–1.8 m, feet at the origin, Y-up, +Z front).  */
/*                                                                     */
/* This module owns the CAST: a fixed pool of 12 townsfolk + 1 police  */
/* officer that the whole town shares. Files stream in on first play   */
/* (parallel download, sequential main-thread parse), then every body  */
/* is a SkeletonUtils.clone of the cached template — one shared        */
/* geometry set per character no matter how many souls wear it.        */
/* ------------------------------------------------------------------ */

export interface GlbCharacterDef {
  slug: string;
  name: string;
  emoji: string;
  url: string;
  /** polyfork kit/area this citizen belongs to (see GLB_AREAS) */
  area: string;
}

/* --- the standard Mixamo bone set every cast GLB shares -------------------
 * Procedural overlays (jump / fight / dance / death / drive …) ride these
 * named bones directly — one pose table animates the whole cast, because
 * every Polyfork character ships the identical 22-joint skeleton.        */
export const GLB_BONES = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
] as const;
export type GlbBoneName = (typeof GLB_BONES)[number];

const cdn = (slug: string) => `https://polyfork.dev/cdn/${slug}.glb`;

/** The TOWN CAST — the preloaded crew the city itself wears (bots, living
 *  city, police). Streams in at menu time; the rest of the catalog loads on
 *  demand when a player browses its area in the creator. */
export const GLB_CHARACTERS: readonly GlbCharacterDef[] = [
  { slug: "airline-pilot-63226a", name: "Airline Pilot", emoji: "✈️", url: cdn("airline-pilot-63226a"), area: "airport" },
  { slug: "flight-attendant-befaf4", name: "Flight Attendant", emoji: "🛫", url: cdn("flight-attendant-befaf4"), area: "airport" },
  { slug: "traveller-92f20c", name: "Traveller", emoji: "🎒", url: cdn("traveller-92f20c"), area: "airport" },
  { slug: "aircraft-maintenance-engineer-8bd28d", name: "Aircraft Engineer", emoji: "🔧", url: cdn("aircraft-maintenance-engineer-8bd28d"), area: "airport" },
  { slug: "ground-marshaller-8e8631", name: "Ground Marshaller", emoji: "🦺", url: cdn("ground-marshaller-8e8631"), area: "airport" },
  { slug: "fuel-technician-df4ce0", name: "Fuel Technician", emoji: "⛽", url: cdn("fuel-technician-df4ce0"), area: "airport" },
  { slug: "bellhop-053c4d", name: "Bellhop", emoji: "🛎️", url: cdn("bellhop-053c4d"), area: "casino" },
  { slug: "blackjack-dealer-fc0ab1", name: "Blackjack Dealer", emoji: "🎰", url: cdn("blackjack-dealer-fc0ab1"), area: "casino" },
  { slug: "lounge-bartender-9d425a", name: "Lounge Bartender", emoji: "🍹", url: cdn("lounge-bartender-9d425a"), area: "casino" },
  { slug: "carving-chef-102bf5", name: "Carving Chef", emoji: "🔪", url: cdn("carving-chef-102bf5"), area: "casino" },
  { slug: "pit-boss-234a94", name: "Pit Boss", emoji: "♠️", url: cdn("pit-boss-234a94"), area: "casino" },
  { slug: "cocktail-server-eb211b", name: "Cocktail Server", emoji: "🍸", url: cdn("cocktail-server-eb211b"), area: "casino" },
];

/** Police crew + officers wear the security officer — instantly recognizable. */
export const POLICE_CHAR = "airport-security-officer-8fd38a";
export const POLICE_CHAR_DEF: GlbCharacterDef = {
  slug: POLICE_CHAR, name: "Security Officer", emoji: "👮", url: cdn(POLICE_CHAR), area: "airport",
};

/* ================== area catalog (generated from the Polyfork
   characters.md index — 206 rigged citizens across 37 areas) ================== */

interface CatalogArea { id: string; name: string; emoji: string; }

/** Area metadata in dropdown order (Town Cast first is added separately). */
const CATALOG_AREAS: readonly CatalogArea[] = [
  { id: "airport", name: "Airport", emoji: "✈️" },
  { id: "casino", name: "Hotel & Casino", emoji: "🎰" },
  { id: "railway", name: "Countryside Railway", emoji: "🚂" },
  { id: "skatepark", name: "Skatepark", emoji: "🛹" },
  { id: "halloween", name: "Halloween Night", emoji: "🎃" },
  { id: "stadium", name: "Stadium", emoji: "🏟️" },
  { id: "nyc", name: "New York City", emoji: "🗽" },
  { id: "fiestas", name: "Fiestas Patrias", emoji: "🇨🇱" },
  { id: "university", name: "University", emoji: "🎓" },
  { id: "space", name: "Space Base", emoji: "🚀" },
  { id: "roadside", name: "Roadside Americana", emoji: "🛻" },
  { id: "medieval-japan", name: "Medieval Japan", emoji: "⛩️" },
  { id: "frontier", name: "Frontier Town", emoji: "🤠" },
  { id: "muertos", name: "Día de Muertos", emoji: "💀" },
  { id: "hospital", name: "Hospital", emoji: "🏥" },
  { id: "dungeon", name: "Dungeon & Crypt", emoji: "🗝️" },
  { id: "construction", name: "Construction Site", emoji: "🏗️" },
  { id: "campground", name: "Campground & Lake", emoji: "🏕️" },
  { id: "sky", name: "Sky Town", emoji: "🛩️" },
  { id: "lab", name: "Research Lab", emoji: "🧪" },
  { id: "pirate", name: "Pirate Cove", emoji: "🏴‍☠️" },
  { id: "medieval-village", name: "Medieval Village", emoji: "🏰" },
  { id: "runes", name: "Emerald Gilded Runes", emoji: "🧙" },
  { id: "dragon", name: "Dragon's Lair", emoji: "🐉" },
  { id: "coast", name: "Coast & Boardwalk", emoji: "🏖️" },
  { id: "alpine", name: "Alpine & Snow", emoji: "🏔️" },
  { id: "office", name: "Office", emoji: "💼" },
  { id: "cafe", name: "Restaurant Café", emoji: "☕" },
  { id: "tokyo", name: "Little Tokyo", emoji: "🏮" },
  { id: "easter", name: "Easter Island", emoji: "🗿" },
  { id: "arcology", name: "Chrome Arcology", emoji: "🚄" },
  { id: "neighborhood", name: "Neighborhood", emoji: "🏘️" },
  { id: "forest", name: "Nature & Forest", emoji: "🌲" },
  { id: "reefscape", name: "Office Reefscape", emoji: "🐠" },
  { id: "farm", name: "Cozy Farm", emoji: "🐓" },
  { id: "coral", name: "Coral Reef", emoji: "🪸" },
  { id: "drifters", name: "Drifters", emoji: "🧭" },
];

/** Every catalog citizen, tagged with its area id. */
const CATALOG_CHARS_RAW: readonly Omit<GlbCharacterDef, "url">[] = [
  { slug: "aircraft-maintenance-engineer-8bd28d", name: "Aircraft Maintenance Engineer", emoji: "🔧", area: "airport" },
  { slug: "airline-pilot-63226a", name: "Airline Pilot", emoji: "✈️", area: "airport" },
  { slug: "airport-security-officer-8fd38a", name: "Airport Security Officer", emoji: "💂", area: "airport" },
  { slug: "baggage-handler-0823f5", name: "Baggage Handler", emoji: "🧳", area: "airport" },
  { slug: "flight-attendant-befaf4", name: "Flight Attendant", emoji: "🛫", area: "airport" },
  { slug: "fuel-technician-df4ce0", name: "Fuel Technician", emoji: "⛽", area: "airport" },
  { slug: "ground-marshaller-8e8631", name: "Ground Marshaller", emoji: "🦺", area: "airport" },
  { slug: "traveller-92f20c", name: "Traveller", emoji: "🎒", area: "airport" },
  { slug: "arriving-hotel-guest-b03353", name: "Arriving Hotel Guest", emoji: "🧳", area: "casino" },
  { slug: "bellhop-053c4d", name: "Bellhop", emoji: "🛎️", area: "casino" },
  { slug: "blackjack-dealer-fc0ab1", name: "Blackjack Dealer", emoji: "🃏", area: "casino" },
  { slug: "cage-cashier-f76725", name: "Cage Cashier", emoji: "💵", area: "casino" },
  { slug: "carving-chef-102bf5", name: "Carving Chef", emoji: "🔪", area: "casino" },
  { slug: "casino-security-officer-adca27", name: "Casino Security Officer", emoji: "💂", area: "casino" },
  { slug: "cocktail-server-eb211b", name: "Cocktail Server", emoji: "🍸", area: "casino" },
  { slug: "front-desk-clerk-99f0c2", name: "Front Desk Clerk", emoji: "🗄️", area: "casino" },
  { slug: "high-roller-9d0aa1", name: "High Roller", emoji: "🛼", area: "casino" },
  { slug: "lounge-bartender-9d425a", name: "Lounge Bartender", emoji: "🍹", area: "casino" },
  { slug: "lounge-crooner-ad77ec", name: "Lounge Crooner", emoji: "🎤", area: "casino" },
  { slug: "pit-boss-234a94", name: "Pit Boss", emoji: "🎰", area: "casino" },
  { slug: "poker-pro-da0258", name: "Poker Pro", emoji: "🎰", area: "casino" },
  { slug: "pool-guest-78b655", name: "Pool Guest", emoji: "🧳", area: "casino" },
  { slug: "room-attendant-a5a309", name: "Room Attendant", emoji: "🛎️", area: "casino" },
  { slug: "showgirl-5bfa7a", name: "Showgirl", emoji: "💃", area: "casino" },
  { slug: "slot-tourist-08b37d", name: "Slot Tourist", emoji: "📸", area: "casino" },
  { slug: "stage-magician-2ecd48", name: "Stage Magician", emoji: "🎩", area: "casino" },
  { slug: "uniformed-floor-guard-d06c03", name: "Uniformed Floor Guard", emoji: "💂", area: "casino" },
  { slug: "valet-attendant-c351e6", name: "Valet Attendant", emoji: "🅿️", area: "casino" },
  { slug: "crossing-keeper-e13207", name: "Crossing Keeper", emoji: "🚂", area: "railway" },
  { slug: "engine-driver-1ba1e2", name: "Engine Driver", emoji: "🚂", area: "railway" },
  { slug: "fireman-96bf23", name: "Fireman", emoji: "🚂", area: "railway" },
  { slug: "guard-bfa819", name: "Guard", emoji: "💂", area: "railway" },
  { slug: "passenger-ac425a", name: "Passenger", emoji: "🚂", area: "railway" },
  { slug: "platelayer-47dbe6", name: "Platelayer", emoji: "🚂", area: "railway" },
  { slug: "porter-e4e566", name: "Porter", emoji: "🚂", area: "railway" },
  { slug: "railway-carter-971897", name: "Railway Carter", emoji: "🚂", area: "railway" },
  { slug: "shunter-f25d24", name: "Shunter", emoji: "🏹", area: "railway" },
  { slug: "signalman-c561d7", name: "Signalman", emoji: "🚂", area: "railway" },
  { slug: "station-master-1d6a0a", name: "Station Master", emoji: "🚂", area: "railway" },
  { slug: "trainspotter-ffd141", name: "Trainspotter", emoji: "🚂", area: "railway" },
  { slug: "waving-child-dfada0", name: "Waving Child", emoji: "🚂", area: "railway" },
  { slug: "beginner-kid-skater-1ad8ab", name: "Beginner Kid Skater", emoji: "🛹", area: "skatepark" },
  { slug: "bmx-rider-91f1b0", name: "BMX Rider", emoji: "🛹", area: "skatepark" },
  { slug: "graffiti-artist-2deb3d", name: "Graffiti Artist", emoji: "🎨", area: "skatepark" },
  { slug: "longboarder-0ea806", name: "Longboarder", emoji: "🛹", area: "skatepark" },
  { slug: "roller-skater-841ec1", name: "Roller Skater", emoji: "🛹", area: "skatepark" },
  { slug: "scooter-kid-28cff9", name: "Scooter Kid", emoji: "🛹", area: "skatepark" },
  { slug: "skate-coach-53be7d", name: "Skate Coach", emoji: "📣", area: "skatepark" },
  { slug: "skate-filmer-b9d393", name: "Skate Filmer", emoji: "🛹", area: "skatepark" },
  { slug: "skate-shop-owner-137ca9", name: "Skate Shop Owner", emoji: "🛹", area: "skatepark" },
  { slug: "street-skater-4ee28b", name: "Street Skater", emoji: "🛹", area: "skatepark" },
  { slug: "vert-skater-972639", name: "Vert Skater", emoji: "🛹", area: "skatepark" },
  { slug: "veteran-pool-skater-2c63ab", name: "Veteran Pool Skater", emoji: "🛹", area: "skatepark" },
  { slug: "kid-in-a-bedsheet-f9c403", name: "Kid in a Bedsheet Ghost Costume", emoji: "👻", area: "halloween" },
  { slug: "kid-in-a-black-2e5f87", name: "Kid in a Black Cat Costume", emoji: "🎃", area: "halloween" },
  { slug: "kid-in-a-caped-663f11", name: "Kid in a Caped Hero Costume", emoji: "🎃", area: "halloween" },
  { slug: "kid-in-a-cardboard-670f7d", name: "Kid in a Cardboard Robot Costume", emoji: "🤖", area: "halloween" },
  { slug: "kid-in-a-pumpkin-169f79", name: "Kid in a Pumpkin Costume", emoji: "🎃", area: "halloween" },
  { slug: "kid-in-a-skeleton-6bb49d", name: "Kid in a Skeleton Suit", emoji: "💀", area: "halloween" },
  { slug: "kid-witch-01c770", name: "Kid Witch", emoji: "🧙‍♀️", area: "halloween" },
  { slug: "neighbour-handing-out-candy-2c1159", name: "Neighbour Handing Out Candy", emoji: "🎃", area: "halloween" },
  { slug: "parent-chaperone-79e535", name: "Parent Chaperone", emoji: "🎃", area: "halloween" },
  { slug: "pumpkin-stand-keeper-77ced9", name: "Pumpkin Stand Keeper", emoji: "🎃", area: "halloween" },
  { slug: "teen-zombie-b5bb27", name: "Teen Zombie", emoji: "🧟", area: "halloween" },
  { slug: "cheerleader-90875e", name: "Cheerleader", emoji: "📣", area: "stadium" },
  { slug: "goalkeeper-10017a", name: "Goalkeeper", emoji: "🥅", area: "stadium" },
  { slug: "gridiron-player-9d4168", name: "Gridiron Player", emoji: "⚽", area: "stadium" },
  { slug: "groundskeeper-71be56", name: "Groundskeeper", emoji: "🏟️", area: "stadium" },
  { slug: "outfield-player-2b742a", name: "Outfield Player", emoji: "⚽", area: "stadium" },
  { slug: "referee-9e9e73", name: "Referee", emoji: "🟨", area: "stadium" },
  { slug: "spectator-d086fe", name: "Spectator", emoji: "🏟️", area: "stadium" },
  { slug: "team-mascot-abf426", name: "Team Mascot", emoji: "🏟️", area: "stadium" },
  { slug: "touchline-manager-13a94b", name: "Touchline Manager", emoji: "📋", area: "stadium" },
  { slug: "commuter-381e7f", name: "Commuter", emoji: "🗽", area: "nyc" },
  { slug: "construction-worker-c1ad8c", name: "Construction Worker", emoji: "⛑️", area: "nyc" },
  { slug: "delivery-courier-327e30", name: "Delivery Courier", emoji: "🗽", area: "nyc" },
  { slug: "doorman-3f2e09", name: "Doorman", emoji: "🗽", area: "nyc" },
  { slug: "firefighter-b13b36", name: "Firefighter", emoji: "🚒", area: "nyc" },
  { slug: "police-officer-1cc379", name: "Police Officer", emoji: "👮", area: "nyc" },
  { slug: "schoolkid-da94c1", name: "Schoolkid", emoji: "🗽", area: "nyc" },
  { slug: "street-vendor-139de3", name: "Street Vendor", emoji: "🌭", area: "nyc" },
  { slug: "china-cueca-dancer-c1707a", name: "China, Cueca Dancer", emoji: "💃", area: "fiestas" },
  { slug: "chinchinero-2cc296", name: "Chinchinero", emoji: "🇨🇱", area: "fiestas" },
  { slug: "cueca-musician-d71a2e", name: "Cueca Musician", emoji: "🎸", area: "fiestas" },
  { slug: "huaso-c4847f", name: "Huaso", emoji: "🇨🇱", area: "fiestas" },
  { slug: "kite-kid-0a7d70", name: "Kite Kid", emoji: "🇨🇱", area: "fiestas" },
  { slug: "organillero-67b687", name: "Organillero", emoji: "🇨🇱", area: "fiestas" },
  { slug: "parrilla-cook-255918", name: "Parrilla Cook", emoji: "🍳", area: "fiestas" },
  { slug: "graduate-in-gown-c72050", name: "Graduate in Gown", emoji: "🎓", area: "university" },
  { slug: "groundskeeper-3e5578", name: "Groundskeeper", emoji: "🎓", area: "university" },
  { slug: "professor-14dc4d", name: "Professor", emoji: "🎓", area: "university" },
  { slug: "student-in-a-hoodie-7c8223", name: "Student in a Hoodie", emoji: "🎒", area: "university" },
  { slug: "student-with-backpack-65d2b4", name: "Student with Backpack", emoji: "🎒", area: "university" },
  { slug: "tour-guide-1b0428", name: "Tour Guide", emoji: "🗺️", area: "university" },
  { slug: "astronaut-engineer-20b738", name: "Astronaut Engineer", emoji: "🔧", area: "space" },
  { slug: "astronaut-explorer-323482", name: "Astronaut Explorer", emoji: "👨‍🚀", area: "space" },
  { slug: "astronaut-scientist-47d733", name: "Astronaut Scientist", emoji: "🧪", area: "space" },
  { slug: "base-commander-0ec028", name: "Base Commander", emoji: "🚀", area: "space" },
  { slug: "service-robot-93f82e", name: "Service Robot", emoji: "🤖", area: "space" },
  { slug: "shuttle-pilot-067166", name: "Shuttle Pilot", emoji: "✈️", area: "space" },
  { slug: "diner-waitress-60f6a1", name: "Diner Waitress", emoji: "🍽️", area: "roadside" },
  { slug: "family-road-tripper-247570", name: "Family Road-Tripper", emoji: "🛻", area: "roadside" },
  { slug: "gas-station-attendant-38bd86", name: "Gas Station Attendant", emoji: "🛎️", area: "roadside" },
  { slug: "highway-patrol-officer-e81282", name: "Highway Patrol Officer", emoji: "👮", area: "roadside" },
  { slug: "motel-clerk-950c39", name: "Motel Clerk", emoji: "🗄️", area: "roadside" },
  { slug: "trucker-9266a8", name: "Trucker", emoji: "🛻", area: "roadside" },
  { slug: "ashigaru-foot-soldier-806707", name: "Ashigaru Foot Soldier", emoji: "🪖", area: "medieval-japan" },
  { slug: "buddhist-monk-39f498", name: "Buddhist Monk", emoji: "🧘", area: "medieval-japan" },
  { slug: "daimyo-lord-78364a", name: "Daimyo Lord", emoji: "⛩️", area: "medieval-japan" },
  { slug: "farmer-363820", name: "Farmer", emoji: "🧑‍🌾", area: "medieval-japan" },
  { slug: "samurai-warrior-f2ebbe", name: "Samurai Warrior", emoji: "🗡️", area: "medieval-japan" },
  { slug: "townswoman-5ca8b5", name: "Townswoman", emoji: "⛩️", area: "medieval-japan" },
  { slug: "outlaw-e0fd6a", name: "Outlaw", emoji: "🔫", area: "frontier" },
  { slug: "preacher-a49199", name: "Preacher", emoji: "⛪", area: "frontier" },
  { slug: "prospector-69a481", name: "Prospector", emoji: "⛏️", area: "frontier" },
  { slug: "saloon-keeper-5eed40", name: "Saloon Keeper", emoji: "🤠", area: "frontier" },
  { slug: "sheriff-986181", name: "Sheriff", emoji: "🤠", area: "frontier" },
  { slug: "townswoman-5aa87f", name: "Townswoman", emoji: "🤠", area: "frontier" },
  { slug: "child-with-a-painted-b8a19f", name: "Child With A Painted Face", emoji: "💀", area: "muertos" },
  { slug: "el-catr-n-be48ea", name: "El Catrín", emoji: "💀", area: "muertos" },
  { slug: "flower-vendor-bc708b", name: "Flower Vendor", emoji: "🌭", area: "muertos" },
  { slug: "grandmother-in-a-rebozo-4d5190", name: "Grandmother In A Rebozo", emoji: "💀", area: "muertos" },
  { slug: "la-catrina-b427ca", name: "La Catrina", emoji: "💀", area: "muertos" },
  { slug: "skeleton-mariachi-c1b4d5", name: "Skeleton Mariachi", emoji: "💀", area: "muertos" },
  { slug: "doctor-d49de0", name: "Doctor", emoji: "🩻", area: "hospital" },
  { slug: "paramedic-b0f358", name: "Paramedic", emoji: "🩺", area: "hospital" },
  { slug: "patient-in-gown-fdab75", name: "Patient In Gown", emoji: "🏥", area: "hospital" },
  { slug: "surgeon-in-scrubs-4f1360", name: "Surgeon In Scrubs", emoji: "🩻", area: "hospital" },
  { slug: "ward-nurse-84b61d", name: "Ward Nurse", emoji: "💉", area: "hospital" },
  { slug: "armoured-knight-hero-07121f", name: "Armoured Knight Hero", emoji: "⚔️", area: "dungeon" },
  { slug: "goblin-2461c8", name: "Goblin", emoji: "🗝️", area: "dungeon" },
  { slug: "hooded-cultist-8a488f", name: "Hooded Cultist", emoji: "🗝️", area: "dungeon" },
  { slug: "orc-brute-08c6ca", name: "Orc Brute", emoji: "🗝️", area: "dungeon" },
  { slug: "shambling-ghoul-256f2f", name: "Shambling Ghoul", emoji: "🗝️", area: "dungeon" },
  { slug: "crane-banksman-3994e0", name: "Crane Banksman", emoji: "🏗️", area: "construction" },
  { slug: "groundworker-083f5c", name: "Groundworker", emoji: "⛑️", area: "construction" },
  { slug: "site-manager-d60b95", name: "Site Manager", emoji: "📋", area: "construction" },
  { slug: "steel-erector-124bef", name: "Steel Erector", emoji: "🏗️", area: "construction" },
  { slug: "surveyor-82e5c7", name: "Surveyor", emoji: "🏗️", area: "construction" },
  { slug: "backpacker-f56207", name: "Backpacker", emoji: "🏕️", area: "campground" },
  { slug: "campfire-parent-b1c0d5", name: "Campfire Parent", emoji: "🏕️", area: "campground" },
  { slug: "kid-with-a-flashlight-1a9e4c", name: "Kid with a Flashlight", emoji: "🏕️", area: "campground" },
  { slug: "lake-angler-1c4740", name: "Lake Angler", emoji: "🏕️", area: "campground" },
  { slug: "park-ranger-c1697e", name: "Park Ranger", emoji: "🏹", area: "campground" },
  { slug: "village-child-bef09e", name: "Village child", emoji: "🛩️", area: "sky" },
  { slug: "village-engineer-a44949", name: "Village engineer", emoji: "🔧", area: "sky" },
  { slug: "village-gardener-9f7af6", name: "Village gardener", emoji: "🛩️", area: "sky" },
  { slug: "village-mechanic-508a0a", name: "Village mechanic", emoji: "🔧", area: "sky" },
  { slug: "bench-researcher-d0f1b9", name: "Bench Researcher", emoji: "🔬", area: "lab" },
  { slug: "clean-room-technician-da290a", name: "Clean-Room Technician", emoji: "🧪", area: "lab" },
  { slug: "graduate-student-945ef0", name: "Graduate Student", emoji: "🎒", area: "lab" },
  { slug: "senior-scientist-631736", name: "Senior Scientist", emoji: "🧪", area: "lab" },
  { slug: "cove-trader-0f94a6", name: "Cove Trader", emoji: "🏴‍☠️", area: "pirate" },
  { slug: "naval-officer-93027f", name: "Naval Officer", emoji: "👮", area: "pirate" },
  { slug: "pirate-captain-91f545", name: "Pirate Captain", emoji: "🏴‍☠️", area: "pirate" },
  { slug: "pirate-deckhand-98a6e7", name: "Pirate Deckhand", emoji: "🏴‍☠️", area: "pirate" },
  { slug: "villager-40255c", name: "Male Villager", emoji: "🧑‍🌾", area: "medieval-village" },
  { slug: "merchant-6f606b", name: "Merchant", emoji: "🏰", area: "medieval-village" },
  { slug: "tradesman-1707b9", name: "Tradesman", emoji: "🏰", area: "medieval-village" },
  { slug: "village-guard-5f0f6f", name: "Village Guard", emoji: "💂", area: "medieval-village" },
  { slug: "game-master-2b8912", name: "Game Master", emoji: "🧙", area: "runes" },
  { slug: "player-in-a-cardigan-b558c9", name: "Player in a Cardigan", emoji: "⚽", area: "runes" },
  { slug: "player-in-flannel-d0bae4", name: "Player in Flannel", emoji: "⚽", area: "runes" },
  { slug: "teen-player-37865e", name: "Teen Player", emoji: "⚽", area: "runes" },
  { slug: "dragon-keeper-c3980f", name: "Dragon Keeper", emoji: "🐉", area: "dragon" },
  { slug: "dragon-rider-apprentice-dee2cd", name: "Dragon Rider Apprentice", emoji: "🐉", area: "dragon" },
  { slug: "dragon-slayer-91ab39", name: "Dragon Slayer", emoji: "🐉", area: "dragon" },
  { slug: "egg-poacher-428c56", name: "Egg Poacher", emoji: "🐉", area: "dragon" },
  { slug: "fisherman-in-waders-6dc25e", name: "Fisherman in Waders", emoji: "🎣", area: "coast" },
  { slug: "holidaymaker-in-a-sun-2ba5e5", name: "Holidaymaker in a Sun Hat", emoji: "🏖️", area: "coast" },
  { slug: "lifeguard-321302", name: "Lifeguard", emoji: "💂", area: "coast" },
  { slug: "swimmer-in-a-wetsuit-9fca8f", name: "Swimmer in a Wetsuit", emoji: "🏊", area: "coast" },
  { slug: "lift-operator-899cf8", name: "Lift Operator", emoji: "🏔️", area: "alpine" },
  { slug: "mountaineer-13df29", name: "Mountaineer", emoji: "🏔️", area: "alpine" },
  { slug: "piste-patroller-cef4c2", name: "Piste Patroller", emoji: "🛼", area: "alpine" },
  { slug: "skier-e7ad44", name: "Skier", emoji: "🏔️", area: "alpine" },
  { slug: "seated-office-worker-854671", name: "Seated Office Worker", emoji: "⛑️", area: "office" },
  { slug: "standing-worker-on-a-8a0f9a", name: "Standing Worker On A Call", emoji: "⛑️", area: "office" },
  { slug: "visitor-with-badge-1005a3", name: "Visitor With Badge", emoji: "💼", area: "office" },
  { slug: "barista-505240", name: "Barista", emoji: "☕", area: "cafe" },
  { slug: "cafe-customer-ca7e8e", name: "Cafe Customer", emoji: "☕", area: "cafe" },
  { slug: "waiter-73dab1", name: "Waiter", emoji: "🍽️", area: "cafe" },
  { slug: "salaryman-commuter-4170c1", name: "Salaryman Commuter", emoji: "🏮", area: "tokyo" },
  { slug: "school-student-385134", name: "School Student", emoji: "🎒", area: "tokyo" },
  { slug: "shopkeeper-be5547", name: "Shopkeeper", emoji: "🏮", area: "tokyo" },
  { slug: "hanga-roa-fisherman-e56812", name: "Hanga Roa Fisherman", emoji: "🎣", area: "easter" },
  { slug: "hiker-visitor-d10aa5", name: "Hiker Visitor", emoji: "🥾", area: "easter" },
  { slug: "tapati-dancer-5557aa", name: "Tapati Dancer", emoji: "💃", area: "easter" },
  { slug: "city-commuter-52a53f", name: "City Commuter", emoji: "🚄", area: "arcology" },
  { slug: "civic-security-officer-30b6fb", name: "Civic Security Officer", emoji: "💂", area: "arcology" },
  { slug: "maintenance-technician-4bcfb8", name: "Maintenance Technician", emoji: "🚄", area: "arcology" },
  { slug: "neighborhood-child-8cc5ac", name: "Neighborhood Child", emoji: "🏘️", area: "neighborhood" },
  { slug: "suburban-resident-a9db9c", name: "Suburban Resident", emoji: "🏘️", area: "neighborhood" },
  { slug: "forest-ranger-6906b0", name: "Forest Ranger", emoji: "🏹", area: "forest" },
  { slug: "hiker-3d1a41", name: "Hiker", emoji: "🥾", area: "forest" },
  { slug: "aquarium-service-technician-b1fc4f", name: "Aquarium Service Technician", emoji: "🐠", area: "reefscape" },
  { slug: "farmer-304a43", name: "Farmer", emoji: "🧑‍🌾", area: "farm" },
  { slug: "scuba-diver-bdd1c8", name: "Scuba Diver", emoji: "🤿", area: "coral" },
  { slug: "aircrew-pilot-e6b732", name: "Aircrew Pilot", emoji: "✈️", area: "drifters" },
  { slug: "field-medic-fd8919", name: "Field Medic", emoji: "🩺", area: "drifters" },
  { slug: "infantry-rifleman-c1c0a5", name: "Infantry Rifleman", emoji: "📣", area: "drifters" },
  { slug: "pupil-seated-597f54", name: "Pupil Girl", emoji: "🎒", area: "drifters" },
  { slug: "pupil-standing-0bd6d5", name: "Pupil Standing", emoji: "🎒", area: "drifters" },
  { slug: "school-caretaker-b49fae", name: "School Caretaker", emoji: "🔑", area: "drifters" },
  { slug: "school-teacher-8b8bfc", name: "School Teacher", emoji: "🍎", area: "drifters" },
  { slug: "squad-officer-e5c52b", name: "Squad Officer", emoji: "👮", area: "drifters" },
];
/** Full catalog with resolved CDN URLs. */
const GLB_CATALOG: readonly GlbCharacterDef[] = CATALOG_CHARS_RAW.map((c) => ({
  ...c, url: cdn(c.slug),
}));

export interface GlbAreaDef {
  id: string;
  name: string;
  emoji: string;
  /** every citizen of this area (deduped against the town cast) */
  chars: readonly GlbCharacterDef[];
}

/** The special first dropdown entry — the preloaded crew the town wears. */
export const TOWN_AREA_ID = "town";

/** Dropdown areas in order: Town Cast, then every Polyfork kit area. */
export const GLB_AREAS: readonly GlbAreaDef[] = [
  { id: TOWN_AREA_ID, name: "Town Cast", emoji: "🌙", chars: [...GLB_CHARACTERS, POLICE_CHAR_DEF] },
  ...CATALOG_AREAS.map((a) => ({ ...a, chars: GLB_CATALOG.filter((c) => c.area === a.id) })),
];

/** Every selectable citizen (catalog first, then any cast-only extras). */
const ALL_CHARS: readonly GlbCharacterDef[] = (() => {
  const seen = new Set<string>();
  const out: GlbCharacterDef[] = [];
  for (const c of [...GLB_CATALOG, ...GLB_AREAS[0].chars]) {
    if (seen.has(c.slug)) continue;
    seen.add(c.slug);
    out.push(c);
  }
  return out;
})();

export const glbCharDef = (slug: string): GlbCharacterDef | undefined =>
  ALL_CHARS.find((c) => c.slug === slug);

/** Area id a slug belongs to (undefined = not in the catalog). */
export const glbAreaFor = (slug: string): string | undefined => glbCharDef(slug)?.area;

/** Total selectable rigged citizens (for UI copy). */
export const GLB_CHAR_COUNT = ALL_CHARS.length;

/** Every selectable citizen as a flat list (Random button pool etc.). */
export const ALL_GLB_CHARS: readonly GlbCharacterDef[] = ALL_CHARS;

/* ---------------- template loading (one shared rig per character) ---------------- */

/** The cartoon cast stands ~2.24 u tall (head top) — GLBs are scaled to match. */
const CHAR_TARGET_H = 2.24;

export interface GlbTemplate {
  slug: string;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** scale that brings this model to the cast height */
  unitScale: number;
  /** hip height in final (scaled) units — pivot for flips & leans */
  hip: number;
  /** named attachment socket for held tools */
  handBone: THREE.Object3D | null;
  /** bind-pose parent-chain orientation per bone (model space) — the authoring
   *  basis that turns model-axis rotations into per-bone local offsets */
  chain: Record<string, THREE.Quaternion>;
}

export interface GlbInstance {
  slug: string;
  body: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  cur: string;
  baseScale: number;
  hip: number;
  handBone: THREE.Object3D | null;
  /** live bone map for overlay posing */
  bones: Partial<Record<GlbBoneName, THREE.Object3D>>;
  /** bind-pose chain quats (shared with the template — read-only) */
  chain: Record<string, THREE.Quaternion>;
  /** Idle-struck neutral LOCAL quats — overlay targets compose onto this FIXED
   *  reference (composing onto the live bone would compound every frame) */
  neutral: Record<string, THREE.Quaternion>;
  /** Hips rest position (model units, Idle pose) — sit/crouch offsets ride it */
  hipsRest: THREE.Vector3;
  /** eased overlay envelope amounts (name → 0..1) */
  ovAmt: Record<string, number>;
}

const loader = new GLTFLoader();
const templates = new Map<string, GlbTemplate>();
const pending = new Map<string, Promise<GlbTemplate>>();
const failed = new Set<string>();

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

/** React hook — re-renders whenever a new cast character finished loading. */
export function useGlbCharacters(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
  );
}

/** Synchronous template lookup — null while the file streams in. */
export const glbTemplate = (slug: string): GlbTemplate | undefined => templates.get(slug);

function measure(scene: THREE.Object3D): { h: number } {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  return { h: Math.max(0.01, box.max.y - box.min.y) };
}

/** Accumulate the bind-pose LOCAL quats from the scene root down to `o`'s
 *  parent — the bone's parent-chain orientation in model space. Computed once
 *  at registration (the scene is still pristine bind pose then); overlay
 *  authoring converts model-axis rotations into local offsets with it. */
function parentChainQuat(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  const stack: THREE.Object3D[] = [];
  for (let p = o.parent; p; p = p.parent) stack.push(p);
  out.identity();
  for (let i = stack.length - 1; i >= 0; i--) out.multiply(stack[i].quaternion);
  return out;
}

/** Validate + cache a parsed GLB as a cast template (throws if unusable).
 *  A file without its Idle/Walk/Run trio is a static prop frozen in a
 *  T-pose — rejected so the cartoon body keeps that soul animated. */
function registerTemplate(
  slug: string,
  gltf: { scene: THREE.Object3D; animations?: THREE.AnimationClip[] },
): GlbTemplate {
  const scene = gltf.scene;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
  const clips = gltf.animations ?? [];
  if (!clips.some((c) => c.name === "Idle" || c.name === "Walk" || c.name === "Run")) {
    throw new Error(`glb ${slug}: no Idle/Walk/Run clips — static prop`);
  }
  const { h } = measure(scene);
  // bind-pose parent-chain quats for every standard bone (overlay basis)
  const chain: Record<string, THREE.Quaternion> = {};
  for (const name of GLB_BONES) {
    const b = scene.getObjectByName(name);
    if (b) chain[name] = parentChainQuat(b, new THREE.Quaternion());
  }
  const tpl: GlbTemplate = {
    slug,
    scene,
    clips,
    unitScale: CHAR_TARGET_H / h,
    hip: h * 0.52 * (CHAR_TARGET_H / h),
    handBone: scene.getObjectByName("attach-righthand") ?? null,
    chain,
  };
  templates.set(slug, tpl);
  pending.delete(slug);
  makeThumb(slug);
  bump();
  return tpl;
}

/** Load (and cache) a cast character. Resolves from cache when ready. */
export function loadGlbTemplate(slug: string): Promise<GlbTemplate> {
  const tpl = templates.get(slug);
  if (tpl) return Promise.resolve(tpl);
  if (failed.has(slug)) return Promise.reject(new Error(`glb ${slug} failed earlier`));
  const inflight = pending.get(slug);
  if (inflight) return inflight;
  const def = glbCharDef(slug);
  const url = def?.url ?? cdn(slug);
  const p = new Promise<GlbTemplate>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        try {
          resolve(registerTemplate(slug, gltf));
        } catch (e) {
          pending.delete(slug);
          failed.add(slug); // no retry hammering — the cartoon body stays
          bump();
          reject(e);
        }
      },
      undefined,
      (err) => {
        pending.delete(slug);
        failed.add(slug); // no retry hammering — the cartoon body stays
        bump();
        reject(err);
      },
    );
  });
  pending.set(slug, p);
  return p;
}

/** Build a poseable instance from a loaded template (null while loading/failed). */
export function makeGlbInstance(slug: string, ageScale: number): GlbInstance | null {
  const tpl = templates.get(slug);
  if (!tpl) return null;
  const scene = skeletonClone(tpl.scene);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
  const body = new THREE.Group();
  body.add(scene);
  const s = tpl.unitScale * ageScale;
  body.scale.setScalar(s);
  const mixer = new THREE.AnimationMixer(scene);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of tpl.clips) {
    if (clip.name === "Idle" || clip.name === "Walk" || clip.name === "Run") {
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(clip.name === "Idle" ? 1 : 0);
      actions[clip.name] = a;
    }
  }
  // 🦴 live bone map + a struck-neutral pose the procedural overlays compose
  // onto (Idle sampled a few frames in = the relaxed stance every emote
  // blends from — captured ONCE per instance, then the mixer runs free)
  const bones: Partial<Record<GlbBoneName, THREE.Object3D>> = {};
  for (const name of GLB_BONES) {
    const b = scene.getObjectByName(name);
    if (b) bones[name] = b;
  }
  const neutral: Record<string, THREE.Quaternion> = {};
  let hipsRest = new THREE.Vector3(0, tpl.hip / Math.max(0.0001, s), 0);
  if (actions.Idle) {
    mixer.update(1 / 30); // strike a relaxed Idle frame — the overlay reference
    for (const name of GLB_BONES) {
      const b = bones[name];
      if (b) neutral[name] = b.quaternion.clone();
    }
    const hips = bones.Hips;
    if (hips) hipsRest = hips.position.clone();
    mixer.setTime(0); // back to the top — the loop plays from a clean start
  }
  return {
    slug,
    body,
    mixer,
    actions,
    cur: actions.Idle ? "Idle" : "",
    baseScale: s,
    hip: tpl.hip * ageScale,
    handBone: scene.getObjectByName("attach-righthand") ?? null,
    bones,
    chain: tpl.chain,
    neutral,
    hipsRest,
    ovAmt: {},
  };
}

/* ---------------- locomotion & procedural overlays ---------------- */

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sstep01 = (a: number, b: number, x: number) => {
  const p = clamp((x - a) / (b - a), 0, 1);
  return p * p * (3 - 2 * p);
};

/** Continuous locomotion blend: Idle ⇄ Walk ⇄ JOG (Walk+Run mixed) ⇄ Run,
 *  all as simultaneous clip weights — no hard speed thresholds, mid-speeds
 *  jog for real. The stride timeScale follows ground speed so feet don't
 *  skate. The jog band starts ABOVE normal walk (5.2–7.2 u/s after the pace
 *  bump) — the old 4.2-onset blended 25–65% Run into every casual walk while
 *  its clamped-low timeScale crawled, making normal walking read slow. */
export function setGlbLocomotion(st: GlbInstance, speed: number): void {
  const wIn = sstep01(0.25, 0.7, speed);    // 0 = standing · 1 = moving
  const jogK = sstep01(6.0, 9.4, speed);    // 0 = walk · 1 = full run
  const iw = 1 - wIn;
  const ww = wIn * (1 - jogK);
  const rw = wIn * jogK;
  const set = (name: string, w: number) => {
    const a = st.actions[name];
    if (a) a.setEffectiveWeight(w);
  };
  set("Idle", iw); set("Walk", ww); set("Run", rw);
  // stride cadence tracks ground speed (clamped — a frantic blur reads worse
  // than a little foot-slide on the cartoon proportions). Walk plays ~35%
  // faster than the old mapping: a brisk, purposeful survivor stride.
  const walk = st.actions.Walk;
  if (walk && ww > 0.01) walk.setEffectiveTimeScale(clamp(speed / 3.6, 0.65, 1.65));
  const run = st.actions.Run;
  if (run && rw > 0.01) run.setEffectiveTimeScale(clamp(speed / 9.0, 0.8, 1.5));
  st.cur = rw > ww ? "Run" : ww > 0.01 ? "Walk" : "Idle";
}

const _ovE = new THREE.Euler();
const _ovR = new THREE.Quaternion();

/** Target local quat for a bone from a MODEL-AXIS euler offset: the model-space
 *  rotation R (applied in the bone's bind parent-chain frame) becomes
 *  local' = chain⁻¹ · R · chain · local. All cast members share the chain
 *  basis, so one pose table steers every character identically. */
export function glbBoneTarget(
  st: GlbInstance, bone: string,
  rx: number, ry: number, rz: number,
  out: THREE.Quaternion,
): boolean {
  const chain = st.chain[bone];
  if (!chain) return false;
  _ovE.set(rx, ry, rz, "XYZ");
  _ovR.setFromEuler(_ovE);
  out.copy(chain).invert().multiply(_ovR).multiply(chain);
  return true;
}

/** Slerp a bone toward a composed overlay target by `amt` (0..1). The target
 *  is ABSOLUTE — chain⁻¹·R·chain composed onto the FIXED Idle-neutral quat —
 *  so repeated application converges to the pose instead of compounding.
 *  No-op when the bone or its neutral reference is missing. */
const _ovT = new THREE.Quaternion();
export function glbApplyBone(
  st: GlbInstance, bone: string,
  rx: number, ry: number, rz: number,
  amt: number,
): void {
  if (amt <= 0.001) return;
  const b = st.bones[bone as GlbBoneName];
  const nq = st.neutral[bone];
  if (!b || !nq) return;
  if (!glbBoneTarget(st, bone, rx, ry, rz, _ovT)) return;
  _ovT.multiply(nq); // the fixed neutral stance — stable frame-over-frame
  b.quaternion.slerp(_ovT, Math.min(1, amt));
}

/** Ease Hips toward a crouch/sit height: rest×k in model units. */
export function glbHipsTo(st: GlbInstance, k: number, amt: number): void {
  const hips = st.bones.Hips;
  if (!hips || amt <= 0.001) return;
  const target = st.hipsRest.y * k;
  hips.position.y += (target - hips.position.y) * Math.min(1, amt);
}

/** Per-frame eased envelope for a named overlay (fast attack, soft release). */
export function glbOvEase(st: GlbInstance, name: string, want: number, dt: number): number {
  const cur = st.ovAmt[name] ?? 0;
  const rate = want > cur ? 9 : 7.5; // snap on · ease off
  const next = cur + (want - cur) * Math.min(1, dt * rate);
  st.ovAmt[name] = next;
  return next;
}

/** Crossfade the live clip — cheap (two weight eases) and always smooth.
 *  (The in-game pose path uses setGlbLocomotion; this stays for one-off users.) */
export function crossToGlb(st: GlbInstance, name: string): void {
  if (st.cur === name) return;
  const next = st.actions[name];
  if (!next) return;
  next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
  for (const other of Object.keys(st.actions)) {
    if (other !== name) st.actions[other]?.setEffectiveWeight(0);
  }
  st.cur = name;
}

/* ---------------- 🧟 the TURNED — rotting GLB zombies ---------------- */

const _zRot = new THREE.Color();
const _zTmp = new THREE.Color();
/** three sickly graveyard tints — the same family the cartoon zombies wear */
const ZOMBIE_TINTS = ["#8fbf6f", "#a8c98a", "#7da860"];

/** Rot a GLB instance in place — a sickly green graveyard wash over every
 *  material, plus a faint undead emissive so the TURNED read in the dark.
 *  Clones materials first: SkeletonUtils instances SHARE the template's
 *  materials, so tinting in place would rot every twin of this cast member.
 *  `seed` picks one of the three rot tints (pass the zombie's owner id). */
export function tintGlbZombie(st: GlbInstance, seed = 0): void {
  const rot = _zRot.set(ZOMBIE_TINTS[Math.abs(Math.floor(seed)) % ZOMBIE_TINTS.length]);
  st.body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    m.material = mats.map((src) => {
      const c = (src as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
      _zTmp.copy(c.color).lerp(rot, 0.62);
      c.color.copy(_zTmp);
      if (c.emissive) c.emissive.set(rot).multiplyScalar(0.07);
      return c;
    });
  });
}

/* ---------------- creator thumbnails (real portraits of the cast) ---------------- */

const thumbs = new Map<string, string>();
const thumbPending = new Set<string>();
let thumbVersion = 0;
const thumbListeners = new Set<() => void>();
const bumpThumbs = () => { thumbVersion++; thumbListeners.forEach((l) => l()); };

/** React hook — re-renders the hero picker as finished portraits arrive. */
export function useGlbThumbs(): number {
  return useSyncExternalStore(
    (cb) => { thumbListeners.add(cb); return () => { thumbListeners.delete(cb); }; },
    () => thumbVersion,
  );
}

/** Cached data-URL portrait of a cast character (undefined while rendering). */
export const glbThumb = (slug: string): string | undefined => thumbs.get(slug);

let thumbRenderer: THREE.WebGLRenderer | null = null;

/** One-off offscreen portrait: clone the template, strike an Idle pose,
 *  frame the whole body, capture the pixels. Tiny (128²), runs once. */
function renderThumb(tpl: GlbTemplate): string {
  const SIZE = 128;
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // the canvas is read right after the render
    });
    thumbRenderer.setSize(SIZE, SIZE);
    thumbRenderer.setPixelRatio(1);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const key = new THREE.DirectionalLight(0xfff2d0, 1.5);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8d8ff, 0.55);
  rim.position.set(-4, 3, -3);
  scene.add(rim);

  const inst = skeletonClone(tpl.scene);
  scene.add(inst);
  if (tpl.clips.some((c) => c.name === "Idle")) {
    const mixer = new THREE.AnimationMixer(inst);
    mixer.clipAction(tpl.clips.find((c) => c.name === "Idle")!).play();
    mixer.update(0.42); // a relaxed, natural stance
  }
  inst.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inst);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const mid = (box.max.y + box.min.y) / 2;
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  cam.position.set(h * 0.18, mid + h * 0.14, h * 1.5);
  cam.lookAt(0, mid, 0);
  thumbRenderer.render(scene, cam);
  const url = thumbRenderer.domElement.toDataURL("image/png");
  scene.remove(inst); // geometry & materials are shared with the template — never dispose
  return url;
}

/** Queue a portrait for a loaded template (cosmetic — failures are fine). */
function makeThumb(slug: string): void {
  if (thumbs.has(slug) || thumbPending.has(slug)) return;
  const tpl = templates.get(slug);
  if (!tpl) return;
  thumbPending.add(slug);
  setTimeout(() => {
    try {
      thumbs.set(slug, renderThumb(tpl));
      bumpThumbs();
    } catch { /* portraits are decoration — the emoji keeps standing in */ }
    thumbPending.delete(slug);
  }, 0);
}

/* ---------------- background & on-demand area loading ---------------- */

/** Download one GLB (cache-friendly). Rejects on any HTTP error. */
function fetchGlb(url: string): Promise<ArrayBuffer> {
  return fetch(url, { mode: "cors", cache: "force-cache" }).then((r) => {
    if (!r.ok) throw new Error(`glb ${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
}

/** Stream a batch of cast citizens: downloads run in parallel, the
 *  main-thread GLB parses run one-by-one so frames stay smooth while the
 *  files arrive. Failures land in `failed` (their cards grey out). */
async function loadBatch(chars: readonly GlbCharacterDef[]): Promise<void> {
  const todo = chars.filter((c) => !templates.has(c.slug) && !failed.has(c.slug));
  if (!todo.length) return;
  let bufs: ArrayBuffer[];
  try {
    bufs = await Promise.all(todo.map((c) => fetchGlb(c.url)));
  } catch {
    // any failed download — fall back to per-character loads (they cache
    // their own failures and leave the emoji standing in)
    await Promise.all(todo.map((c) => loadGlbTemplate(c.slug).catch(() => {})));
    return;
  }
  for (let i = 0; i < todo.length; i++) {
    try {
      const slug = todo[i].slug;
      if (templates.has(slug)) continue;
      loader.parse(bufs[i], "", (gltf) => {
        try {
          registerTemplate(slug, gltf); // throws on clipless props
        } catch {
          failed.add(slug);
          pending.delete(slug);
          bump();
        }
      });
      // give the main thread a breather between parses
      await new Promise((r) => setTimeout(r, 0));
    } catch {
      failed.add(todo[i].slug);
      pending.delete(todo[i].slug);
      bump();
    }
  }
}

/* --- area status (creator dropdown streams one area at a time) --- */

export type GlbAreaStatus = "idle" | "loading" | "ready";

const areaStatusMap = new Map<string, GlbAreaStatus>();
let areaVersion = 0;
const areaListeners = new Set<() => void>();
const bumpAreas = () => { areaVersion++; areaListeners.forEach((l) => l()); };

/** React hook — re-renders when an area finishes (or starts) streaming. */
export function useGlbAreaState(): number {
  return useSyncExternalStore(
    (cb) => { areaListeners.add(cb); return () => { areaListeners.delete(cb); }; },
    () => areaVersion,
  );
}

/** Streaming state of an area (town reports ready once preloaded). */
export function glbAreaStatus(areaId: string): GlbAreaStatus {
  return areaStatusMap.get(areaId) ?? "idle";
}

/** True when this citizen's GLB failed to download/parse (card greys out). */
export const glbCharFailed = (slug: string): boolean => failed.has(slug);

/** Make sure an area's characters are streamed in (idempotent, parallel
 *  downloads, gentle parses). The Town Cast rides the normal preload. */
export function ensureGlbArea(areaId: string): void {
  const area = GLB_AREAS.find((a) => a.id === areaId);
  if (!area) return;
  if (areaStatusMap.get(areaId) === "loading" || areaStatusMap.get(areaId) === "ready") return;
  areaStatusMap.set(areaId, "loading");
  bumpAreas();
  void loadBatch(area.chars).finally(() => {
    areaStatusMap.set(areaId, "ready");
    bumpAreas();
  });
}

let preloadStarted = false;
/** Streams the town cast in: bots, the living city & police all wear these.
 *  Catalog areas beyond it load on demand from the creator dropdown. */
export function preloadGlbCharacters(): void {
  if (preloadStarted) return;
  preloadStarted = true;
  ensureGlbArea(TOWN_AREA_ID);
}
