"use client";

/**
 * SeasonPage — the full-page 👑 SEASON HUB (the Item-Shop pattern).
 *
 * The LIVE season (scheduled by the game admin in /cpanel_app, served by
 * /api/seasons) owns the hero: themed gradient from the season palette,
 * start/end dates with a per-second END-IN countdown, the PLAY CTA that
 * queues the PUBG-style match lobby, the kit attribution and the named POI
 * drops of the 4×4 km arena. Below it, the full S1→S27 roadmap grid shows
 * every season as LIVE / NEXT UP / SCHEDULED / ARCHIVED with its window.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarRange, Clock, Crown, Flag, Lock, MapPin, Play, Sparkles, Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { SEASON_BY_ID } from "@/lib/game/seasons";
import { PageShell, Panel, Strip } from "./PageKit";

/* the season slot shape served by GET /api/seasons */
interface SeasonSlot {
  id: string;
  number: number;
  title: string;
  kit: string;
  tagline: string;
  startsAt: string;
  endsAt: string;
  live: boolean;
  past: boolean;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** per-second "ends in" text */
function useCountdown(target: string | null): string {
  const [text, setText] = useState("…");
  useEffect(() => {
    if (!target) return; // no window → the hook renders the fallback below
    const end = new Date(target).getTime();
    const tick = () => {
      const ms = end - Date.now();
      if (ms <= 0) { setText("ended"); return; }
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setText(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${String(s).padStart(2, "0")}s`);
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [target]);
  return target ? text : "—";
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function SeasonPage() {
  const quickPlay = useGame((s) => s.quickPlay);
  const seasonId = useGame((s) => s.seasonId);
  const setSeasonId = useGame((s) => s.setSeasonId);
  const careerXp = useGame((s) => s.careerXp);

  const [slots, setSlots] = useState<SeasonSlot[]>([]);
  const [active, setActive] = useState<SeasonSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/seasons")
      .then((r) => r.json())
      .then((d: { seasons?: SeasonSlot[]; active?: SeasonSlot | null }) => {
        setSlots(d.seasons ?? []);
        setActive(d.active ?? null);
        setLoading(false);
      })
      .catch(() => { setError("Could not reach the season calendar — retrying soon."); setLoading(false); });
  }, []);

  const live = active ?? slots.find((s) => s.live) ?? null;
  const countdown = useCountdown(live?.endsAt ?? null);
  const def = live ? SEASON_BY_ID[live.id] : null;
  const accent = def ? hex(def.pal.accent) : "#f97316";

  const play = () => {
    sfx.pickup();
    if (live) setSeasonId(live.id); // the arena follows the live season
    quickPlay?.();
  };

  /* grouped roadmap for the grid */
  const groups = useMemo(() => {
    const past = slots.filter((s) => s.past && !s.live);
    const future = slots.filter((s) => !s.past && !s.live);
    return { past, future };
  }, [slots]);

  const statusChip = (s: SeasonSlot) => {
    if (s.live) {
      return (
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-200 ring-1 ring-emerald-300/50">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          live now
        </span>
      );
    }
    if (s.past) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/55 ring-1 ring-white/20">
          archived
        </span>
      );
    }
    const nextUp = !live && s.number === (slots.find((x) => !x.past)?.number ?? -1);
    const msToStart = new Date(s.startsAt).getTime() - Date.now();
    if (nextUp || (live && msToStart < 30 * 86_400_000)) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-yellow-400/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-yellow-200 ring-1 ring-yellow-300/50">
          next up
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 rounded-full bg-sky-400/15 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-sky-200/90 ring-1 ring-sky-300/40">
        <Lock size={9} /> scheduled
      </span>
    );
  };

  return (
    <PageShell
      title={`SEASON ${live?.number ?? 1}`}
      emoji="👑"
      subtitle={live ? `${live.title} — the live 4×4 km arena, scheduled by the game admin` : "Season calendar — scheduled by the game admin"}
      screen="season"
    >
      {/* ---------- LIVE season hero ---------- */}
      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-white/10 bg-slate-950/70" />
      ) : error && !live ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-950/40 px-4 py-5 text-sm font-bold text-rose-200">
          {error}
        </div>
      ) : (
        live && (
          <motion.section
            key={live.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="relative overflow-hidden rounded-2xl border border-white/20 shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
          >
            {/* themed wash from the season palette */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: `linear-gradient(120deg, rgba(2,6,23,0.94) 8%, ${accent}38 55%, rgba(2,6,23,0.9) 100%)` }}
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: `radial-gradient(circle at 82% 18%, ${accent}55, transparent 52%)` }}
            />
            <div className="relative flex flex-col gap-5 p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200 ring-1 ring-emerald-300/50">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  season live
                </span>
                <span className="rounded-full bg-black/50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/25">
                  {fmtDate(live.startsAt)} — {fmtDate(live.endsAt)}
                </span>
                <span
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white ring-1 ring-white/30"
                  style={{ background: `${accent}44` }}
                >
                  <Clock size={11} /> ends in {countdown}
                </span>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <motion.span
                  aria-hidden
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-black/35 text-5xl ring-2 ring-white/25"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                  style={{ boxShadow: `0 0 34px ${accent}66` }}
                >
                  {live.number === 1 ? "🎄" : live.number === 2 ? "🎃" : "🌍"}
                </motion.span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-black uppercase leading-tight tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.45)] sm:text-4xl">
                    {live.title}
                  </h2>
                  <p className="mt-1.5 text-xs font-bold leading-relaxed text-white/80 sm:text-sm">
                    {live.tagline}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
                    polyfork kit · {live.kit} · a 4×4 km themed battle arena
                  </p>
                </div>
              </div>

              {/* arena fact strip */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: "4×4 km", v: "themed arena", icon: MapPin },
                  { k: "100", v: "souls per night", icon: Flag },
                  { k: "7", v: "nights to outlast", icon: Crown },
                  { k: String(def?.poiNames.length ?? 12), v: "named POI drops", icon: Sparkles },
                ].map((f) => (
                  <div key={f.v} className="rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 backdrop-blur">
                    <div className="flex items-center gap-1.5 text-lg font-black italic text-white">
                      <f.icon size={14} style={{ color: accent }} /> {f.k}
                    </div>
                    <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/55">{f.v}</div>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={play}
                  className="h-14 flex-1 rounded-xl text-lg font-black uppercase tracking-wide text-slate-950 shadow-[0_5px_0_rgba(0,0,0,0.35)] transition-all hover:brightness-110 active:translate-y-0.5"
                  style={{ background: accent }}
                  aria-label={`Play Season ${live.number} now`}
                >
                  <span className="flex items-center gap-2.5">
                    <Play size={20} fill="currentColor" /> Play Season {live.number}
                  </span>
                </Button>
                <Button
                  onClick={() => { sfx.click(); useGame.getState().setScreen("battlepass"); }}
                  className="h-14 rounded-xl bg-black/45 px-5 text-[11px] font-black uppercase tracking-wider text-white ring-1 ring-white/30 backdrop-blur hover:bg-black/65"
                  aria-label="Open the battle pass"
                >
                  <span className="flex items-center gap-2">
                    <Trophy size={16} className="text-yellow-300" /> Season pass · rank rewards
                  </span>
                </Button>
              </div>
            </div>
          </motion.section>
        )
      )}

      {/* ---------- POI drop list ---------- */}
      {live && def && (
        <Panel>
          <Strip right={<span className="text-[10px] font-black text-white/85">capital drop first</span>}>
            Named POIs — Season {live.number}
          </Strip>
          <div className="flex flex-wrap gap-1.5 p-3">
            {def.poiNames.map((poi, i) => (
              <span
                key={poi}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ring-1 ${
                  i === 0
                    ? "bg-yellow-400/20 text-yellow-200 ring-yellow-300/50"
                    : "bg-white/5 text-white/70 ring-white/15"
                }`}
              >
                <MapPin size={10} className={i === 0 ? "text-yellow-300" : "text-white/40"} />
                {poi}
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* ---------- roadmap ---------- */}
      <Panel>
        <Strip right={<span className="text-[10px] font-black text-white/85">{slots.length} seasons planned</span>}>
          Season roadmap — S1 → S27
        </Strip>
        <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-white/5" />
            ))}
          {!loading && slots.map((s, i) => {
            const sDef = SEASON_BY_ID[s.id];
            const a = sDef ? hex(sDef.pal.accent) : "#f97316";
            const emoji = s.number === 1 ? "🎄" : s.number === 2 ? "🎃" : sDef?.foliage[0] === "palm" ? "🏝️" : sDef?.foliage[0] === "cactus" ? "🏜️" : sDef?.foliage[0] === "sakura" ? "🌸" : sDef?.pal.snow ? "❄️" : "🌍";
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, delay: Math.min(0.2, i * 0.02) }}
                className={`relative overflow-hidden rounded-xl border p-3 transition-colors ${
                  s.live
                    ? "border-emerald-300/50 bg-emerald-400/10"
                    : s.past
                      ? "border-white/10 bg-slate-950/60 opacity-60"
                      : "border-white/12 bg-slate-950/80 hover:border-white/25"
                }`}
              >
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: a, opacity: s.past ? 0.3 : 0.9 }}
                />
                <div className="flex items-start gap-2.5 pl-2">
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/40 text-xl ring-1 ring-white/15"
                  >
                    {emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-black text-white"
                        style={{ background: `${a}55`, boxShadow: `0 0 10px ${a}44` }}
                      >
                        S{s.number}
                      </span>
                      {statusChip(s)}
                    </div>
                    <div className="mt-1 truncate text-xs font-black uppercase tracking-wide text-white/90">
                      {s.title}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[10px] font-bold text-white/55">{s.tagline}</div>
                    <div className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/40">
                      <CalendarRange size={9} /> {fmtDate(s.startsAt)} — {fmtDate(s.endsAt)}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Panel>

      {/* ---------- how seasons work + groups ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <Strip>How the season wheel turns</Strip>
          <div className="space-y-1.5 p-3 text-[11px] font-bold leading-relaxed text-white/70">
            <p>
              <b className="text-white/90">The live season</b> — whichever window covers right now is the arena every
              fresh match boots on. The game admin schedules each window in the control panel; players follow
              automatically.
            </p>
            <p>
              <b className="text-white/90">Host override</b> — a multiplayer host can still pick any unlocked arena for
              a private room from the match lobby; the live season stays the public default.
            </p>
            <p>
              <b className="text-white/90">Archived seasons</b> — windows in the past keep their page in the roadmap;
              their worlds return when the admin re-schedules them.
            </p>
            <p>
              <b className="text-white/90">Season pass</b> — career XP climbs the rank ladder every season; premium
              track rewards sit in the battle pass.
            </p>
          </div>
        </Panel>
        <Panel>
          <Strip right={<span className="text-[10px] font-black text-white/85">career XP {careerXp.toLocaleString()}</span>}>
            Your season standing
          </Strip>
          <div className="space-y-2.5 p-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { k: groups.past.length, v: "archived" },
                { k: slots.filter((s) => s.live).length, v: "live now" },
                { k: groups.future.length, v: "scheduled" },
              ].map((g) => (
                <div key={g.v} className="rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-center backdrop-blur">
                  <div className="text-xl font-black italic text-white">{g.k}</div>
                  <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/50">{g.v}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => { sfx.click(); useGame.getState().setScreen("challenges"); }}
              className="flex w-full items-center gap-2.5 rounded-xl border border-white/12 bg-white/5 px-3.5 py-3 text-left transition-colors hover:border-yellow-300/40 hover:bg-white/10"
              aria-label="Open season challenges"
            >
              <Trophy size={18} className="shrink-0 text-yellow-300" />
              <span className="min-w-0 flex-1 text-[11px] font-bold text-white/85">
                Season quests pay once per season — claim what you have earned
              </span>
            </button>
            <button
              onClick={() => { sfx.click(); useGame.getState().setScreen("suggested"); }}
              className="flex w-full items-center gap-2.5 rounded-xl border border-white/12 bg-white/5 px-3.5 py-3 text-left transition-colors hover:border-teal-300/40 hover:bg-white/10"
              aria-label="Open suggested picks"
            >
              <Sparkles size={18} className="shrink-0 text-teal-300" />
              <span className="min-w-0 flex-1 text-[11px] font-bold text-white/85">
                Not sure where to drop? Suggested picks match tonight to your survivor
              </span>
            </button>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
