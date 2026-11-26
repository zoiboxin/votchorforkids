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
 *   • bottom: Global chat docked as a right-side icon — a LIVE socket.io relay
 *     (mini-services/chat-service) where every soul sees every message; the icon
 *     carries an UNSEEN badge that clears the moment the panel is opened, and
 *     the big yellow SOLO PLAYER button plus the MULTIPLAYER squads button —
 *     customization lives in the LOCKER, never blocking the way into a night
 *
 * Wiring is unchanged: SOLO PLAYER queues through the PUBG-style match lobby
 * (bots fill the 100-soul night; a name is rolled automatically the first
 * time), Locker opens the full survivor creator, Career opens the profile
 * hub. Keyboard: [H] help · [P] profile · [L] locker · [S] item shop ·
 * [C] challenges · [B] battle pass · [N] news.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { io, type Socket } from "socket.io-client";
import {
  CalendarDays, ChevronRight, Cloud, CloudOff, CloudUpload, Crown, Flame,
  Info, MessageSquare, Pencil, Play, Send, Settings, Sparkles, Star, Trophy,
  Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAILY_TASK_POOL, ALL_DONE_BONUS } from "@/lib/game/daily";
import {
  NAME_SUGGESTIONS,
  type Appearance,
} from "@/lib/game/constants";
import { RANKS, rankFor } from "@/lib/game/ranks";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { storageBlocked } from "@/lib/game/storage";
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

/* ------------- global chat (right-side dock — LIVE socket.io relay) -------------
 * mini-services/chat-service keeps the shared history and broadcasts every
 * message to every connected soul. The dock badge counts UNSEEN messages that
 * arrived while the panel was closed — opening the panel marks them seen and
 * the badge clears. History catch-up never pings the badge. */

interface ChatMsg { id: string; name: string; msg: string; ts: number }

const CHAT_PORT = 3003;

function GlobalChatDock({ name, placement }: { name: string; placement: "rail" | "dock" }) {
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(1);
  const socketRef = useRef<Socket | null>(null);
  const openRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const meRef = useRef(name);

  /* keep the sender identity fresh for the unseen-badge check */
  useEffect(() => { meRef.current = name || "Guest"; }, [name]);

  /* one socket per lobby session — server keeps history + relays everything */
  useEffect(() => {
    const socket = io(`/?XTransformPort=${CHAT_PORT}`, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    /* late joiner catch-up — history arrives pre-seen, no badge ping */
    socket.on("chat:history", (msgs: ChatMsg[]) => {
      setChat(msgs.slice(-50));
      setUnread(0);
    });

    socket.on("chat:message", (m: ChatMsg) => {
      setChat((c) => [...c.slice(-50), m]);
      /* unseen only while the panel is closed and it's not our own echo */
      if (!openRef.current && m.name !== meRef.current) {
        setUnread((u) => Math.min(99, u + 1));
      }
    });

    socket.on("chat:presence", (p: { online: number }) => setOnline(Math.max(1, p.online)));

    return () => { socket.disconnect(); };
  }, []);

  /* newest message stays in view while the panel is open */
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat, open]);

  const toggle = () => {
    sfx.click();
    const next = !open;
    openRef.current = next;
    setOpen(next);
    if (next) setUnread(0); // seen — the badge clears
  };

  const send = () => {
    const msg = draft.trim().slice(0, 120);
    const socket = socketRef.current;
    if (!msg || !socket?.connected) return;
    socket.emit("chat:send", { name: meRef.current, msg });
    setDraft("");
    sfx.click();
  };

  /* 📍 panel position follows the placement:
     • "rail" (desktop right-rail icon near the TOP) → FIXED under the header
       bar and opens DOWNWARD — a bottom-anchored panel here would fly off the
       top of the screen; fixed + top-16 always fits every viewport
     • "dock" (mobile footer icon) → anchored to its icon, opens UPWARD as before */
  const panelPos = placement === "rail"
    ? "fixed right-3 top-16 z-40 w-[min(20rem,calc(100vw-2.5rem))]"
    : "absolute bottom-[calc(100%+10px)] right-0 z-40 w-[min(20rem,calc(100vw-2.5rem))]";

  return (
    <div className="relative">
      {/* dock icon — the SAME rail-icon style as Season/Suggested/Daily (right side):
          square tile, icon over label, badge at the corner, ember glow while open */}
      <button
        onClick={toggle}
        aria-label={`Global chat${unread > 0 ? ` — ${unread} unread` : ""}`}
        aria-expanded={open}
        title="Global chat"
        className={`relative flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-md border transition-all ${
          open
            ? "border-orange-400/80 bg-orange-600/25 text-orange-200 shadow-[0_0_14px_rgba(234,88,12,0.4)]"
            : "border-white/15 bg-slate-950/85 text-white/70 backdrop-blur hover:bg-slate-800/90 hover:text-white"
        }`}
      >
        <MessageSquare size={18} />
        <span className="text-[8px] font-black uppercase tracking-wider">Chat</span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[9px] font-black text-white ring-2 ring-slate-950">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -left-0.5 h-2 w-2 rounded-full ring-2 ring-slate-950 ${
            connected ? "bg-emerald-400" : "animate-pulse bg-rose-500"
          }`}
        />
      </button>

      {/* the chat panel — same card style as the challenges board; rail opens
          DOWNWARD from under the header, dock opens UPWARD above its icon */}
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className={panelPos}
        >
          <Panel>
            <Strip
              right={
                <span className="flex items-center gap-2">
                  <span
                    className="flex items-center gap-1 text-[10px] font-black text-white/85"
                    title={connected ? `${online} souls in the lobby` : "Connecting to the nightline…"}
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full ${
                        connected ? "bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "animate-pulse bg-rose-300"
                      }`}
                    />
                    {connected ? online : "…"}
                  </span>
                  <button
                    onClick={toggle}
                    aria-label="Close global chat"
                    className="rounded p-0.5 text-white/85 transition-colors hover:bg-black/25 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                </span>
              }
            >
              Global chat
            </Strip>
            <div ref={scrollRef} aria-live="polite" className="lobby-scroll max-h-52 min-h-[3.5rem] space-y-1.5 overflow-y-auto p-2.5">
              {chat.length === 0 ? (
                <p className="px-1 py-2 text-center text-[11px] font-bold text-white/40">
                  {connected ? "Say hello to the night…" : "Lighting the relay…"}
                </p>
              ) : (
                chat.map((m) => {
                  const mine = m.name === (name || "Guest");
                  return (
                    <div key={m.id} className="rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold leading-snug text-white/80">
                      <span className={m.name === "NightLine" ? "text-teal-300/90" : mine ? "text-yellow-300/90" : "text-orange-200/90"}>
                        {m.name}:
                      </span>{" "}
                      {m.msg}
                    </div>
                  );
                })
              )}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex items-center gap-2 border-t border-white/10 bg-black/30 px-2.5 py-2"
            >
              <Input
                value={draft}
                disabled={!connected}
                onChange={(e) => setDraft(e.target.value.slice(0, 120))}
                placeholder={connected ? "Press Enter to chat…" : "Lighting the relay…"}
                aria-label="Global chat message"
                maxLength={120}
                className="h-7 flex-1 border-0 bg-transparent px-1 text-xs text-white shadow-none placeholder:text-white/35 focus-visible:ring-0"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                disabled={!connected || !draft.trim()}
                aria-label="Send chat"
                className="h-7 w-7 shrink-0 text-white/60 hover:bg-white/10 hover:text-white"
              >
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

