"use client";

/**
 * PageKit — shared building blocks for the full lobby pages (Battle Pass,
 * Challenges, Career, News). Same design language as ShopPage: photoreal
 * horror-night backdrop, ember/yellow accents, skewed chips, framer-motion.
 *
 * Also hosts the 📢 GAME AD NETWORK — an in-game advertisement carousel that
 * promotes the game's own content (garage drop, shop cast, mythic vault,
 * license, premium pass) with an honest "AD" tag, PUBG-style.
 */

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame, type Screen } from "./store";
import { sfx } from "@/lib/game/audio";

/* ---------------- shared primitives ---------------- */

/** Fortnite-style ember section bar — identical to Landing's Strip */
export function Strip({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-orange-800 via-orange-600 to-orange-800 px-3 py-1 ring-1 ring-inset ring-white/25 shadow-[0_0_12px_rgba(234,88,12,0.25)]">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white drop-shadow-sm">{children}</span>
      {right}
    </div>
  );
}

/** dark translucent panel — identical to Landing's Panel */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md ${className}`}>
      {children}
    </div>
  );
}

/** animated XP bar — identical to Landing's XpBar */
export function XpBar({ pct, bar = "from-amber-400 to-yellow-300", h = "h-2" }: { pct: number; bar?: string; h?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-black/55 ring-1 ring-white/15 ${h}`}>
      <motion.div
        className={`h-full rounded-full bg-gradient-to-r ${bar}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

/** the square skewed cash chip — identical to the lobby / shop header chip */
export function CashChip({ coins }: { coins: number }) {
  return (
    <div
      title="Collected cash — banked from roaming the town. Spend it in the Item Shop!"
      className="flex items-center gap-1.5 rounded-[3px] border border-yellow-300/40 bg-yellow-400/15 px-2.5 py-1.5 backdrop-blur"
    >
      <span aria-hidden className="text-[13px] leading-none">💰</span>
      <span className="text-xs font-black tabular-nums text-yellow-300">${coins.toLocaleString()}</span>
      <span className="hidden text-[9px] font-bold uppercase text-yellow-200/70 sm:inline">CASH</span>
    </div>
  );
}

/** the square XP chip */
export function XpChip({ xp }: { xp: number }) {
  return (
    <div
      title="Career XP — every banked point counts forever"
      className="flex items-center gap-1.5 rounded-[3px] border border-sky-300/30 bg-sky-400/10 px-2.5 py-1.5 backdrop-blur"
    >
      <span aria-hidden className="text-[13px] leading-none">⭐</span>
      <span className="text-xs font-black tabular-nums text-sky-200">{xp.toLocaleString()}</span>
      <span className="hidden text-[9px] font-bold uppercase text-sky-200/70 sm:inline">XP</span>
    </div>
  );
}

/* ---------------- persistent page nav (PUBG-style top rail) ---------------- */

const PAGE_NAV: readonly { id: Screen; label: string; emoji: string }[] = [
  { id: "landing", label: "Lobby", emoji: "🏠" },
  { id: "battlepass", label: "Battle Pass", emoji: "🎫" },
  { id: "challenges", label: "Challenges", emoji: "🎯" },
  { id: "shop", label: "Item Shop", emoji: "🛒" },
  { id: "career", label: "Career", emoji: "📊" },
  { id: "news", label: "News", emoji: "📰" },
];

/** skewed nav chips — the current page glows yellow; clicking hops pages */
function PageNav({ current }: { current: Screen }) {
  const setScreen = useGame((s) => s.setScreen);
  return (
    <nav aria-label="Lobby pages" className="flex flex-wrap items-center gap-1.5">
      {PAGE_NAV.map((n) => {
        const active = n.id === current;
        return (
          <button
            key={n.id}
            onClick={() => { if (!active) { sfx.click(); setScreen(n.id); } }}
            aria-current={active ? "page" : undefined}
            className={`-skew-x-[10deg] rounded-[3px] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${
              active
                ? "bg-yellow-400 text-slate-950 shadow-[0_0_16px_rgba(253,224,71,0.4)] ring-1 ring-yellow-300"
                : "bg-slate-950/85 text-white/70 ring-1 ring-white/15 hover:bg-slate-800/90 hover:text-white"
            }`}
          >
            <span className="inline-block skew-x-[10deg]"><span aria-hidden className="mr-1">{n.emoji}</span>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ---------------- page shell ---------------- */

export interface PageShellProps {
  title: string;
  emoji?: string;
  subtitle?: string;
  /** the current page id — highlights the persistent page-nav rail */
  screen: Screen;
  children: ReactNode;
}

/** full-page shell: fixed horror backdrop + header (back · title · wallet chips)
 *  + PUBG-style persistent page nav + max-w-7xl column. Matches ShopPage's skeleton. */
export function PageShell({ title, emoji, subtitle, screen, children }: PageShellProps) {
  const setScreen = useGame((s) => s.setScreen);
  const coins = useGame((s) => s.coins);
  const careerXp = useGame((s) => s.careerXp);

  return (
    <div className="relative h-screen w-full overflow-y-auto overflow-x-hidden">
      {/* backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-lobby-night.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/65 to-slate-950/90" />
      <div aria-hidden className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(2,6,23,0.48)_100%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 pb-28 lg:pb-8">
        {/* ---------- header: back · title · wallet ---------- */}
        <header className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { sfx.click(); setScreen("landing"); }}
            className="rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur hover:bg-black/50"
          >
            <ArrowLeft size={15} className="mr-1" /> Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)] sm:text-3xl">
              {title} {emoji && <span aria-hidden>{emoji}</span>}
            </h1>
            {subtitle && (
              <p className="hidden text-xs font-bold text-orange-300 sm:block">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <XpChip xp={careerXp} />
            <CashChip coins={coins} />
          </div>
        </header>

        {/* ---------- persistent page nav — hop between pages without going back ---------- */}
        <PageNav current={screen} />

        <main className="flex flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}

/* ---------------- 📢 the game ad network ---------------- */

export interface GameAd {
  id: string;
  sponsor: string;      // "SPONSORED · 7NIGHTS GARAGE"
  title: string;
  sub: string;
  emoji: string;
  grad: string;         // tailwind gradient wash
  glow: string;         // css color halo
  cta: string;          // button label
  /** where the CTA takes you */
  go: "shop" | "pass" | "challenges" | "career" | "news" | "play";
  fresh?: boolean;      // NEW! ping dot
}

const ADS: readonly GameAd[] = [
  {
    id: "ad-garage",
    sponsor: "AD · 7NIGHTS GARAGE",
    title: "10 NEW VEHICLES — 1 COIN PER TRIANGLE",
    sub: "Limo · GT3 · Touring bike · Tractors · Pickups — every ride spawns parked beside you, every run.",
    emoji: "🏍️",
    grad: "from-cyan-600/95 via-sky-600/85 to-indigo-600/80",
    glow: "rgba(56,189,248,0.5)",
    cta: "visit garage",
    go: "shop",
    fresh: true,
  },
  {
    id: "ad-pass",
    sponsor: "AD · SEASON PASS",
    title: "BP PREMIUM — 50 GOLD TIERS AWAIT",
    sub: "Double milestone jackpots, gold flair skins and the Legend Crown — one key unlocks the gold track.",
    emoji: "🎫",
    grad: "from-fuchsia-600/95 via-purple-600/85 to-rose-600/80",
    glow: "rgba(232,121,249,0.5)",
    cta: "get premium",
    go: "pass",
  },
  {
    id: "ad-cast",
    sponsor: "AD · SHOP CAST",
    title: "18 RIGGED HEROES — SANTA TO ZEUS",
    sub: "Every character priced at its exact triangle count. Wear the town's finest faces tonight.",
    emoji: "🎭",
    grad: "from-orange-600/95 via-rose-600/85 to-fuchsia-600/80",
    glow: "rgba(251,113,133,0.5)",
    cta: "meet the cast",
    go: "shop",
  },
  {
    id: "ad-license",
    sponsor: "AD · QUALITY OF LIFE",
    title: "VIP DRIVING LICENSE — $300",
    sub: "Skip the 🪪 card hunt forever. Start every run licensed to drive any parked car in town.",
    emoji: "🪪",
    grad: "from-emerald-600/95 via-teal-600/85 to-lime-500/75",
    glow: "rgba(52,211,153,0.5)",
    cta: "get licensed",
    go: "shop",
  },
  {
    id: "ad-vault",
    sponsor: "AD · MYTHIC VAULT",
    title: "28 RPG HEROES — ONE KEY",
    sub: "Dragonborn, Elves, Dwarves, Orcs & more — the whole vault with a single purchase.",
    emoji: "🐉",
    grad: "from-violet-600/95 via-purple-600/85 to-fuchsia-600/75",
    glow: "rgba(167,139,250,0.55)",
    cta: "open vault",
    go: "shop",
  },
];

/** rotating in-game advertisement — honest "AD" tag, shimmer sweep, CTA wiring */
export function AdCarousel({ placement }: { placement?: string }) {
  const setScreen = useGame((s) => s.setScreen);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % ADS.length), 6000);
    return () => clearInterval(t);
  }, []);
  const p = ADS[idx];

  const go = () => {
    sfx.click();
    if (p.go === "shop") setScreen("shop");
    else if (p.go === "pass") setScreen("battlepass");
    else if (p.go === "challenges") setScreen("challenges");
    else if (p.go === "career") setScreen("career");
    else if (p.go === "news") setScreen("news");
    else setScreen("landing");
  };

  return (
    <section
      aria-label={`Advertisement${placement ? ` — ${placement}` : ""}`}
      className="relative overflow-hidden rounded-2xl border border-white/20 shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={p.id}
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -60 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={`relative bg-gradient-to-r ${p.grad} px-4 py-4 sm:px-6`}
        >
          {/* shimmer sweep */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            animate={{ x: ["-140%", "420%"] }}
            transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
          />
          {/* floating sparkles */}
          {["8%", "26%", "55%", "78%", "92%"].map((left, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="pointer-events-none absolute top-2 text-sm opacity-70"
              style={{ left, color: p.glow }}
              animate={{ y: [0, -9, 0], rotate: [0, 14, -8, 0], opacity: [0.4, 0.9, 0.4] }}
              transition={{ duration: 2.4 + i * 0.5, repeat: Infinity, ease: "easeInOut" }}
            >
              ✦
            </motion.span>
          ))}

          <div className="relative flex items-center gap-4">
            <motion.div
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-black/25 text-4xl ring-2 ring-white/30 sm:h-20 sm:w-20 sm:text-5xl"
              animate={{ y: [0, -6, 0], rotate: [0, 3, -3, 0] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
              style={{ boxShadow: `0 0 28px ${p.glow}` }}
            >
              {p.emoji}
            </motion.div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* the honest ad tag */}
                <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/80 ring-1 ring-white/30">
                  <span className="rounded-[2px] bg-yellow-300 px-1 text-[8px] leading-tight text-slate-950">AD</span>
                  {p.sponsor.replace(/^AD · /, "")}
                </span>
                {p.fresh && (
                  <span className="flex items-center gap-1.5 rounded-full bg-yellow-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-slate-950">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-600 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-600" />
                    </span>
                    new
                  </span>
                )}
              </div>
              <h2 className="mt-1 truncate text-lg font-black uppercase tracking-wide text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.35)] sm:text-xl">
                {p.title}
              </h2>
              <p className="mt-0.5 line-clamp-2 text-[11px] font-bold leading-snug text-white/85 sm:text-xs">{p.sub}</p>
            </div>
            <Button
              onClick={go}
              className="shrink-0 rounded-lg bg-black/45 px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wider text-white ring-1 ring-white/35 backdrop-blur hover:bg-black/65"
              aria-label={`${p.title} — ${p.cta}`}
            >
              <Sparkles size={13} className="mr-1.5" /> {p.cta}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* slide dots */}
      <div className="absolute bottom-1.5 right-3 flex gap-1.5">
        {ADS.map((pp, i) => (
          <button
            key={pp.id}
            aria-label={`Show ad ${i + 1}: ${pp.title}`}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/45 hover:bg-white/70"}`}
          />
        ))}
      </div>
    </section>
  );
}
