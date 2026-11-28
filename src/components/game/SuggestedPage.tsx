"use client";

/**
 * SuggestedPage — the full-page ✨ SUGGESTED FOR YOU hub (the Item-Shop
 * pattern). Smart picks computed from THIS survivor's real state: unfinished
 * dailies, streak health, empty locker loadout, thin wallet, rank progress,
 * unplayed season arenas and the multiplayer crew call. Every card carries a
 * reward chip and lands on the exact screen (or queue) that serves it.
 */

import { motion } from "framer-motion";
import {
  ArrowRight, Bike, Crown, Flame, Gift, Lock, Play, ShieldQuestion, Sparkles,
  Target, Trophy, Users, Wrench,
} from "lucide-react";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { SEASON_BY_ID, seasonSizeKm } from "@/lib/game/seasons";
import { ownedGear } from "@/lib/game/shop";
import { rankFor } from "@/lib/game/ranks";
import { ALL_DONE_BONUS } from "@/lib/game/daily";
import { PageShell, Panel, Strip } from "./PageKit";

interface Suggestion {
  id: string;
  emoji: string;
  icon: typeof Play;
  tone: string; // ring/border accent class
  glow: string; // rgb glow for the art tile
  title: string;
  body: string;
  reward: string;
  cta: string;
  go: "play" | "lobby" | "shop" | "battlepass" | "challenges" | "daily" | "season" | "locker" | "career";
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function SuggestedPage() {
  const quickPlay = useGame((s) => s.quickPlay);
  const setScreen = useGame((s) => s.setScreen);
  const coins = useGame((s) => s.coins);
  const owned = useGame((s) => s.owned);
  const loadout = useGame((s) => s.loadout);
  const careerXp = useGame((s) => s.careerXp);
  const daily = useGame((s) => s.daily);
  const seasonId = useGame((s) => s.seasonId);
  const history = useGame((s) => s.history);

  const { rank, next, toNext } = rankFor(careerXp);
  const doneCount = daily.tasks.filter((t) => t.done).length;
  const openTasks = daily.tasks.length - doneCount;
  const gear = ownedGear(loadout.filter((id) => owned.includes(id)));
  const gearCount = gear.tools.length + gear.powers.length + gear.snacks.length + (gear.license ? 1 : 0) + gear.vehicles.length;
  const seasonDef = SEASON_BY_ID[seasonId];
  const seasonKm = seasonSizeKm(seasonDef);
  const accent = seasonDef ? hex(seasonDef.pal.accent) : "#f97316";
  const recentRuns = history.slice(0, 5);
  const winless = recentRuns.length >= 3 && !recentRuns.some((r) => r.won);

  const go = (dest: Suggestion["go"]) => {
    sfx.pickup();
    if (dest === "play") quickPlay?.();
    else setScreen(dest === "battlepass" ? "battlepass" : dest);
  };

  /* ---------- smart picks from the real save state ---------- */
  const featuredList = (): Suggestion[] => {
    const list: Suggestion[] = [
      {
        id: "season-drop",
        emoji: "🪂",
        icon: Play,
        tone: "hover:border-yellow-300/50",
        glow: accent,
        title: `Drop into Season ${Number(seasonId.replace("s", "")) || 1} — ${seasonDef?.title ?? "the live arena"}`,
        body: `The dropship is fuelled over tonight's themed ${seasonKm}×${seasonKm} km world. Solo roams the town lobby first; friends quick-join into your lobby before the launch.`,
        reward: "season arena",
        cta: "queue up",
        go: "play",
      },
    ];
    if (openTasks > 0) {
      list.push({
        id: "daily-open",
        emoji: "🎯",
        icon: Target,
        tone: "hover:border-orange-300/50",
        glow: "#fb923c",
        title: `${openTasks} daily task${openTasks === 1 ? "" : "s"} still open`,
        body: `Bank cash, rescue bubbled friends or finish runs — each pays bonus XP, and clearing the board adds a flat +${ALL_DONE_BONUS} XP.`,
        reward: `+${ALL_DONE_BONUS} XP board bonus`,
        cta: "open the board",
        go: "daily",
      });
    }
    if (gearCount === 0) {
      list.push({
        id: "locker-empty",
        emoji: "🎒",
        icon: Wrench,
        tone: "hover:border-teal-300/50",
        glow: "#2dd4bf",
        title: "Your locker loadout is empty",
        body: "Equip tools, snacks and gems in the Locker Room — every equipped item spawns with you at the drop. Nothing equipped means no kit, just fists and faith.",
        reward: "spawn gear",
        cta: "gear up",
        go: "locker",
      });
    }
    if (coins < 150) {
      list.push({
        id: "cash-run",
        emoji: "💰",
        icon: Gift,
        tone: "hover:border-yellow-300/50",
        glow: "#facc15",
        title: "Low cash — scoop the town dry",
        body: "Cash piles spawn every night and the fallen drop their wallets. A single roaming run easily funds your first shop weapon or vehicle.",
        reward: "spend in the shop",
        cta: "roam for cash",
        go: "play",
      });
    }
    if (next && toNext > 0) {
      list.push({
        id: "rank-push",
        emoji: "⚡",
        icon: Trophy,
        tone: "hover:border-fuchsia-300/50",
        glow: "#e879f9",
        title: `${toNext.toLocaleString()} XP to ${next.emoji} ${next.name}`,
        body: "Two strong runs usually close the gap — dailies stack on top, so tonight is the cheapest climb you will get.",
        reward: "tier rewards",
        cta: "climb now",
        go: "play",
      });
    }
    if (daily.streak === 0 || daily.lastPlayedDay !== new Date().toISOString().slice(0, 10)) {
      list.push({
        id: "streak-alive",
        emoji: "🔥",
        icon: Flame,
        tone: "hover:border-orange-300/50",
        glow: "#f97316",
        title: "Light the streak furnace today",
        body: `Any finished run today keeps the 🔥 alive${daily.streak > 0 ? ` — protect your ${daily.streak}-day chain` : " — start a chain today"}. Miss a day and it cools to 1.`,
        reward: "streak + bonus XP",
        cta: "protect the streak",
        go: "play",
      });
    }
    if (winless) {
      list.push({
        id: "first-win",
        emoji: "🏆",
        icon: Crown,
        tone: "hover:border-yellow-300/50",
        glow: "#fde047",
        title: "Your first win is the big one",
        body: "Recent runs show grit but no crown yet — wall up before dusk, feed at night and hold the safe zone: 7 nights is discipline, not luck.",
        reward: "+120 XP win task",
        cta: "take the crown",
        go: "play",
      });
    }
    list.push({
      id: "crew-up",
      emoji: "👥",
      icon: Users,
      tone: "hover:border-teal-300/50",
      glow: "#2dd4bf",
      title: "Bring a crew — squads survive longer",
      body: "Host a night and share the 4-letter code, or quick-join a live room. Rescues and shared loot make squads the fastest way up the ladder.",
      reward: "+50 XP crew task",
      cta: "open squads",
      go: "lobby",
    });
    list.push({
      id: "shop-visit",
      emoji: "🛒",
      icon: Bike,
      tone: "hover:border-sky-300/50",
      glow: "#38bdf8",
      title: owned.length < 3 ? "The shop cast is waiting" : "New keys for the vault",
      body: "18 rigged heroes, 10 vehicles and mythic RPG vaults — every item priced at exactly 1 coin per triangle. Gear changes spawn with you instantly.",
      reward: "instant spawn gear",
      cta: "visit the shop",
      go: "shop",
    });
    return list;
  };
  const featured = featuredList();

  const cardTone = (s: Suggestion) =>
    s.go === "play"
      ? { chip: "bg-yellow-300/15 text-yellow-200 ring-yellow-300/40" }
      : s.go === "lobby"
        ? { chip: "bg-teal-300/15 text-teal-200 ring-teal-300/40" }
        : { chip: "bg-orange-300/15 text-orange-200 ring-orange-300/40" };

  return (
    <PageShell
      title="SUGGESTED FOR YOU"
      emoji="✨"
      subtitle="Smart picks built from your locker, wallet, streak and rank — refreshed every visit."
      screen="suggested"
    >
      {/* ---------- featured: tonight's season drop ---------- */}
      <motion.button
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        onClick={() => { sfx.pickup(); quickPlay?.(); }}
        className="group relative block w-full overflow-hidden rounded-2xl border border-white/20 text-left shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
        aria-label="Drop into the live season arena now"
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `linear-gradient(115deg, rgba(2,6,23,0.95) 10%, ${accent}45 60%, rgba(2,6,23,0.92) 100%)` }}
        />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_25%,rgba(255,255,255,0.14),transparent_45%)]" />
        <div className="relative flex items-center gap-4 p-5 sm:gap-5 sm:p-6">
          <motion.span
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-black/40 text-4xl ring-2 ring-white/25 sm:h-20 sm:w-20 sm:text-5xl"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            style={{ boxShadow: `0 0 30px ${accent}66` }}
          >
            🪂
          </motion.span>
          <div className="min-w-0 flex-1">
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/25">
              featured tonight
            </span>
            <h2 className="mt-1.5 text-lg font-black uppercase leading-tight tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.4)] sm:text-2xl">
              Drop into Season {Number(seasonId.replace("s", "")) || 1} — {seasonDef?.title ?? "the live arena"}
            </h2>
            <p className="mt-1 line-clamp-2 text-[11px] font-bold text-white/75 sm:text-xs">
              {seasonDef?.tagline ?? `The themed ${seasonKm}×${seasonKm} km battle arena is live.`} The town lobby roams first; the dropship
              lifts when the countdown fires.
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-950 shadow-[0_4px_0_rgba(161,98,7,0.5)] transition-all group-hover:bg-yellow-300 sm:flex">
            <Play size={16} fill="currentColor" /> queue up
          </span>
        </div>
      </motion.button>

      {/* ---------- the picks grid ---------- */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {featured.slice(1).map((s, i) => {
          const Icon = s.icon;
          const tone = cardTone(s);
          return (
            <motion.button
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, delay: Math.min(0.24, i * 0.04) }}
              onClick={() => go(s.go)}
              className={`group flex flex-col rounded-xl border border-white/12 bg-slate-950/80 p-4 text-left shadow-lg backdrop-blur-md transition-colors ${s.tone}`}
              aria-label={`${s.cta}: ${s.title}`}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/35 text-2xl ring-1 ring-white/15"
                  style={{ boxShadow: `0 0 18px ${s.glow}44` }}
                >
                  {s.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-black uppercase leading-snug tracking-wide text-white/90">{s.title}</h3>
                </div>
                <Icon size={15} className="shrink-0 text-white/35 transition-colors group-hover:text-white/70" />
              </div>
              <p className="mt-2 flex-1 text-[11px] font-bold leading-relaxed text-white/60">{s.body}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ring-1 ${tone.chip}`}>
                  {s.reward}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-yellow-300 transition-colors group-hover:text-yellow-200">
                  {s.cta} <ArrowRight size={11} />
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* ---------- locked tease + rules ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <Strip right={<Lock size={12} className="text-white/80" />}>Coming to suggestions</Strip>
          <div className="space-y-1.5 p-3 text-[11px] font-bold leading-relaxed text-white/70">
            <p>🚗 <b className="text-white/90">Garage night</b> — a pick that points you at the arena where tonight&apos;s parked vehicle key spawns.</p>
            <p>🧟 <b className="text-white/90">Horde hunter</b> — a zombie-hunting challenge line, tracked per night, paying XP.</p>
            <p>🗺️ <b className="text-white/90">POI tour</b> — visit three named drops in one run; the season&apos;s map knowledge pays.</p>
            <p>🏅 <b className="text-white/90">Hall of fame push</b> — beats your best banked score and stamps the leaderboard.</p>
          </div>
        </Panel>
        <Panel>
          <Strip right={<ShieldQuestion size={12} className="text-white/80" />}>Why these picks</Strip>
          <div className="space-y-1.5 p-3 text-[11px] font-bold leading-relaxed text-white/70">
            <p>
              Every card reads your <b className="text-white/90">real save</b> — the daily board, streak clock, locker
              loadout, wallet, rank ladder and last five runs — and only shows what actually moves a number tonight.
            </p>
            <p>
              Suggestions are <b className="text-white/90">one tap from action</b>: queue buttons launch the match
              lobby, gear buttons open the exact screen.
            </p>
            <p>
              The <button onClick={() => { sfx.click(); setScreen("season"); }} className="text-yellow-300 underline decoration-dotted hover:text-yellow-200">Season page</button> explains
              which arena is live and why; the <button onClick={() => { sfx.click(); setScreen("daily"); }} className="text-yellow-300 underline decoration-dotted hover:text-yellow-200">Daily board</button> tracks
              the concrete targets.
            </p>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
