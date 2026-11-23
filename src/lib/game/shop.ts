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

import { ITEMS, OUTFIT_PRESETS, POWERS, TOOLS, type PowerKind, type ToolKind } from "./constants";

export type ShopKind = "gear" | "power" | "support" | "style";

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
  license?: boolean;
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
    id: "perk-license", name: "VIP License", emoji: "🪪", kind: "support", price: 300, license: true,
    tip: "Start EVERY run already licensed — drive any parked car, no 🪪 card hunt.",
  },

  /* ---------- 👕 STYLE — cosmetic outfits, worn from the shop or the locker ---------- */
  ...OUTFIT_PRESETS.map(
    (p): ShopItem => ({
      id: `style-${p.id}`, name: p.label, emoji: p.emoji, kind: "style",
      price: PRESET_PRICE[p.id] ?? 100, presetId: p.id,
      tip: "Cosmetic outfit — wear it from here or the locker once purchased.",
    }),
  ),
];

/** shop sections, in display order */
export const SHOP_KINDS: readonly { id: ShopKind; label: string; emoji: string }[] = [
  { id: "gear", label: "Gear", emoji: "🛠️" },
  { id: "power", label: "Powers", emoji: "✨" },
  { id: "support", label: "Support", emoji: "🎒" },
  { id: "style", label: "Style", emoji: "👕" },
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
}

/** Build the run-loadout from the player's purchased item ids. */
export function ownedGear(owned: readonly string[]): OwnedGear {
  const gear: OwnedGear = { tools: [], powers: [], snacks: [], license: false };
  for (const id of owned) {
    const it = shopItem(id);
    if (!it) continue;
    if (it.tool) gear.tools.push(it.tool);
    else if (it.power) gear.powers.push(it.power);
    else if (it.snack) gear.snacks.push({ ...it.snack });
    else if (it.license) gear.license = true;
  }
  return gear;
}

/** One-line HUD toast of the granted loadout ("🪓 Axe · ⚡ Sonic gem · 🩹 Medkit ×2 · 🪪 License"). */
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
  return parts.join(" · ");
}
