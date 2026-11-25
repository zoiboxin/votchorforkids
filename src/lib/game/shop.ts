/**
 * 🛒 THE ITEM SHOP — spend the money you banked in town.
 *
 * Cash piles, purses, camp stashes and zombie hoards are scooped while you
 * roam (engine 💰 pickups) and BANKED at the end of every run. The shop turns
 * that bank into a loadout: belt tools, pocketed power gems, hotbar snacks,
 * the VIP driving license and cosmetic outfits.
 *
 * Everything PURCHASED spawns with the player EVERY run — owned tools & gems
 * ride the 🎒 wheel (G / right-click), snacks fill the hotbar (1–8), the VIP
 * license skips the 🪪 card hunt. Outfits are worn from the shop or locker.
 */

import { ITEMS, OUTFIT_PRESETS, POWERS, TOOLS, VEHICLE_LABELS, type PowerKind, type ToolKind } from "./constants";

/** 🐉 the Mythic Hero Vault bundle — unlocks every kit hero */
export const RPG_VAULT_ITEM_ID = "kit-rpg-vault";

export type ShopKind = "gear" | "power" | "support" | "style" | "garage";

export interface ShopItem {
  id: string;
  name: string;
  emoji: string;
  kind: ShopKind;
  price: number; // 💰 banked cash
  tip: string;   // what it does once owned
  /* kind payloads — gear: a belt tool · power: a POWERS gem · snack: ITEMS stack · style: OUTFIT_PRESETS id */
  tool?: ToolKind;
  power?: PowerKind;
  snack?: { def: number; count: number };
  presetId?: string;
  /** 🎭 Shop Cast hero slug — owning this item unlocks WEARING that rigged GLB character */
  char?: string;
  license?: boolean;
  /** hero bundle — owning this unlocks the hero kit(s) listed in its tip */
  heroBundle?: true;
  /** 🏪 garage vehicle type (constants.ts VEHICLE_GLB 12–21) — owning this
   *  spawns that ride parked beside you at the start of EVERY run (license
   *  still gates the ignition, exactly like every other car in town). */
  veh?: number;
}

/* stable lookups into the shared catalogs */
const itemIdx = (name: string) => ITEMS.findIndex((i) => i.name === name);

/** every outfit preset becomes a purchasable style item (prices per rarity) */
const PRESET_PRICE: Record<string, number> = {
  cricket: 80, bollywood: 120, detective: 100, nana: 90, maverick: 110,
  dancer: 100, superkid: 150, popstar: 130, dada: 90,
};

