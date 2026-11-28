"use client";

/**
 * Landing — the FORTNITE / PUBG-style PC lobby dashboard.
 *
 * A dense desktop lobby, exactly the pattern from the big battle-royale games:
 *   • angled logo band + tab rail on top (Lobby · Battle Pass · Challenges ·
 *     Locker · Item Shop · Career · News) with XP / crew chips and the avatar
 *   • left rail: SEASON, SUGGESTED and DAILY icons — each navigates to its
 *     own DEDICATED FULL PAGE (the Item-Shop pattern): the season calendar
 *     follows the cpanel-scheduled live season, Suggested is the smart
 *     recommendation hub, Daily is the full challenge board
 *   • center: the rigged GLB survivor LIVE on the lobby floor (drag to spin,
 *     glowing center circle — no cartoon bodies) with the name plate + READY
 *     status above and the rank boost pill below
 *   • bottom: Global chat docked as a right-side icon — a LIVE socket.io relay
 *     (mini-services/chat-service) where every soul sees every message; the
 *     icon carries an UNSEEN badge that clears the moment the panel is opened,
 *     and the big yellow SOLO PLAYER button plus the MULTIPLAYER squads
 *     button — customization lives in the LOCKER, never blocking the way in
 *
 * 🛡️ Chat moderation aware: the relay bounces blocked/banned/muted senders
 * with chat:blocked / chat:muted / chat:banned, deleted messages vanish via
 * chat:delete — the dock renders strike notices and restricts the input.
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
  CalendarDays, Cloud, CloudOff, CloudUpload, Crown,
  Info, MessageSquare, Pencil, Play, Send, Settings, Sparkles, Star,
  Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NAME_SUGGESTIONS,
  type Appearance,
} from "@/lib/game/constants";
import { rankFor } from "@/lib/game/ranks";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { storageBlocked } from "@/lib/game/storage";
import { useGame, type Screen } from "./store";
import { HowToPlay, SettingsDialog, StatsDialog, HistoryDialog } from "./Panels";
import { RankBadge } from "./RankCard";
import { LobbyStage } from "./LobbyStage";

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

/* ------------- global chat (right-side dock — LIVE socket.io relay) -------------
 * mini-services/chat-service PERSISTS 7 days of shared history (SQLite) and
 * broadcasts every message to every connected soul — a page refresh replays
 * the stored lines, nothing is lost. The dock badge counts UNSEEN messages
 * that arrived while the panel was closed — opening the panel marks them seen
 * and the badge clears. History catch-up never pings the badge.
 *
 * 🛡️ Moderation aware: the relay silently refuses muted/banned senders and
 * answers with chat:muted / chat:banned; abusive language never broadcasts
 * and answers chat:blocked with the strike count (3 strikes → 30 min auto-
 * mute). Deleted-by-admin lines vanish live via chat:delete. */

interface ChatMsg { id: string; name: string; msg: string; ts: number }

const CHAT_PORT = 3003;

/* how many lines the panel keeps in view — the relay stores a full 7 days and
 * replays the newest 300 on (re)connect, so a refresh re-shows the week */
const CHAT_VIEW_CAP = 300;

