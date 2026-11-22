"use client";

/**
 * Landing — the 🎮 FORTNITE / PUBG-style PC lobby dashboard.
 *
 * A dense desktop lobby, exactly the pattern from the big battle-royale games:
 *   • angled logo band + tab rail on top (Lobby · Battle Pass · Challenges ·
 *     Locker · Item Shop · Career · News) with XP / crew chips and the avatar
 *   • left rail: SEASON, SUGGESTED CHALLENGES and the DAILY CHALLENGES board
 *     collapse into icon buttons — click one to pop open just that card
 *     (one at a time, click again to close)
 *   • center: the rigged GLB survivor LIVE on the lobby floor (drag to spin,
 *     glowing center circle — no cartoon bodies) with the name plate + READY
 *     status above and the rank boost pill below
 *   • bottom: Global chat docked as a right-side icon with a count badge (opens
 *     a challenge-card-style chat panel) and the big yellow SOLO PLAYER button
 *     plus the MULTIPLAYER squads button — customization lives in the
 *     LOCKER, never blocking the way into a night
 *
 * Wiring is unchanged: SOLO PLAYER queues through the PUBG-style match lobby
 * (bots fill the 100-soul night; a name is rolled automatically the first
 * time), Locker opens the full survivor creator, Career opens the profile
 * hub. Keyboard: [H] help · [P] profile · [L] locker · [C] challenges ·
 * [B] battle pass · [N] news.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, CalendarDays, Check, ChevronRight, Crown, Flame, History as HistoryIcon, Info,
  Lock, MessageSquare, Newspaper, Pencil, Play, Send, Settings, ShoppingBag, Sparkles, Star, Trophy, User, Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAILY_TASK_POOL, ALL_DONE_BONUS } from "@/lib/game/daily";
import {
  NAME_SUGGESTIONS, NIGHT_TICKER, OUTFIT_PRESETS,
  type Appearance, type OutfitPreset,
} from "@/lib/game/constants";
import { RANKS, rankFor } from "@/lib/game/ranks";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { useGame } from "./store";
import { HowToPlay, SettingsDialog, StatsDialog, HistoryDialog } from "./Panels";
import { RankBadge } from "./RankCard";
import { LobbyStage } from "./LobbyStage";

/* ---------------- meta progression ---------------- */

/** XP needed per account LEVEL (Fortnite-style — grows forever) */
const LEVEL_STEP = 500;

/** stable quarterly season number (SEASON 1 starts Jan 2025) */
function seasonNo(d = new Date()): number {
  return 1 + (d.getFullYear() - 2025) * 4 + Math.floor(d.getMonth() / 3);
}