/** 🍪 cookies & progress bar — the player system is consent-gated: accepting
 *  turns on the cloud profile sync (device save + server upsert + download
 *  backup). Local play works regardless. Rendered by GameRoot so it is
 *  reachable from every screen (lobby, locker, profile…). */
export function CookieBar() {
  const consent = useGame((s) => s.consent);
  const setConsent = useGame((s) => s.setConsent);
  const [later, setLater] = useState(false);
  // 🛡️ the preview panel runs the game in a sandboxed iframe — many browsers
  // block storage there; the game still plays (session-only) via the safe
  // storage fallback, and the banner says so instead of silently not saving
  const [blocked] = useState(() => storageBlocked());
  if (consent || later) return null;
  return (
    <div
      role="dialog"
      aria-label="Cookies and saved progress"
      className="fixed bottom-3 left-3 z-50 w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-white/20 bg-slate-950/92 p-3 shadow-2xl backdrop-blur"
    >
      <div className="text-[11px] font-black uppercase tracking-wider text-white/85">🍪 Cookies &amp; your progress</div>
      <p className="mt-1 text-[11px] font-semibold leading-snug text-white/65">
        7Nights saves your hero, cash, purchases and stats on this device — and syncs them to your
        <b className="text-white"> player profile</b> so nothing is ever lost. Accept to turn on the cloud save.
      </p>
      {blocked && (
        <p className="mt-1.5 rounded-lg bg-amber-400/15 px-2 py-1.5 text-[10px] font-bold leading-snug text-amber-200">
          ⚠️ This view blocks saving (sandboxed panel) — progress lasts this session only.
          Open the game in a new tab to keep your hero, cash &amp; purchases forever.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => { sfx.pickup(); setConsent(true); }}
          aria-label="Accept cookies and enable profile sync"
          className="flex-1 rounded-lg bg-orange-600 px-3 py-2 text-[11px] font-black uppercase text-white transition-colors hover:bg-orange-500"
        >
          Accept
        </button>
        <button
          onClick={() => { sfx.click(); setLater(true); }}
          aria-label="Not now"
          className="rounded-lg border border-white/20 px-3 py-2 text-[11px] font-black text-white/70 transition-colors hover:bg-white/10"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

export function Landing({ onQuickPlay }: { onQuickPlay?: () => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const careerXp = useGame((s) => s.careerXp);
  const look = useGame((s) => s.look);
  const coins = useGame((s) => s.coins);
  const consent = useGame((s) => s.consent);
  const setConsent = useGame((s) => s.setConsent);
  const syncStatus = useGame((s) => s.syncStatus);
  const pullProfile = useGame((s) => s.pullProfile);
  const daily = useGame((s) => s.daily);
  const ensureDailyToday = useGame((s) => s.ensureDailyToday);

  /* 🗂️ lobby tab lives in the store so any panel can deep-link straight into
     a tab (locker → "Open the Item Shop" now lands on the full shop page) */
  const landingTab = useGame((s) => s.landingTab);
  const setLandingTabStore = useGame((s) => s.setLandingTab);
  const tab = landingTab as Tab;
  const setTab = (t: Tab) => setLandingTabStore(t);
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

  /* ☁️ logged in + cookies accepted → pull this player's cloud profile ONCE so
     everything they own (hero, cash, purchases, stats) greets them on load */
  useEffect(() => {
    if (consent && playerName.trim()) void pullProfile();
  }, [consent, playerName, pullProfile]);

  /* roll the daily board at local midnight + refresh the reset countdown */
  useEffect(() => {
    const tick = () => { ensureDailyToday(); setCountdown(resetCountdown()); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [ensureDailyToday]);

  /* 🗂️ every non-lobby tab is a DEDICATED FULL PAGE now (the Item-Shop pattern):
     old deep-links that still ask for a "battlepass"/"challenges"/"career"/
     "news"/"store" tab land on their page instead (the panel is gone) */
  useEffect(() => {
    if (landingTab === "store") {
      setLandingTabStore("lobby");
      setScreen("shop");
    } else if (landingTab === "battlepass" || landingTab === "challenges" || landingTab === "career" || landingTab === "news") {
      setLandingTabStore("lobby");
      setScreen(landingTab);
    }
  }, [landingTab, setLandingTabStore, setScreen]);

  /* keyboard shortcuts — PC lobby feel (typing in chat never triggers them) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "p": sfx.click(); setScreen("profile"); break;
        case "l": sfx.click(); setScreen("locker"); break;
        case "s": sfx.click(); setScreen("shop"); break;
        case "c": sfx.click(); setScreen("challenges"); break;
        case "b": sfx.click(); setScreen("battlepass"); break;
        case "n": sfx.click(); setScreen("news"); break;
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

  /** tab rail — every non-lobby tab is a dedicated full page (Item Shop pattern):
      the store stays a tab so the rail reads like the big BR games, but it
      navigates away instead of swapping the panel under the 3D stage */
  const openTab = (id: Tab) => {
    sfx.click();
    if (id === "lobby") { setTab("lobby"); return; }
    setLandingTabStore("lobby"); // the lobby dashboard owns the tab rail again on return
    setScreen(id === "store" ? "shop" : id);
  };

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
                title={t.id === "store" ? "Open the full Item Shop page [S]" : undefined}
                onClick={() => {
                  if (t.id === "store") { sfx.click(); setScreen("shop"); } // 🛒 the shop is its own page now
                  else openTab(t.id);
                }}
                className={`-skew-x-[10deg] shrink-0 rounded-[3px] px-3 py-1.5 ring-1 transition-all sm:px-3.5 ${
                  active
                    ? "bg-yellow-400 shadow-[0_0_16px_rgba(253,224,71,0.4)] ring-yellow-300"
                    : t.id === "store"
                      ? "bg-slate-950/85 ring-white/15 hover:bg-orange-900/80 hover:ring-orange-300/40"
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
          {/* LOCKER — the PUBG-style loadout hub: equipped purchases + styles */}
          <button
            role="tab"
            aria-selected={false}
            onClick={() => { sfx.click(); setScreen("locker"); }}
            className="-skew-x-[10deg] shrink-0 rounded-[3px] bg-slate-950/85 px-3 py-1.5 ring-1 ring-white/15 transition-all hover:bg-slate-800/90 hover:ring-white/30 sm:px-3.5"
          >
            <span className="flex skew-x-[10deg] items-center gap-1 whitespace-nowrap text-[10px] font-black uppercase tracking-wider text-white/85 sm:text-[11px]">
              <Pencil size={11} /> Locker <span className="text-[9px] text-white/40">[L]</span>
            </span>
          </button>
        </nav>

        {/* right chips — 💰 collected cash, XP wallet, crew count, dialogs, avatar */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div
            title="Collected cash — banked from roaming the town. Spend it in the Item Shop!"
            className="flex items-center gap-1.5 rounded-[3px] border border-yellow-300/40 bg-yellow-400/15 px-2.5 py-1.5 backdrop-blur"
          >
            <span aria-hidden className="text-[13px] leading-none">💰</span>
            <span className="text-xs font-black tabular-nums text-yellow-300">${coins.toLocaleString()}</span>
            <span className="hidden text-[9px] font-bold uppercase text-yellow-200/70 sm:inline">CASH</span>
          </div>
          <div title="Career XP" className="flex items-center gap-1.5 rounded-[3px] border border-white/15 bg-slate-950/85 px-2.5 py-1.5 backdrop-blur">
            <Star size={13} className="text-yellow-300" fill="currentColor" />
            <span className="text-xs font-black tabular-nums text-white">{careerXp.toLocaleString()}</span>
            <span className="hidden text-[9px] font-bold uppercase text-white/45 sm:inline">XP</span>
          </div>
          {consent && (
            <div
              title={`Player profile sync: ${syncStatus}`}
              aria-label={`Profile sync ${syncStatus}`}
              className="hidden items-center rounded-[3px] border border-white/15 bg-slate-950/85 px-2 py-1.5 backdrop-blur sm:flex"
            >
              {syncStatus === "saving" ? (
                <CloudUpload size={13} className="animate-pulse text-yellow-300" />
              ) : syncStatus === "saved" ? (
                <Cloud size={13} className="text-emerald-300" />
              ) : syncStatus === "offline" ? (
                <CloudOff size={13} className="text-rose-300" />
              ) : (
                <Cloud size={13} className="text-white/50" />
              )}
            </div>
          )}
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
            <div role="tablist" aria-label="Lobby cards" className="flex shrink-0 flex-row gap-1.5 lg:mt-8 lg:flex-col">
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

            </motion.div>
          </div>
        </aside>

        {/* -------- center: the survivor stage --------
             The left rail (330px) is far wider than the right rail (56px),
             which shoves a plain flex-1 stage right of the viewport center.
             A compensating lg right margin re-centers the whole stage — hero,
             name plate and rank pill all line up dead-center like the big-game
             lobbies. (Offset = (330 − 56) / 2 + gap = 137px → margin = 274px.) */}
        <section
          aria-label="Your survivor — drag to spin"
          className="relative order-1 h-[44vh] min-h-[300px] w-full lg:order-2 lg:mr-[274px] lg:h-auto lg:min-h-0 lg:flex-1"
        >
          {/* name plate + rank pill (Fortnite center-stage) */}
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
            {/* rank pill — moved up from under the stage circle into the old
                READY badge's slot (the Not-ready badge is gone for good) */}
            <div className="mt-1.5 inline-block">
              <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/55 px-4 py-1.5 text-[11px] font-black text-yellow-200 ring-1 ring-yellow-300/40 backdrop-blur">
                <Zap size={13} className="shrink-0 text-yellow-300" />
                {rank.emoji} {rank.name} · {careerXp.toLocaleString()} XP
              </div>
            </div>
          </div>

          {/* the rigged GLB survivor standing on the lobby floor (drag to spin) */}
          <div className="absolute inset-0">
            <LobbyStage look={look} />
          </div>
        </section>

        {/* -------- right rail: the chat icon rides UP opposite the Season icon --------
             Same rail-icon style, same top offset (mt-8) as the left rail — mirrored.
             Its panel opens DOWNWARD from a fixed spot under the header (placement="rail"). */}
        <div className="order-3 hidden shrink-0 lg:order-3 lg:mt-8 lg:flex lg:w-14 lg:flex-col lg:items-center">
          <GlobalChatDock name={playerName} placement="rail" />
        </div>
      </main>

      {/* ================= bottom bar: play buttons + chat dock (mobile) ================= */}
      <footer className="relative z-30 flex flex-col gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 lg:flex-row lg:items-end lg:justify-end">
        <div className="relative flex flex-col gap-2 lg:w-80">
          {/* mobile keeps the chat dock here — desktop moved it to the right rail */}
          <div className="flex items-center justify-end gap-3 lg:hidden">
            <GlobalChatDock name={playerName} placement="dock" />
          </div>
          {/* desktop: controller-style hints */}
          <div className="hidden items-center justify-end gap-3 text-[10px] font-bold text-white/45 lg:flex">
            <span><kbd className="rounded bg-white/10 px-1">H</kbd> help</span>
            <span><kbd className="rounded bg-white/10 px-1">P</kbd> profile</span>
            <span><kbd className="rounded bg-white/10 px-1">L</kbd> locker</span>
            <span><kbd className="rounded bg-white/10 px-1">C</kbd> challenges</span>
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
