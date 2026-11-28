"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Ban,
  CalendarRange,
  Flag,
  MessageSquare,
  MicOff,
  Radio,
  ShieldBan,
  Timer,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";

import { api, fmtCountdown, fmtDateTime, fmtNum } from "./api";
import type { SectionId, Stats } from "./types";
import {
  ErrorBanner,
  PANEL,
  SkeletonCards,
  SkeletonRows,
  StatCard,
  StatusDot,
} from "./shared";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

interface DashboardTabProps {
  refreshTick: number;
  onNavigate: (section: SectionId) => void;
}

const SEASON_PROGRESS_CLS =
  "h-1.5 bg-white/10 [&>[data-slot=progress-indicator]]:bg-orange-500";

function SeasonProgress({ startsAt, endsAt, now }: { startsAt: string; endsAt: string; now: number }) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return <Progress value={0} className={SEASON_PROGRESS_CLS} aria-label="Season progress" />;
  }
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  return (
    <Progress
      value={pct}
      className={SEASON_PROGRESS_CLS}
      aria-label="Season progress"
    />
  );
}

export function DashboardTab({ refreshTick, onNavigate }: DashboardTabProps) {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const d = await api.getStats();
      setStats(d.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Ticking clock for the live-season countdown.
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const season = stats?.season ?? null;
  const chat = stats?.chat;
  const relayOk = chat?.relay === true;
  const endMs = season ? Date.parse(season.endsAt) : NaN;
  const remaining = Number.isFinite(endMs) ? endMs - now : 0;
  const seasonStartMs = season ? Date.parse(season.startsAt) : NaN;
  const seasonSpan = season ? endMs - seasonStartMs : 0;
  const elapsedPct =
    Number.isFinite(seasonStartMs) && seasonSpan > 0
      ? Math.round(Math.min(100, Math.max(0, ((now - seasonStartMs) / seasonSpan) * 100)))
      : 0;

  if (loading && !stats) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SkeletonCards count={8} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="h-56 rounded-xl bg-white/5" aria-hidden="true" />
          <div className="h-56 rounded-xl bg-white/5" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {/* Stat cards */}
      <motion.section
        aria-label="Key statistics"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4"
      >
        <StatCard
          icon={Users}
          label="Players"
          value={fmtNum(stats?.players)}
          caption="registered survivors"
        />
        <StatCard
          icon={Ban}
          label="Banned"
          value={fmtNum(stats?.banned)}
          caption="account bans active"
          tone="red"
        />
        <StatCard
          icon={MicOff}
          label="Chat Muted"
          value={fmtNum(stats?.muted)}
          caption="voice/chat restrictions"
          tone="amber"
        />
        <StatCard
          icon={Trophy}
          label="Leaderboard Scores"
          value={fmtNum(stats?.scores)}
          caption="scored runs all-time"
        />
        <StatCard
          icon={TrendingUp}
          label="Scores 24h"
          value={fmtNum(stats?.scoresToday)}
          caption={
            stats && stats.scores > 0
              ? `${Math.round((stats.scoresToday / stats.scores) * 100)}% of all-time`
              : "last 24 hours"
          }
        />
        <StatCard
          icon={MessageSquare}
          label="Chat msgs 24h"
          value={chat?.messages24h !== null && chat?.messages24h !== undefined ? fmtNum(chat.messages24h) : "—"}
          caption="NightLine volume"
        />
        <StatCard
          icon={Flag}
          label="Flagged 24h"
          value={chat?.flagged24h !== null && chat?.flagged24h !== undefined ? fmtNum(chat.flagged24h) : "—"}
          caption={
            chat && chat.flagged24h !== null && chat.flagged24h > 0
              ? "needs review"
              : "last 24 hours"
          }
          tone={
            chat && chat.flagged24h !== null && chat.flagged24h > 0 ? "red" : "orange"
          }
        />
        <StatCard
          icon={ShieldBan}
          label="Filter Words"
          value={chat?.words !== null && chat?.words !== undefined ? fmtNum(chat.words) : "—"}
          caption="active filter rules"
        />
      </motion.section>

      {/* Live season + relay */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <motion.section
          aria-label="Live season"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        >
          {season ? (
            <div
              className={PANEL}
              style={{
                background:
                  "linear-gradient(135deg, rgba(249,115,22,0.14), rgba(15,23,42,0.6) 45%, rgba(15,23,42,0.6))",
              }}
            >
              <div className="flex flex-col gap-6 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-400">
                        LIVE SEASON
                      </span>
                      <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-slate-300">
                        S{season.number}
                      </span>
                    </div>
                    <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-100">
                      {season.title}
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">{season.tagline}</p>
                  </div>

                  <div className="text-right">
                    <p className="flex items-center justify-end gap-1.5 text-[11px] font-medium uppercase tracking-widest text-slate-500">
                      <Timer className="size-3.5" aria-hidden="true" />
                      Ends in
                    </p>
                    <p
                      className="mt-1 font-mono text-3xl font-bold tabular-nums text-orange-400"
                      role="timer"
                      aria-label="Time until season ends"
                    >
                      {fmtCountdown(remaining)}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <SeasonProgress startsAt={season.startsAt} endsAt={season.endsAt} now={now} />
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarRange className="size-3.5 text-slate-500" aria-hidden="true" />
                      {fmtDateTime(season.startsAt)}
                      <span className="text-slate-600">→</span>
                      {fmtDateTime(season.endsAt)}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {elapsedPct}% elapsed
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={PANEL}
              style={{ borderStyle: "dashed" }}
            >
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <div
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5"
                >
                  <CalendarRange className="size-6 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-300">No live season right now</p>
                  <p className="mt-1 text-xs text-slate-500">
                    The game is running outside any scheduled window. Set a date range that covers
                    the current time to put a season live instantly.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="bg-orange-500 text-white hover:bg-orange-600"
                  onClick={() => onNavigate("seasons")}
                >
                  <CalendarRange className="size-4" aria-hidden="true" />
                  Go to Seasons
                </Button>
              </div>
            </div>
          )}
        </motion.section>

        {/* Relay status */}
        <motion.section
          aria-label="NightLine relay status"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
        >
          <div className={PANEL}>
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Radio className="size-4 text-orange-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-200">NightLine relay</h2>
                </div>
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300"
                  role="status"
                >
                  <StatusDot ok={relayOk} />
                  {relayOk ? "Reachable" : "Unreachable"}
                </span>
              </div>

              <Separator className="bg-white/10" />

              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">
                    Online souls
                  </dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-slate-100">
                    {chat?.online !== null && chat?.online !== undefined ? fmtNum(chat.online) : "—"}
                  </dd>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">
                    Filter words
                  </dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-slate-100">
                    {chat?.words !== null && chat?.words !== undefined ? fmtNum(chat.words) : "—"}
                  </dd>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">
                    Muted chatters
                  </dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-slate-100">
                    {chat?.mutedCount !== null && chat?.mutedCount !== undefined
                      ? fmtNum(chat.mutedCount)
                      : "—"}
                  </dd>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">
                    Chat-banned
                  </dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-slate-100">
                    {chat?.chatBannedCount !== null && chat?.chatBannedCount !== undefined
                      ? fmtNum(chat.chatBannedCount)
                      : "—"}
                  </dd>
                </div>
              </dl>

              {stats ? (
                <p className="text-[11px] text-slate-500">
                  Generated {fmtDateTime(stats.generatedAt)}
                </p>
              ) : null}
            </div>
          </div>
        </motion.section>
      </div>

      {loading && stats ? (
        <p className="text-xs text-slate-500" role="status" aria-live="polite">
          Refreshing…
        </p>
      ) : null}
    </div>
  );
}