export const SHOP_ITEMS: readonly ShopItem[] = [
  /* ---------- 🛠️ GEAR — belt tools, one per kind (the 🎒 wheel arms them) ---------- */
  {
    id: "tool-axe", name: "Woodcutter's Axe", emoji: "🪓", kind: "gear", price: 120, tool: "axe",
    tip: "Spawn with an 🪓 Axe every run — chop trees for barricades & campfires.",
  },
  {
    id: "tool-hammer", name: "Mason's Hammer", emoji: "🔨", kind: "gear", price: 120, tool: "hammer",
    tip: "Spawn with a 🔨 Hammer — smash boulders into building stone.",
  },
  {
    id: "tool-builder", name: "Builder Kit", emoji: "🔧", kind: "gear", price: 150, tool: "builder",
    tip: "Spawn with the 🔧 Builder — stack barricades (B) & campfires (V) from minute one.",
  },
  {
    id: "tool-sword", name: "Night Sword", emoji: "🗡️", kind: "gear", price: 250, tool: "sword",
    tip: "Spawn with the 🗡️ Sword — the hardest hitter; two swings slay a beast.",
  },

  /* ---------- ⚔️ SHOP-FORGED WEAPONS — real Polyfork GLB steel, tuned STRONG ----------
   * Damage / swing-speed / reach tuned ABOVE the world tools — the wallet's
   * worth it: 55-dmg arming sword, double-speed dagger, far-thrust spear and
   * a hand axe that fights AND fells trees. They ride the 🎒 wheel like any
   * belt tool and swing the same fight arc. */
  {
    id: "tool-armsword", name: "Knight's Arming Sword", emoji: "⚔️", kind: "gear", price: 420, tool: "armsword",
    tip: "Spawn with the ⚔️ Arming Sword — 55 dmg knight steel; the strongest blade in town.",
  },
  {
    id: "tool-spear", name: "Guard's Spear", emoji: "🔱", kind: "gear", price: 380, tool: "spear",
    tip: "Spawn with the 🔱 Spear — 48 dmg with a LONG thrust; poke beasts from safety.",
  },
  {
    id: "tool-dagger", name: "Jewelled Dagger", emoji: "🔪", kind: "gear", price: 340, tool: "dagger",
    tip: "Spawn with the 🔪 Dagger — 34 dmg at DOUBLE swing speed; the DPS king.",
  },
  {
    id: "tool-handaxe", name: "Raider's Hand Axe", emoji: "⛏️", kind: "gear", price: 300, tool: "handaxe",
    tip: "Spawn with the ⛏️ Hand Axe — 38 dmg AND it fells trees; fight & build in one hand.",
  },

  /* ---------- ✨ POWERS — pocketed gems, single use, unleashed from the 🎒 wheel ---------- */
  {
    id: "gem-sonic", name: "Sonic Gem", emoji: "⚡", kind: "power", price: 220, power: "sonic",
    tip: "Start every run with a pocketed ⚡ Sonic Dash — run speed ×1.9 (G to unleash).",
  },
  {
    id: "gem-jump", name: "Roo Gem", emoji: "🦘", kind: "power", price: 180, power: "jump",
    tip: "Start every run with a pocketed 🦘 Kangaroo Leap — jump ×1.65 (G to unleash).",
  },
  {
    id: "gem-magnet", name: "Magnet Gem", emoji: "🧲", kind: "power", price: 160, power: "magnet",
    tip: "Start every run with a pocketed 🧲 Food Magnet — snacks fly into your pockets.",
  },
  {
    id: "gem-blink", name: "Blink Gem", emoji: "🌀", kind: "power", price: 260, power: "blink",
    tip: "Start every run with a pocketed 🌀 Blink — Q teleports where you look.",
  },

  /* ---------- 🎒 SUPPORT — hotbar snacks & the VIP license ---------- */
  {
    id: "snack-medkit", name: "Field Medkits ×2", emoji: "🩹", kind: "support", price: 90,
    snack: { def: itemIdx("First-aid kit"), count: 2 },
    tip: "Start with 2 🩹 First-aid kits in the hotbar — +45 ❤ each (keys 1–8).",
  },
  {
    id: "snack-cake", name: "Sweet Pack ×3", emoji: "🍰", kind: "support", price: 70,
    snack: { def: itemIdx("Cake"), count: 3 },
    tip: "Start with 3 🍰 Cake slices — ❤ + ⚡ together in one bite.",
  },
  {
    id: "snack-drink", name: "Energy Pack ×2", emoji: "🥤", kind: "support", price: 80,
    snack: { def: itemIdx("Power drink"), count: 2 },
    tip: "Start with 2 🥤 Power drinks — the big ⚡ refill for long chases.",
  },
  {
    id: "snack-potion", name: "Mystic Potions ×2", emoji: "🧪", kind: "support", price: 130,
    snack: { def: itemIdx("Potion"), count: 2 },
    tip: "Start with 2 🧪 Mystic Potions — ❤ +60 ⚡ +45 in one glug (keys 1–8).",
  },
  {
    id: "perk-license", name: "VIP License", emoji: "🪪", kind: "support", price: 300, license: true,
    tip: "Start EVERY run already licensed — drive any parked car, no 🪪 card hunt.",
  },
  {
    id: "bp-premium", name: "BP Premium", emoji: "🎫", kind: "support", price: 999,
    tip: "Unlock the Season Pass PREMIUM track — 50 gold reward tiers, double milestone jackpots, gold flair skins.",
  },

  /* ---------- 🏪 GARAGE — the polyfork vehicle fleet, priced 1 coin per
   * triangle ----------
   * Every ride renders from its real GLB and spawns parked beside you at the
   * start of every run — walk up, press E and drive (the 🪪 license still
   * gates the ignition like every other car in town). The bike plays the
   * astride riding pose instead of the car seat. Price = the asset's exact
   * triangle count, as listed on its polyfork.dev catalog page. */
  ...([
    ["jackpot-prize-convertible-81bca8", "Jackpot Convertible", "🏆", 12, 3448],
    ["stretch-limousine-284b73", "Stretch Limousine", "🚓", 13, 2690],
    ["model-of-a-gt3-32b70d", "GT3 Race Car", "🏎️", 14, 2802],
    ["touring-motorcycle-3b1ad3", "Touring Motorcycle", "🏍️", 15, 3340],
    ["ranger-pickup-truck-97057d", "Ranger Pickup", "🛻", 16, 4580],
    ["follow-me-car-b3c6a5", "Follow-Me Car", "🛩️", 17, 3010],
    ["compact-tractor-35b84b", "Compact Tractor", "🚜", 18, 3034],
    ["three-wheeled-delivery-mini-744094", "Delivery Mini", "🛺", 19, 3266],
    ["pickup-truck-a34bf2", "Pickup Truck GT", "🛻", 20, 3383],
    ["semi-tractor-e9455c", "Semi Tractor", "🚚", 21, 3719],
  ] as const).map(
    ([slug, name, emoji, veh, tris]): ShopItem => ({
      id: `veh-${slug}`, name, emoji, kind: "garage", price: tris, veh,
      tip: `Real polyfork GLB vehicle — exactly ${tris.toLocaleString()} triangles, priced 1 💰 per triangle. It spawns parked beside you every run; buy the 🪪 license if you haven't, then press E to drive.`,
    }),
  ),

  /* ---------- 👕 STYLE — cosmetic outfits, worn from the shop or the locker ---------- */
  {
    id: RPG_VAULT_ITEM_ID, name: "Mythic Hero Vault", emoji: "🐉", kind: "style", price: 560, heroBundle: true,
    tip: "Unlock 28 rigged RPG heroes — Dragonborn, Dwarves, Elves, Orcs, Goblins & more. Wear them here or in the Locker!",
  },
  ...OUTFIT_PRESETS.map(
    (p): ShopItem => ({
      id: `style-${p.id}`, name: p.label, emoji: p.emoji, kind: "style",
      price: PRESET_PRICE[p.id] ?? 100, presetId: p.id,
      tip: "Cosmetic outfit — wear it from here or the locker once purchased.",
    }),
  ),

  /* ---------- 🎭 SHOP CAST — one-off Polyfork characters, priced 1 coin per
   * triangle ----------
   * Every entry is a rigged, animated GLB on the shared cast skeleton
   * (Idle/Walk/Run embedded) served straight from polyfork.dev — the price is
   * the asset's exact triangle count, as listed on its catalog page. Owning
   * one unlocks wearing that hero from here or the Locker's Hero tab. */
  ...([
    ["santa-base", "Santa", "🎅", 3766],
    ["elf-carrying-presents-base", "Gift Elf", "🎁", 3904],
    ["kid-witch-01c770", "Kid Witch", "🔮", 4929],
    ["kid-in-a-bedsheet-f9c403", "Bedsheet Ghost Kid", "👻", 4343],
    ["court-jester-base", "Court Jester", "🃏", 4840],
    ["choral-star-girl-base", "Choral Star Girl", "🌟", 4912],
    ["cheerleader-90875e", "Cheerleader", "📣", 4833],
    ["tapati-dancer-5557aa", "Tapati Dancer", "💃", 4905],
    ["opera-baritone-base", "Opera Baritone", "🎭", 4941],
    ["balloon-seller-base", "Balloon Seller", "🎈", 4986],
    ["child-at-the-fun-fair-base", "Fun Fair Kid", "🎡", 4946],
    ["spear-soldier-base", "Spear Soldier", "💂", 4962],
    ["general-base", "General", "🎖️", 5000],
    ["zeus-base", "Zeus", "⚡", 4880],
    ["gnome-mage-base", "Gnome Mage", "🧙", 5618],
    ["halfling-monk-base", "Halfling Monk", "🧘", 5476],
    ["dryad-hunter-base", "Dryad Hunter", "🌿", 5559],
    ["human-assassin-base", "Human Assassin", "🗡️", 5485],
  ] as const).map(
    ([slug, name, emoji, tris]): ShopItem => ({
      id: `char-${slug}`, name, emoji, kind: "style", price: tris, char: slug,
      tip: `Rigged Polyfork character — exactly ${tris.toLocaleString()} triangles, priced 1 💰 per triangle. Wear it from here or the Locker once purchased.`,
    }),
  ),
];