/** how long until the daily reset, as "5h 12m" */
function resetCountdown(): string {
  const now = new Date();
  const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = mid.getTime() - now.getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function presetEquipped(look: Appearance, p: OutfitPreset): boolean {
  return (Object.entries(p.look) as [keyof Appearance, unknown][]).every(([k, v]) => look[k] === v);
}

/* ---------------- tabs ---------------- */

type Tab = "lobby" | "battlepass" | "challenges" | "store" | "career" | "news";

const TABS: { id: Tab; label: string; key?: string }[] = [
  { id: "lobby", label: "Lobby" },
  { id: "battlepass", label: "Battle Pass", key: "B" },
  { id: "challenges", label: "Challenges", key: "C" },
  { id: "store", label: "Item Shop" },
  { id: "career", label: "Career" },
  { id: "news", label: "News", key: "N" },
];

/** the ONE lobby card popped open from the left icon rail (or none) */
type LobbyCard = "season" | "suggested" | "daily";

/* ---------------- tiny building blocks ---------------- */

/** Fortnite-style section strip — 7NIGHTS dark-orange brand bar over a dark
 *  translucent panel (ember gradient with a hot center sheen — leaves yellow to
 *  the CTA and reads against the horror backdrop) */
function Strip({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-orange-800 via-orange-600 to-orange-800 px-3 py-1 ring-1 ring-inset ring-white/25 shadow-[0_0_12px_rgba(234,88,12,0.25)]">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white drop-shadow-sm">{children}</span>
      {right}
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md ${className}`}>
      {children}
    </div>
  );
}

function XpBar({ pct, bar = "from-amber-400 to-yellow-300", h = "h-2" }: { pct: number; bar?: string; h?: string }) {
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

/* ---------------- global chat (right-side dock — icon with count badge) ---------------- */

interface ChatMsg { name: string; msg: string }

const CHAT_SEED: ChatMsg[] = [
  { name: "NightLine", msg: "📡 Welcome to the lobby — PLAY queues you into a 100-soul night (AI fills the rest)." },
  { name: "NightLine", msg: "🌐 MULTIPLAYER hosts a room — share the 4-letter code, friends Quick join." },
];

function GlobalChatDock({ name }: { name: string }) {
  const [chat, setChat] = useState<ChatMsg[]>(CHAT_SEED);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const send = () => {
    const msg = draft.trim().slice(0, 120);
    if (!msg) return;
    setChat((c) => [...c.slice(-30), { name: name || "Guest", msg }]);
    setDraft("");
    sfx.click();
  };

  return (
    <div className="relative">
      {/* dock icon with message-count badge */}
      <button
        onClick={() => { sfx.click(); setOpen((o) => !o); }}
        aria-label={`Global chat — ${chat.length} messages`}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-slate-950/85 text-white/80 shadow-lg backdrop-blur transition-colors hover:bg-slate-800/90 hover:text-white"
      >
        <MessageSquare size={18} />
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white ring-2 ring-slate-950">
          {chat.length > 99 ? "99+" : chat.length}
        </span>
      </button>

      {/* the chat panel — same card style as the challenges board, docked right */}
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute bottom-[calc(100%+10px)] right-0 z-40 w-[min(20rem,calc(100vw-2.5rem))]"
        >
          <Panel>
            <Strip
              right={
                <button
                  onClick={() => { sfx.click(); setOpen(false); }}
                  aria-label="Close global chat"
                  className="rounded p-0.5 text-white/85 transition-colors hover:bg-black/25 hover:text-white"
                >
                  <X size={13} />
                </button>
              }
            >
              Global chat
            </Strip>
            <div aria-live="polite" className="lobby-scroll max-h-52 space-y-1.5 overflow-y-auto p-2.5">
              {chat.map((m, i) => (
                <div key={`${m.name}-${i}`} className="rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold leading-snug text-white/80">
                  <span className={m.name === "NightLine" ? "text-teal-300/90" : "text-yellow-300/90"}>{m.name}:</span> {m.msg}
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex items-center gap-2 border-t border-white/10 bg-black/30 px-2.5 py-2"
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 120))}
                placeholder="Press Enter to chat…"
                aria-label="Global chat message"
                maxLength={120}
                className="h-7 flex-1 border-0 bg-transparent px-1 text-xs text-white shadow-none placeholder:text-white/35 focus-visible:ring-0"
              />
              <Button type="submit" size="icon" variant="ghost" aria-label="Send chat" className="h-7 w-7 shrink-0 text-white/60 hover:bg-white/10 hover:text-white">
                <Send size={14} />
              </Button>
            </form>
          </Panel>
        </motion.div>
      )}
    </div>
  );
}

/* ============================ the lobby ============================ */

export function Landing({ onQuickPlay }: { onQuickPlay?: () => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const careerXp = useGame((s) => s.careerXp);
  const look = useGame((s) => s.look);
  const setLook = useGame((s) => s.setLook);
  const daily = useGame((s) => s.daily);
  const ensureDailyToday = useGame((s) => s.ensureDailyToday);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const wins = useGame((s) => s.wins);
  const lifeRescues = useGame((s) => s.lifeRescues);
  const playtimeMs = useGame((s) => s.playtimeMs);

  const [tab, setTab] = useState<Tab>("lobby");
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [lobbyCard, setLobbyCard] = useState<LobbyCard | null>(null);

  const hasProfile = playerName.trim().length > 0;
  const { rank, next, progress, toNext } = rankFor(careerXp);
  const level = Math.floor(careerXp / LEVEL_STEP) + 1;
  const intoLevel = careerXp % LEVEL_STEP;
  const tier = RANKS.findIndex((r) => r.id === rank.id) + 1;
  const season = seasonNo();

  /* audio unlock + warm the leaderboard cache (same as the old landing) */
  useEffect(() => {
    fetch("/api/scores").then((r) => r.json()).then((d) => useGame.getState().setScores(d.scores ?? [])).catch(() => {});
    const unlock = () => { primeAudio(); startMusic(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  /* roll the daily board at local midnight + refresh the reset countdown */
  useEffect(() => {
    const tick = () => { ensureDailyToday(); setCountdown(resetCountdown()); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [ensureDailyToday]);

  /* keyboard shortcuts — PC lobby feel (typing in chat never triggers them) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "p": sfx.click(); setScreen("profile"); break;
        case "l": sfx.click(); setScreen("creator"); break;
        case "c": sfx.click(); setTab("challenges"); break;
        case "b": sfx.click(); setTab("battlepass"); break;
        case "n": sfx.click(); setTab("news"); break;
        case "h": sfx.click(); setHelp(true); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setScreen]);

  /* SOLO PLAYER — straight into the PUBG-style match lobby. Customization
     lives in the LOCKER, so a first-timer just gets a rolled name and drops
     in; nothing about playing solo requires a creator detour anymore. */
  const play = () => {
    sfx.click();
    if (!hasProfile) {
      const pool = NAME_SUGGESTIONS;
      useGame.getState().setName(pool[Math.floor(Math.random() * pool.length)]);
    }
    if (onQuickPlay) onQuickPlay();
    else setScreen("creator");
  };

  const openTab = (id: Tab) => { sfx.click(); setTab(id); };

  /** left-rail icons — open exactly ONE lobby card (Season / Suggested / Daily);
   *  clicking the active icon closes it, clicking another swaps the panel */
  const toggleLobbyCard = (id: LobbyCard) => {
    sfx.click();
    setTab("lobby");
    setLobbyCard((cur) => (cur === id ? null : id));
  };

  const doneCount = daily.tasks.filter((t) => t.done).length;

  /* the left rail — three lobby cards collapsed to icons (badges live on them) */
  const lobbyCards: { id: LobbyCard; label: string; icon: LucideIcon; badge?: string }[] = [
    { id: "season", label: "Season", icon: Crown, badge: `S${season}` },
    { id: "suggested", label: "Suggested", icon: Sparkles },
    { id: "daily", label: "Daily", icon: CalendarDays, badge: `${doneCount}/${daily.tasks.length}` },
  ];

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-slate-950 text-white">
      <style>{`
        .lobby-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .lobby-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 4px; }
        .lobby-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* photoreal horror night backdrop — the lobby matches the rigged GLB cast */}
      <div aria-hidden className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/hero-lobby-night.png)" }} />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-slate-950/72 via-slate-950/32 to-slate-950/88" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(2,6,23,0.48)_100%)]" />

      {/* ================= top bar: logo band + tabs + chips ================= */}
      <header className="relative z-30 flex items-center gap-2 px-2 pt-2 sm:gap-3 sm:px-3">
        {/* angled logo band */}
        <div className="shrink-0 select-none -skew-x-[10deg] rounded-[3px] border border-white/15 bg-slate-950/95 px-3.5 py-1.5 shadow-xl backdrop-blur sm:px-5">
          <span className="block skew-x-[10deg] text-xl font-black italic leading-none tracking-tight text-white sm:text-2xl">
            7<span className="text-orange-500 drop-shadow-[0_0_14px_rgba(249,115,22,0.55)]">NIGHTS</span>
          </span>
        </div>

        {/* tab rail */}
        <nav role="tablist" aria-label="Lobby sections" className="lobby-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => openTab(t.id)}
                className={`-skew-x-[10deg] shrink-0 rounded-[3px] px-3 py-1.5 ring-1 transition-all sm:px-3.5 ${
                  active
                    ? "bg-yellow-400 shadow-[0_0_16px_rgba(253,224,71,0.4)] ring-yellow-300"
                    : "bg-slate-950/85 ring-white/15 hover:bg-slate-800/90 hover:ring-white/30"
                }`}
              >
                <span className={`block skew-x-[10deg] whitespace-nowrap text-[10px] font-black uppercase tracking-wider sm:text-[11px] ${active ? "text-slate-950" : "text-white/85"}`}>
                  {t.label}
                  {t.key && <span className={`ml-1 text-[9px] ${active ? "text-slate-800" : "text-white/40"}`}>[{t.key}]</span>}
                </span>
              </button>
            );
          })}
          {/* LOCKER — jumps to the full survivor creator */}
          <button
            role="tab"
            aria-selected={false}
            onClick={() => { sfx.click(); setScreen("creator"); }}
            className="-skew-x-[10deg] shrink-0 rounded-[3px] bg-slate-950/85 px-3 py-1.5 ring-1 ring-white/15 transition-all hover:bg-slate-800/90 hover:ring-white/30 sm:px-3.5"
          >
            <span className="flex skew-x-[10deg] items-center gap-1 whitespace-nowrap text-[10px] font-black uppercase tracking-wider text-white/85 sm:text-[11px]">
              <Pencil size={11} /> Locker <span className="text-[9px] text-white/40">[L]</span>
            </span>
          </button>
        </nav>

        {/* right chips — XP wallet, crew count, dialogs, avatar */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div title="Career XP" className="flex items-center gap-1.5 rounded-[3px] border border-white/15 bg-slate-950/85 px-2.5 py-1.5 backdrop-blur">
            <Star size={13} className="text-yellow-300" fill="currentColor" />
            <span className="text-xs font-black tabular-nums text-white">{careerXp.toLocaleString()}</span>
            <span className="hidden text-[9px] font-bold uppercase text-white/45 sm:inline">XP</span>
          </div>
          <div title="Friends online" className="hidden items-center gap-1.5 rounded-[3px] border border-white/15 bg-slate-950/85 px-2.5 py-1.5 backdrop-blur md:flex">
            <Users size={13} className="text-teal-300" />
            <span className="text-xs font-black tabular-nums text-white">0</span>
          </div>
          <Button size="icon" variant="ghost" aria-label="How to play" title="How to play [H]"
            onClick={() => { sfx.click(); setHelp(true); }}
            className="h-9 w-9 rounded-[3px] text-white/80 hover:bg-white/10 hover:text-white">
            <Info size={17} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Open settings" title="Settings"
            onClick={() => { sfx.click(); setSettingsOpen(true); }}
            className="h-9 w-9 rounded-[3px] text-white/80 hover:bg-white/10 hover:text-white">
            <Settings size={17} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Open profile" title="Profile [P]"
            onClick={() => { sfx.click(); setScreen("profile"); }}
            className="h-9 w-9 rounded-full p-0 hover:bg-white/10">
            <RankBadge xp={careerXp} size={28} />
          </Button>
        </div>
      </header>

      {/* ================= main: left panels + center stage ================= */}
      <main className="lobby-scroll relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3 pb-2 sm:px-3 lg:flex-row lg:overflow-hidden">
        {/* -------- left rail: Season / Suggested / Daily collapse to icons -------- */}
        <aside className="lobby-scroll order-2 w-full shrink-0 lg:order-1 lg:w-[330px] lg:overflow-y-auto lg:pr-1.5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:gap-2">
            {/* icon rail — click an icon to pop open just that card (one at a time) */}
            <div role="tablist" aria-label="Lobby cards" className="flex shrink-0 flex-row gap-1.5 lg:flex-col">
              {lobbyCards.map((c) => {
                const open = tab === "lobby" && lobbyCard === c.id;
                const RailIcon = c.icon;
                return (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={open}
                    aria-label={`Open ${c.label} card`}
                    title={`${c.label}${c.badge ? ` — ${c.badge}` : ""}`}
                    onClick={() => toggleLobbyCard(c.id)}
                    className={`relative flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border transition-all ${
                      open
                        ? "border-orange-400/80 bg-orange-600/25 text-orange-200 shadow-[0_0_14px_rgba(234,88,12,0.4)]"
                        : "border-white/15 bg-slate-950/85 text-white/70 backdrop-blur hover:bg-slate-800/90 hover:text-white"
                    }`}
                  >
                    <RailIcon size={18} />
                    <span className="text-[8px] font-black uppercase tracking-wider">{c.label}</span>
                    {c.badge && (
                      <span
                        className={`absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black text-white ring-2 ring-slate-950 ${
                          c.id === "daily" && doneCount === daily.tasks.length ? "bg-emerald-500" : "bg-orange-600"
                        }`}
                      >
                        {c.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <motion.div
              key={`${tab}-${lobbyCard ?? "none"}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="min-w-0 flex-1 space-y-2.5"
            >
            {/* ---------- SEASON card (pops open from its rail icon) ---------- */}
            {tab === "lobby" && lobbyCard === "season" && (
            <Panel>
              <Strip right={<span className="text-[10px] font-black uppercase text-white/85">Survive the 7 nights</span>}>
                Season {season}
              </Strip>
              <div className="p-3">
                <div className="flex items-center gap-3">
                  <RankBadge xp={careerXp} size={58} />
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-black italic leading-none text-white">
                      LEVEL <span className="text-yellow-300">{level}</span>
                    </div>
                    <div className="mt-1.5">
                      <XpBar pct={intoLevel / LEVEL_STEP} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-white/55">
                      <span>{intoLevel.toLocaleString()} / {LEVEL_STEP.toLocaleString()} XP</span>
                      <span className="flex items-center gap-1 text-yellow-300/90">
                        <Star size={11} fill="currentColor" /> LVL {level + 1} reward
                      </span>
                    </div>
                  </div>
                </div>

                {/* battle pass tier strip → the rank ladder */}
                <button
                  onClick={() => openTab("battlepass")}
                  className="mt-3 flex w-full items-center gap-2.5 rounded-md border border-yellow-300/35 bg-yellow-400/10 px-3 py-2 text-left transition-colors hover:bg-yellow-400/20"
                  aria-label="Open battle pass"
                >
                  <Trophy size={18} className="shrink-0 text-yellow-300" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wider text-yellow-200">
                      <span className="whitespace-nowrap">Battle pass · Tier {tier}/{RANKS.length}</span>
                      <span className="whitespace-nowrap text-white/55">{next ? `${toNext} XP to tier up` : "MAX 👑"}</span>
                    </span>
                    <span className="mt-1 block"><XpBar pct={progress} bar="from-yellow-300 to-amber-400" h="h-1.5" /></span>
                    <span className="mt-1 block text-[10px] font-bold text-white/60">{rank.emoji} {rank.name}</span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-yellow-200/70" />
                </button>
              </div>
            </Panel>
            )}

            {/* ---------- SUGGESTED challenges card (pops open from its rail icon) ---------- */}
            {tab === "lobby" && lobbyCard === "suggested" && (
                <Panel>
                  <Strip>Suggested challenges</Strip>
                  <div className="space-y-1.5 p-2.5">
                    <button
                      onClick={play}
                      className="flex w-full items-center gap-2 rounded border border-white/10 bg-white/5 px-2.5 py-2 text-left transition-colors hover:border-yellow-300/40 hover:bg-white/10"
                    >
                      <Trophy size={15} className="shrink-0 text-yellow-300" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/90">Win a run — outlast all 7 nights</span>
                      <span className="shrink-0 rounded-full bg-yellow-300/15 px-2 py-0.5 text-[10px] font-black text-yellow-200">+120 XP</span>
                    </button>
                    <button
                      onClick={() => { sfx.click(); setScreen("lobby"); }}
                      className="flex w-full items-center gap-2 rounded border border-white/10 bg-white/5 px-2.5 py-2 text-left transition-colors hover:border-teal-300/40 hover:bg-white/10"
                    >
                      <Users size={15} className="shrink-0 text-teal-300" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/90">Play a match with a friend — host or quick join</span>
                      <span className="shrink-0 rounded-full bg-teal-300/15 px-2 py-0.5 text-[10px] font-black text-teal-200">+50 XP</span>
                    </button>
                    <button
                      onClick={() => openTab("challenges")}
                      className="flex w-full items-center gap-2 rounded border border-white/10 bg-white/5 px-2.5 py-2 text-left transition-colors hover:border-emerald-300/40 hover:bg-white/10"
                    >
                      <Flame size={15} className="shrink-0 text-orange-300" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/90">Keep the 🔥 streak alive — play daily</span>
                      <span className="shrink-0 rounded-full bg-orange-300/15 px-2 py-0.5 text-[10px] font-black text-orange-200">+{ALL_DONE_BONUS} XP</span>
                    </button>
                  </div>
                </Panel>
            )}

            {/* ---------- DAILY challenges card (pops open from its rail icon) ---------- */}
            {tab === "lobby" && lobbyCard === "daily" && (
                <Panel>
                  <Strip right={<span className="text-[10px] font-black text-white/85">{doneCount}/{daily.tasks.length} done</span>}>
                    Daily challenges
                  </Strip>
                  <div className="space-y-1.5 p-2.5">
                    {daily.tasks.map((t) => {
                      const def = DAILY_TASK_POOL.find((d) => d.id === t.id);
                      const pct = Math.min(1, t.progress / t.target);
                      return (
                        <div key={t.id} className={`rounded border px-2.5 py-2 ${t.done ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/10 bg-white/5"}`}>
                          <div className="flex items-center gap-2 text-[11px] font-bold text-white/90">
                            <span aria-hidden className="text-base leading-none">{t.done ? "✅" : (def?.emoji ?? "🎯")}</span>
                            <span className="min-w-0 flex-1 truncate">{def?.label(t.target) ?? t.id}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${t.done ? "bg-emerald-400/25 text-emerald-200" : "bg-yellow-300/15 text-yellow-200"}`}>
                              {t.done ? "done" : `+${t.xp} XP`}
                            </span>
                          </div>
                          {!t.done && (
                            <div className="mt-1.5 flex items-center gap-2">
                              <XpBar pct={pct} bar="from-emerald-400 to-yellow-300" h="h-1.5" />
                              <span className="w-16 shrink-0 text-right text-[10px] font-black tabular-nums text-white/55">
                                {Math.floor(t.progress)}/{t.target}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-0.5 text-[10px] font-bold text-white/45">
                      <span>🔥 streak: <b className="text-orange-200">{daily.streak} day{daily.streak === 1 ? "" : "s"}</b></span>
                      <span>resets in {countdown || "…"}</span>
                    </div>
                  </div>
                </Panel>
            )}

            {/* ---------- BATTLE PASS tab: the rank ladder ---------- */}
            {tab === "battlepass" && (
              <Panel>
                <Strip right={<span className="text-[10px] font-black text-slate-800">{careerXp.toLocaleString()} career XP</span>}>
                  Battle pass · Night legend ladder
                </Strip>
                <div className="space-y-1.5 p-2.5">
                  <div className="flex items-center gap-2.5 rounded border border-yellow-300/40 bg-yellow-400/10 px-2.5 py-2">
                    <RankBadge xp={careerXp} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-black ${rank.text}`}>{rank.name}</div>
                      <div className="mb-1 text-[10px] font-bold text-white/55">
                        {next ? `${toNext.toLocaleString()} XP → ${next.emoji} ${next.name}` : "Top rank — you are a 7Nights legend!"}
                      </div>
                      <XpBar pct={progress} bar={rank.bar} h="h-1.5" />
                    </div>
                  </div>
                  {RANKS.map((r) => {
                    const reached = careerXp >= r.min;
                    const current = r.id === rank.id;
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center gap-2.5 rounded border px-2.5 py-2 ${
                          current ? "border-yellow-300/50 bg-yellow-400/10" : reached ? "border-white/10 bg-white/5" : "border-white/10 opacity-55"
                        }`}
                      >
                        <span aria-hidden className="w-7 text-center text-lg">{reached ? r.emoji : "🔒"}</span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-black ${current ? "text-yellow-200" : "text-white/85"}`}>
                            {r.name}
                            {current && <span className="ml-1.5 rounded-full bg-yellow-400 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-950">You</span>}
                          </div>
                          <div className="text-[10px] font-bold text-white/45">{r.min.toLocaleString()} career XP</div>
                        </div>
                        {reached ? <Check size={15} className="shrink-0 text-emerald-300" /> : <Lock size={13} className="shrink-0 text-white/40" />}
                      </div>
                    );
                  })}
                  <p className="px-1 pt-0.5 text-[10px] font-bold leading-relaxed text-white/45">
                    XP = every point you bank, forever. Daily task bonuses count too — never resets.
                  </p>
                </div>
              </Panel>
            )}

            {/* ---------- CHALLENGES tab: the full daily board ---------- */}
            {tab === "challenges" && (
              <Panel>
                <Strip right={<span className="flex items-center gap-1 text-[10px] font-black text-white/85"><Flame size={11} /> {daily.streak}-day streak</span>}>
                  Daily challenges
                </Strip>
                <div className="space-y-1.5 p-2.5">
                  {daily.tasks.map((t) => {
                    const def = DAILY_TASK_POOL.find((d) => d.id === t.id);
                    const pct = Math.min(1, t.progress / t.target);
                    return (
                      <div key={t.id} className={`rounded border px-2.5 py-2 ${t.done ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/10 bg-white/5"}`}>
                        <div className="flex items-center gap-2 text-[11px] font-bold text-white/90">
                          <span aria-hidden className="text-base leading-none">{t.done ? "✅" : (def?.emoji ?? "🎯")}</span>
                          <span className="min-w-0 flex-1">{def?.label(t.target) ?? t.id}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${t.done ? "bg-emerald-400/25 text-emerald-200" : "bg-yellow-300/15 text-yellow-200"}`}>
                            {t.done ? "done" : `+${t.xp} XP`}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <XpBar pct={t.done ? 1 : pct} bar="from-emerald-400 to-yellow-300" h="h-1.5" />
                          <span className="w-16 shrink-0 text-right text-[10px] font-black tabular-nums text-white/55">
                            {Math.min(Math.floor(t.progress), t.target)}/{t.target}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className={`rounded border px-2.5 py-2 text-[11px] font-bold ${doneCount === daily.tasks.length ? "border-fuchsia-300/40 bg-fuchsia-400/10 text-fuchsia-200" : "border-white/10 bg-white/5 text-white/60"}`}>
                    {doneCount === daily.tasks.length
                      ? "🎉 All 3 done — the +100 XP bonus is paid. See you tomorrow!"
                      : `Finish all 3 for a +${ALL_DONE_BONUS} XP bonus · resets in ${countdown || "…"}`}
                  </div>
                </div>
              </Panel>
            )}

            {/* ---------- ITEM SHOP tab: outfit presets, all free ---------- */}
            {tab === "store" && (
              <Panel>
                <Strip right={<span className="text-[10px] font-black text-slate-800">Everything FREE</span>}>
                  Item shop · Outfits
                </Strip>
                <div className="grid grid-cols-2 gap-1.5 p-2.5">
                  {OUTFIT_PRESETS.map((p) => {
                    const on = presetEquipped(look, p);
                    const dots = (["shirt", "pants", "shoe"] as const).map((k) => p.look[k]).filter(Boolean);
                    return (
                      <button
                        key={p.id}
                        onClick={() => { sfx.pickup(); setLook(p.look); }}
                        aria-pressed={on}
                        className={`rounded border p-2 text-center transition-all hover:scale-[1.03] ${
                          on ? "border-yellow-300 bg-yellow-300/15 shadow-[0_0_12px_rgba(253,224,71,0.3)]" : "border-white/12 bg-white/5 hover:border-yellow-300/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xl leading-none">{p.emoji}</span>
                          {on ? <span className="flex items-center gap-0.5 text-[9px] font-black uppercase text-yellow-300"><Check size={10} strokeWidth={3.5} /> worn</span> : <span className="text-[9px] font-black uppercase text-emerald-300">free</span>}
                        </div>
                        <div className="mt-1 truncate text-left text-[10px] font-bold text-white/85">{p.label}</div>
                        <div className="mt-1 flex items-center gap-1">
                          {dots.map((c, i) => (
                            <span key={i} aria-hidden className="h-2 w-2 rounded-full border border-black/40 ring-1 ring-white/20" style={{ background: c }} />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-white/10 px-3 py-2 text-[10px] font-bold text-white/45">
                  Tap an outfit to wear it instantly — fine-tune colors in the LOCKER.
                </div>
              </Panel>
            )}

            {/* ---------- CAREER tab: quick stats → full profile ---------- */}
            {tab === "career" && (
              <Panel>
                <Strip>Career · {playerName || "Unnamed survivor"}</Strip>
                <div className="space-y-2.5 p-3">
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {[
                      ["Runs", String(runsPlayed)],
                      ["Best", bestScore.toLocaleString()],
                      ["Wins", String(wins)],
                      ["Rescues", String(lifeRescues)],
                      ["XP", careerXp.toLocaleString()],
                      ["Playtime", `${Math.max(1, Math.round(playtimeMs / 60_000))}m`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded border border-white/10 bg-white/5 px-1 py-2">
                        <div className="truncate text-sm font-black text-white">{value}</div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-white/50">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    <Button
                      onClick={() => { sfx.click(); setScreen("profile"); }}
                      className="h-10 w-full rounded-md bg-white/10 font-black text-white ring-1 ring-white/20 hover:bg-white/20"
                    >
                      <User size={15} className="mr-1.5" /> Manage profile
                    </Button>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        onClick={() => { sfx.click(); setStatsOpen(true); }}
                        className="h-9 rounded-md border-white/20 bg-black/40 text-xs font-black text-white hover:bg-black/60"
                        variant="outline"
                      >
                        <BarChart3 size={14} className="mr-1" /> Stats
                      </Button>
                      <Button
                        onClick={() => { sfx.click(); setHistoryOpen(true); }}
                        className="h-9 rounded-md border-white/20 bg-black/40 text-xs font-black text-white hover:bg-black/60"
                        variant="outline"
                      >
                        <HistoryIcon size={14} className="mr-1" /> History
                      </Button>
                    </div>
                  </div>
                </div>
              </Panel>
            )}

            {/* ---------- NEWS tab ---------- */}
            {tab === "news" && (
              <Panel>
                <Strip>Night line news</Strip>
                <div className="space-y-1.5 p-2.5">
                  {NIGHT_TICKER.slice(0, 6).map((l, i) => (
                    <div key={i} className="flex items-start gap-2 rounded border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] font-bold leading-snug text-white/80">
                      <Newspaper size={13} className="mt-0.5 shrink-0 text-red-300" />
                      <span>{l}</span>
                    </div>
                  ))}
                  <div className="rounded border border-yellow-300/35 bg-yellow-400/10 px-2.5 py-2 text-[11px] font-bold leading-snug text-yellow-100">
                    <b className="uppercase">Patch notes — lobby update:</b> a Fortnite-style PC dashboard, item shop with
                    free outfit presets, battle-pass rank ladder and lobby chat. PLAY now queues straight into the
                    100-soul match lobby.
                  </div>
                </div>
              </Panel>
            )}
            </motion.div>
          </div>
        </aside>

        {/* -------- center: the survivor stage -------- */}
        <section
          aria-label="Your survivor — drag to spin"
          className="relative order-1 h-[44vh] min-h-[300px] w-full lg:order-2 lg:mr-[330px] lg:h-auto lg:min-h-0 lg:flex-1"
        >
          {/* name plate + ready status (Fortnite center-stage) */}
          <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 text-center">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-950/75 px-4 py-1.5 ring-1 ring-white/20 backdrop-blur">
              {rank.id === "legend" && <Crown size={15} className="shrink-0 text-yellow-300" />}
              <RankBadge xp={careerXp} size={22} />
              <span className="max-w-[190px] truncate text-sm font-black text-white">{hasProfile ? playerName : "Unnamed survivor"}</span>
              <button
                onClick={() => { sfx.click(); setScreen("creator"); }}
                aria-label="Edit survivor in locker"
                title="Edit in locker [L]"
                className="rounded-full bg-white/10 p-1 text-white/75 transition-colors hover:bg-white/25 hover:text-white"
              >
                <Pencil size={12} />
              </button>
            </div>
            <div
              className={`mt-1.5 inline-block rounded px-3 py-0.5 text-[11px] font-black uppercase tracking-[0.2em] ${
                hasProfile ? "bg-yellow-400/90 text-slate-950" : "bg-slate-950/75 text-yellow-300 ring-1 ring-yellow-300/50"
              }`}
            >
              {hasProfile ? "Ready" : "Not ready"}
            </div>
          </div>

          {/* the rigged GLB survivor standing on the lobby floor (drag to spin) */}
          <div className="absolute inset-0">
            <LobbyStage look={look} />
          </div>

          {/* rank boost pill — mobile keeps it under the stage glow */}
          <div className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 lg:hidden">
            <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-black text-yellow-200 ring-1 ring-yellow-300/40 backdrop-blur sm:px-4">
              <Zap size={13} className="shrink-0 text-yellow-300" />
              {rank.emoji} {rank.name} · {careerXp.toLocaleString()} XP
            </div>
          </div>
        </section>
      </main>

      {/* ================= bottom bar: play buttons + chat dock ================= */}
      <footer className="relative z-30 flex flex-col gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 lg:flex-row lg:items-end lg:justify-end">
        {/* desktop: rank pill hangs just below the stage's glowing circle */}
        <div className="absolute -top-2 left-1/2 z-20 hidden -translate-x-1/2 lg:block">
          <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/55 px-4 py-1.5 text-[11px] font-black text-yellow-200 ring-1 ring-yellow-300/40 backdrop-blur">
            <Zap size={13} className="shrink-0 text-yellow-300" />
            {rank.emoji} {rank.name} · {careerXp.toLocaleString()} XP
          </div>
        </div>

        <div className="relative flex flex-col gap-2 lg:w-80">
          {/* dock row: global chat icon + controller-style hints (desktop) */}
          <div className="flex items-center justify-end gap-3">
            <div className="hidden items-center gap-3 text-[10px] font-bold text-white/45 lg:flex">
              <span><kbd className="rounded bg-white/10 px-1">H</kbd> help</span>
              <span><kbd className="rounded bg-white/10 px-1">P</kbd> profile</span>
              <span><kbd className="rounded bg-white/10 px-1">L</kbd> locker</span>
              <span><kbd className="rounded bg-white/10 px-1">C</kbd> challenges</span>
            </div>
            <GlobalChatDock name={playerName} />
          </div>

          {/* squads fill — multiplayer lobby */}
          <Button
            onClick={() => { sfx.click(); setScreen("lobby"); }}
            aria-label="Open multiplayer — host or join a night"
            className="h-12 w-full rounded-md bg-slate-700/85 font-black text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-slate-600/90"
          >
            <span className="flex w-full items-center justify-center gap-2">
              <Users size={18} className="shrink-0 text-teal-300" />
              <span className="text-base uppercase tracking-wide">Multiplayer</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">squads · host · join</span>
            </span>
          </Button>

          {/* the big yellow SOLO PLAYER — always ready, no creator detour */}
          <Button
            onClick={play}
            aria-label="Solo player — queue into a night"
            className="h-16 w-full rounded-md bg-yellow-400 text-2xl font-black italic uppercase tracking-wide text-slate-950 shadow-[0_6px_0_rgba(161,98,7,0.55)] transition-all hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[0_3px_0_rgba(161,98,7,0.55)]"
          >
            <span className="flex items-center gap-3">
              <Play size={26} fill="currentColor" />
              Solo Player
            </span>
          </Button>
        </div>
      </footer>

      <HowToPlay open={help} onOpenChange={setHelp} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