function GlobalChatDock({ name, placement }: { name: string; placement: "rail" | "dock" }) {
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(1);
  /* 🛡️ moderation state — strike notices, mute sentence, chat ban */
  const [sysNotes, setSysNotes] = useState<{ id: number; text: string; kind: "block" | "mute" | "ban" }[]>([]);
  const [muted, setMuted] = useState<{ until: number; reason: string } | null>(null);
  const [banned, setBanned] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const openRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const meRef = useRef(name);
  const sysIdRef = useRef(1);

  const pushNote = (text: string, kind: "block" | "mute" | "ban") => {
    setSysNotes((s) => [...s.slice(-4), { id: sysIdRef.current++, text, kind }]);
  };

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

    /* late joiner catch-up — stored history arrives pre-seen, no badge ping */
    socket.on("chat:history", (msgs: ChatMsg[]) => {
      setChat(msgs.slice(-CHAT_VIEW_CAP));
      setUnread(0);
    });

    socket.on("chat:message", (m: ChatMsg) => {
      setChat((c) => [...c.slice(-(CHAT_VIEW_CAP - 1)), m]);
      /* unseen only while the panel is closed and it's not our own echo */
      if (!openRef.current && m.name !== meRef.current) {
        setUnread((u) => Math.min(99, u + 1));
      }
    });

    socket.on("chat:presence", (p: { online: number }) => setOnline(Math.max(1, p.online)));

    /* 🛡️ moderation events — the relay refused our message or cleaned one up */
    socket.on("chat:blocked", (p: { word?: string; strikes?: number; limit?: number }) => {
      pushNote(
        `Message blocked — the word filter caught it${p.word ? ` ("${p.word}")` : ""}. Strike ${p.strikes ?? 1}/${p.limit ?? 3} — 3 strikes in 10 minutes auto-mute 30 minutes.`,
        "block",
      );
    });
    socket.on("chat:muted", (p: { until: number; reason?: string }) => {
      setMuted({ until: p.until, reason: p.reason ?? "Chat restricted." });
      pushNote(`Chat restricted until ${new Date(p.until).toLocaleTimeString()} — ${p.reason ?? "by an admin"}.`, "mute");
    });
    socket.on("chat:banned", (p: { reason?: string }) => {
      setBanned(p.reason ?? "You are banned from chat.");
      pushNote(p.reason ?? "You are banned from chat.", "ban");
    });
    socket.on("chat:delete", (p: { id: string }) => {
      setChat((c) => c.filter((m) => m.id !== p.id));
    });

    return () => { socket.disconnect(); };
  }, []);

  /* the mute sentence counts down — the input frees the moment it expires */
  useEffect(() => {
    if (!muted) return;
    const t = setInterval(() => {
      if (Date.now() >= muted.until) setMuted(null);
    }, 1000);
    return () => clearInterval(t);
  }, [muted]);

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
    if (!msg || !socket?.connected || muted || banned) return;
    socket.emit("chat:send", { name: meRef.current, msg });
    setDraft("");
    sfx.click();
  };

  /** remaining mute time as "12m 30s" — for the restriction pill */
  const muteLeft = (() => {
    if (!muted) return "";
    const ms = Math.max(0, muted.until - Date.now());
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
  })();

  /* 📍 panel position follows the placement:
     • "rail" (desktop right-rail icon) → anchored to the ICON: the panel top
       sits a step BELOW the icon's top and the whole box is shifted LEFT of
       the rail column (right edge = icon's left edge − 10px), so the chat
       icon itself stays fully visible + clickable while the panel is open
     • "dock" (mobile footer icon) → anchored to its icon, opens UPWARD.
     ⚠ calc() values need the underscore spaces (`calc(100%_+_10px)`) — without
       them Tailwind emits invalid CSS and the anchor silently disappears. */
  const panelPos = placement === "rail"
    ? "absolute right-[calc(100%_+_10px)] top-7 z-40 w-[min(20rem,calc(100vw_-_2.5rem))]"
    : "absolute bottom-[calc(100%_+_10px)] right-0 z-40 w-[min(20rem,calc(100vw_-_2.5rem))]";

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
          DOWNWARD-LEFT of its icon (icon stays visible), dock opens UPWARD */}
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
            <div ref={scrollRef} aria-live="polite" className="lobby-scroll max-h-56 min-h-[3.5rem] space-y-1.5 overflow-y-auto p-2.5 lg:max-h-80">
              {chat.length === 0 && sysNotes.length === 0 ? (
                <p className="px-1 py-2 text-center text-[11px] font-bold text-white/40">
                  {connected ? "Say hello to the night…" : "Lighting the relay…"}
                </p>
              ) : (
                <>
                  {chat.map((m) => {
                    const mine = m.name === (name || "Guest");
                    return (
                      <div key={m.id} className="rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold leading-snug text-white/80">
                        <span className={m.name === "NightLine" ? "text-teal-300/90" : mine ? "text-yellow-300/90" : "text-orange-200/90"}>
                          {m.name}:
                        </span>{" "}
                        {m.msg}
                      </div>
                    );
                  })}
                  {sysNotes.map((n) => (
                    <div
                      key={n.id}
                      className={`rounded border px-2.5 py-1.5 text-[10px] font-bold leading-snug ${
                        n.kind === "block"
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                          : n.kind === "mute"
                            ? "border-orange-400/40 bg-orange-500/10 text-orange-200"
                            : "border-rose-400/40 bg-rose-500/10 text-rose-200"
                      }`}
                    >
                      {n.text}
                    </div>
                  ))}
                </>
              )}
            </div>
            {(muted || banned) && (
              <div className="border-t border-white/10 bg-rose-950/40 px-2.5 py-1.5 text-[10px] font-bold text-rose-200">
                {banned
                  ? banned
                  : `Chat restricted — ${muteLeft} left. ${muted?.reason ?? ""}`}
              </div>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex items-center gap-2 border-t border-white/10 bg-black/30 px-2.5 py-2"
            >
              <Input
                value={draft}
                disabled={!connected || !!muted || !!banned}
                onChange={(e) => setDraft(e.target.value.slice(0, 120))}
                placeholder={banned ? "Chat banned" : muted ? "Restricted — wait it out" : connected ? "Press Enter to chat…" : "Lighting the relay…"}
                aria-label="Global chat message"
                aria-disabled={!!muted || !!banned}
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
  /* the live season — synced from the cpanel-scheduled calendar on boot */
  const seasonId = useGame((s) => s.seasonId);
  const seasonNum = Number(seasonId.replace("s", "")) || 1;

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

  const hasProfile = playerName.trim().length > 0;
  const { rank } = rankFor(careerXp);

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

  /* roll the daily board at local midnight */
  useEffect(() => {
    const tick = () => { ensureDailyToday(); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [ensureDailyToday]);

  /* 🗓️ the cpanel-scheduled LIVE season drives the default match arena —
     every boot syncs it (the MatchLobby picker can still override a room) */
  useEffect(() => {
    fetch("/api/seasons")
      .then((r) => r.json())
      .then((d: { active?: { id?: string } | null }) => {
        const id = d?.active?.id;
        if (id && /^s\d+$/.test(id)) useGame.getState().setSeasonId(id);
      })
      .catch(() => {});
  }, []);

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

  /** left-rail icons — SEASON / SUGGESTED / DAILY are DEDICATED FULL PAGES
   *  now (the Item-Shop pattern): the icon navigates straight there */
  const openLobbyPage = (id: Screen) => {
    sfx.click();
    setTab("lobby");
    setScreen(id);
  };

  const doneCount = daily.tasks.filter((t) => t.done).length;

  /* the left rail — three full pages reachable from icons (badges live on them) */
  const lobbyPages: { id: Screen; label: string; icon: LucideIcon; badge?: string }[] = [
    { id: "season", label: "Season", icon: Crown, badge: `S${seasonNum}` },
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

      {/* ================= main: left rail + center stage ================= */}
      <main className="lobby-scroll relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3 pb-2 sm:px-3 lg:flex-row lg:overflow-hidden">
        {/* -------- left rail: Season / Suggested / Daily full-page links -------- */}
        <aside className="order-2 w-full shrink-0 lg:order-1 lg:w-14">
          <div role="tablist" aria-label="Lobby pages" className="flex flex-row gap-1.5 lg:mt-8 lg:flex-col">
            {lobbyPages.map((c) => {
              const RailIcon = c.icon;
              return (
                <button
                  key={c.id}
                  role="tab"
                  aria-label={`Open the ${c.label} page`}
                  title={`${c.label}${c.badge ? ` — ${c.badge}` : ""} — full page`}
                  onClick={() => openLobbyPage(c.id)}
                  className="relative flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-white/15 bg-slate-950/85 text-white/70 backdrop-blur transition-all hover:border-orange-400/60 hover:bg-slate-800/90 hover:text-white"
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
        </aside>

        {/* -------- center: the survivor stage --------
             Left and right rails are the same 56px width now, so a plain
             flex-1 stage sits dead-center — hero, name plate and rank pill
             all line up like the big-game lobbies. */}
        <section
          aria-label="Your survivor — drag to spin"
          className="relative order-1 h-[44vh] min-h-[300px] w-full lg:order-2 lg:h-auto lg:min-h-0 lg:flex-1"
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
