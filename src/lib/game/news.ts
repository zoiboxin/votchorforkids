/**
 * 7Nights — NIGHT LINE NEWS · the in-game newsroom feed.
 *
 * Structured news items (replacing the old plain NIGHT_TICKER strings):
 * real changelog entries + in-fiction "Night Line" newspaper flavor, so the
 * News page reads like an actual AAA title's newsroom — featured stories,
 * category filters, patch notes and event announcements.
 */

export type NewsTag = "event" | "patch" | "community" | "dev";

export interface NewsItem {
  id: string;
  tag: NewsTag;
  title: string;
  body: string;
  /** newest first */
  at: string;            // "NOV 25" style display date
  ts: number;            // sort key (ms) — 2025-26 season window
  emoji: string;
  featured?: boolean;
}

export const NEWS_TAG_META: Record<NewsTag, { label: string; chip: string; dot: string }> = {
  event: { label: "EVENT", chip: "bg-fuchsia-400/15 text-fuchsia-200 ring-fuchsia-300/40", dot: "bg-fuchsia-400" },
  patch: { label: "PATCH", chip: "bg-yellow-400/15 text-yellow-200 ring-yellow-300/40", dot: "bg-yellow-400" },
  community: { label: "COMMUNITY", chip: "bg-teal-400/15 text-teal-200 ring-teal-300/40", dot: "bg-teal-400" },
  dev: { label: "DEV NOTE", chip: "bg-orange-400/15 text-orange-200 ring-orange-300/40", dot: "bg-orange-400" },
};

/** newest first — ts values are the real feature-landmark order of the build */
export const NEWS_ITEMS: readonly NewsItem[] = [
  {
    id: "garage-drop",
    tag: "event",
    title: "THE GARAGE OPENS — 10 NEW VEHICLES HIT THE SHOP",
    body:
      "Jackpot Convertible, Stretch Limo, GT3 racer, Touring Motorcycle, Ranger & Pickup trucks, Follow-Me Car, Compact Tractor, Three-Wheeled Delivery Mini and the Semi Tractor roll onto the lot. Every ride is priced at its exact triangle count and spawns parked beside you, every run. Two-wheelers ride right — hop the bike and your survivor leans into the ride animation.",
    at: "NOV 25",
    ts: 9,
    emoji: "🏍️",
    featured: true,
  },
  {
    id: "possession-night",
    tag: "patch",
    title: "ZOMBIE POSSESSION — ONE OF YOU IS NOT YOU ANYMORE",
    body:
      "Every nightfall the town now picks ONE soul — bot or player — and the dark takes them. The possessed hunt the living until dawn; survivors who breathe through it continue to the next night. Police are killable. Last soul standing (or the final-night winner) takes the crown. Trust nobody whose eyes went black.",
    at: "NOV 25",
    ts: 8,
    emoji: "🧟",
    featured: true,
  },
  {
    id: "shop-redesign",
    tag: "patch",
    title: "ITEM SHOP 2.0 — PUBG-STYLE STOREFRONT",
    body:
      "The shop got the full console treatment: live 3D GLB preview stage with drag-to-spin, category dropdown, thumbnail grid, and a rotating promo banner. 18 rigged Shop Cast characters priced 1 coin per triangle joined the shelves — Santa, Zeus, Kid Witch and fifteen more.",
    at: "NOV 24",
    ts: 7,
    emoji: "🛒",
  },
  {
    id: "railway-fix",
    tag: "dev",
    title: "RAILWAY REBUILT — THE STATION RUNS AGAIN",
    body:
      "The night rail got a ground-up rebake: chunked async baking killed the world-load freeze, skinned sub-meshes merge clean, and the station returns even when parts load late. ~465 track sections now curve through the dark without a single dropped frame.",
    at: "NOV 24",
    ts: 6,
    emoji: "🚂",
  },
  {
    id: "driving-license",
    tag: "event",
    title: "VIP DRIVING LICENSE — SKIP THE CARD HUNT",
    body:
      "The 🪪 license card is now shoppable: start every run already licensed and hotwire any parked car the moment you reach it. One purchase, permanent — rides with you through the cloud save.",
    at: "NOV 23",
    ts: 5,
    emoji: "🪪",
  },
  {
    id: "lobby-chat",
    tag: "patch",
    title: "GLOBAL LOBBY CHAT IS LIVE",
    body:
      "A dedicated relay now carries the shared lobby channel — every connected soul sees every message in real time, with an unseen badge on the dock and full history catch-up. Squads, trade talk and last-night accusations welcome.",
    at: "NOV 22",
    ts: 4,
    emoji: "💬",
  },
  {
    id: "night-line",
    tag: "community",
    title: "NIGHT LINE — DISPATCHES FROM THE TOWN",
    body:
      "Dusk sirens again. Lumber report: the jungle is losing trees — someone is building SOMETHING. Dawn body count: 1. The clue says the killer wore PINK. Campfires keep the beast away; the graveyard is quiet. Too quiet.",
    at: "NOV 21",
    ts: 3,
    emoji: "📰",
  },
  {
    id: "seven-nights-101",
    tag: "dev",
    title: "SURVIVE THE SEVEN NIGHTS — A FIELD PRIMER",
    body:
      "Bank cash, rescue bubbled friends, and keep the fire lit — day builds the town, night hunts the living. Every point you bank feeds your career XP, your rank ladder and the season pass. Three daily tasks pay out; a perfect board pays +100 bonus.",
    at: "NOV 20",
    ts: 2,
    emoji: "🌙",
  },
] as const;

/** the old ticker — still feeding the marquee */
export const NEWS_TICKER: readonly string[] = [
  "🌙 NIGHT 1 of 7 — the town sleeps with one eye open.",
  "⚠️ Dusk sirens again… whose eyes went BLACK today?",
  "🪓 lumber report: the jungle is losing trees — someone is building SOMETHING.",
  "🩸 Dawn body count: 1. Clue says the killer wore PINK…",
  "🔥 Campfires keep the beast away — the town approves.",
  "🧟 graveyard quiet. TOO quiet.",
  "🔪 'It was dark. I swung. I hope it was the beast.' — local survivor",
  "🌑 3 nights left. 3 survivors. The math is not good.",
];