/** shop sections, in display order */
export const SHOP_KINDS: readonly { id: ShopKind; label: string; emoji: string }[] = [
  { id: "gear", label: "Gear", emoji: "🛠️" },
  { id: "power", label: "Powers", emoji: "✨" },
  { id: "support", label: "Support", emoji: "🎒" },
  { id: "style", label: "Style", emoji: "👕" },
  { id: "garage", label: "Garage", emoji: "🚗" },
];

export const shopItem = (id: string): ShopItem | undefined => SHOP_ITEMS.find((i) => i.id === id);

export const outfitPreset = (presetId?: string) =>
  OUTFIT_PRESETS.find((p) => p.id === presetId);

/* ---------- the engine-facing loadout derived from an owned list ---------- */

export interface OwnedGear {
  tools: ToolKind[];
  powers: PowerKind[];
  snacks: { def: number; count: number }[];
  license: boolean;
  /** 🏪 owned garage vehicles (game vehicle types 12–21) — spawned parked
   *  beside the player at the start of every run (see engine.spawnGarageCars) */
  vehicles: number[];
}

/** Build the run-loadout from the player's purchased item ids. */
export function ownedGear(owned: readonly string[]): OwnedGear {
  const gear: OwnedGear = { tools: [], powers: [], snacks: [], license: false, vehicles: [] };
  for (const id of owned) {
    const it = shopItem(id);
    if (!it) continue;
    if (it.tool) gear.tools.push(it.tool);
    else if (it.power) gear.powers.push(it.power);
    else if (it.snack) gear.snacks.push({ ...it.snack });
    else if (it.license) gear.license = true;
    else if (it.veh != null && !gear.vehicles.includes(it.veh)) gear.vehicles.push(it.veh);
  }
  return gear;
}

/** One-line HUD toast of the granted loadout ("🪓 Axe · ⚡ Sonic gem · 🩹 Medkit ×2 · 🪪 License · 🏍️ Bike"). */
export function gearSummary(gear: OwnedGear): string {
  const parts: string[] = [];
  for (const kind of gear.tools) {
    const d = TOOLS.find((t) => t.kind === kind);
    if (d) parts.push(`${d.emoji} ${d.name}`);
  }
  for (const kind of gear.powers) {
    const d = POWERS.find((p) => p.kind === kind);
    if (d) parts.push(`${d.emoji} ${d.name} gem`);
  }
  for (const s of gear.snacks) {
    const d = ITEMS[s.def];
    if (d) parts.push(`${d.emoji} ${d.name} ×${s.count}`);
  }
  if (gear.license) parts.push("🪪 License");
  for (const t of gear.vehicles) {
    const label = VEHICLE_LABELS[t % VEHICLE_LABELS.length];
    if (label) parts.push(label);
  }
  return parts.join(" · ");
}
