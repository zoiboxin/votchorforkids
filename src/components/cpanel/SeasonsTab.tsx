"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Info,
  Save,
} from "lucide-react";

import {
  addDaysToLocalInput,
  api,
  fmtDateTime,
  isoToLocalInput,
  localInputToIso,
  nowLocalInput,
} from "./api";
import type { Season } from "./types";
import { ErrorBanner, InfoBanner, PANEL, SCROLLBAR, SkeletonRows, ToneBadge } from "./shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SeasonsTabProps {
  refreshTick: number;
}

type RowDraft = { start: string; end: string };

function statusBadge(s: Season): React.ReactNode {
  if (s.live) return <ToneBadge tone="green">LIVE</ToneBadge>;
  if (s.past) return <ToneBadge tone="slate">PAST</ToneBadge>;
  return <ToneBadge tone="amber">SCHEDULED</ToneBadge>;
}

export function SeasonsTab({ refreshTick }: SeasonsTabProps) {
  const [seasons, setSeasons] = React.useState<Season[] | null>(null);
  const [rows, setRows] = React.useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [flashId, setFlashId] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string | null>>({});
  const flashTimer = React.useRef<number | null>(null);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const d = await api.getSeasons();
      const sorted = [...d.seasons].sort((a, b) => a.number - b.number);
      setSeasons(sorted);
      setRows((prev) => {
        const next: Record<string, RowDraft> = { ...prev };
        for (const s of sorted) {
          if (!next[s.id]) {
            next[s.id] = {
              start: isoToLocalInput(s.startsAt),
              end: isoToLocalInput(s.endsAt),
            };
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load seasons.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Clear the per-row "Saved" flash when leaving the tab.
  React.useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  function isDirty(s: Season): boolean {
    const draft = rows[s.id];
    if (!draft) return false;
    return (
      draft.start !== isoToLocalInput(s.startsAt) ||
      draft.end !== isoToLocalInput(s.endsAt)
    );
  }

  function applyPreset(s: Season) {
    const start = nowLocalInput();
    setRows((prev) => ({
      ...prev,
      [s.id]: { start, end: addDaysToLocalInput(start, 28) },
    }));
    setRowErrors((prev) => ({ ...prev, [s.id]: null }));
  }

  async function save(s: Season) {
    const draft = rows[s.id];
    if (!draft) return;
    const startsAt = localInputToIso(draft.start);
    const endsAt = localInputToIso(draft.end);
    if (!startsAt || !endsAt) {
      setRowErrors((prev) => ({ ...prev, [s.id]: "Both start and end dates are required." }));
      return;
    }
    if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
      setRowErrors((prev) => ({ ...prev, [s.id]: "End must be after start." }));
      return;
    }
    setSavingId(s.id);
    setRowErrors((prev) => ({ ...prev, [s.id]: null }));
    try {
      await api.saveSeason(s.id, startsAt, endsAt);
      setSeasons((prev) =>
        prev
          ? prev.map((row) =>
              row.id === s.id ? { ...row, startsAt, endsAt } : row
            )
          : prev
      );
      setFlashId(s.id);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashId(null), 2600);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [s.id]: err instanceof Error ? err.message : "Save failed.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  if (loading && !seasons) {
    return (
      <div className={PANEL} aria-busy="true">
        <div className="p-4">
          <SkeletonRows rows={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <InfoBanner icon={Info} tone="amber" title="Live scheduling">
          <p>
            The season whose date window covers the current time is LIVE in the game instantly.
            Editing dates takes effect immediately — no restart needed.
          </p>
        </InfoBanner>
      </motion.div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className={`${PANEL} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-orange-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-200">Season calendar</h2>
            </div>
            <p className="text-xs text-slate-500">
              {seasons?.length ?? 0} seasons · times are local to this machine
            </p>
          </div>

          <div className={`max-h-[36rem] overflow-y-auto ${SCROLLBAR}`}>
            <Table className="min-w-[62rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky top-0 z-10 w-16 bg-slate-900">Season</TableHead>
                  <TableHead className="sticky top-0 z-10 min-w-[13rem] bg-slate-900">Title</TableHead>
                  <TableHead className="sticky top-0 z-10 w-28 bg-slate-900">Kit</TableHead>
                  <TableHead className="sticky top-0 z-10 w-28 bg-slate-900">Status</TableHead>
                  <TableHead className="sticky top-0 z-10 w-48 bg-slate-900">Starts at</TableHead>
                  <TableHead className="sticky top-0 z-10 w-48 bg-slate-900">Ends at</TableHead>
                  <TableHead className="sticky top-0 z-10 w-44 bg-slate-900 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(seasons ?? []).map((s) => {
                  const draft = rows[s.id] ?? { start: "", end: "" };
                  const dirty = isDirty(s);
                  const rowError = rowErrors[s.id] ?? null;
                  return (
                    <TableRow
                      key={s.id}
                      className={
                        s.live ? "border-l-2 border-l-emerald-500/60 bg-emerald-500/[0.04]" : undefined
                      }
                    >
                      <TableCell>
                        <span className="inline-flex h-7 min-w-9 items-center justify-center rounded-md border border-orange-500/30 bg-orange-500/10 px-1.5 font-mono text-xs font-semibold text-orange-400">
                          S{s.number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-200" title={s.title}>
                            {s.title}
                          </p>
                          <p className="truncate text-xs text-slate-500" title={s.tagline}>
                            {s.tagline}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-slate-400" title={s.kit}>
                          {s.kit}
                        </span>
                      </TableCell>
                      <TableCell>{statusBadge(s)}</TableCell>
                      <TableCell>
                        <Input
                          type="datetime-local"
                          value={draft.start}
                          onChange={(e) =>
                            setRows((prev) => ({
                              ...prev,
                              [s.id]: { ...prev[s.id], start: e.target.value },
                            }))
                          }
                          disabled={savingId === s.id}
                          aria-label={`Start date for Season ${s.number}`}
                          className="h-8 w-[13rem] border-white/10 bg-slate-950/50 text-xs text-slate-200"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="datetime-local"
                          value={draft.end}
                          onChange={(e) =>
                            setRows((prev) => ({
                              ...prev,
                              [s.id]: { ...prev[s.id], end: e.target.value },
                            }))
                          }
                          disabled={savingId === s.id}
                          aria-label={`End date for Season ${s.number}`}
                          className="h-8 w-[13rem] border-white/10 bg-slate-950/50 text-xs text-slate-200"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          {flashId === s.id ? (
                            <span
                              role="status"
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400"
                            >
                              <CheckCircle2 className="size-3.5" aria-hidden="true" />
                              Saved
                            </span>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => applyPreset(s)}
                            disabled={savingId === s.id}
                            aria-label={`Fill season ${s.number} with start today plus 28 days`}
                            title="Start today (+28 days)"
                            className="text-slate-400 hover:text-orange-400"
                          >
                            <CalendarPlus className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void save(s)}
                            disabled={!dirty || savingId === s.id}
                            className="bg-orange-500 text-white hover:bg-orange-600"
                          >
                            <Save className="size-4" aria-hidden="true" />
                            {savingId === s.id ? "Saving…" : "Save"}
                          </Button>
                        </div>
                        {rowError ? (
                          <p className="mt-1 text-right text-xs text-red-400" role="alert">
                            {rowError}
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </motion.div>

      <p className="text-xs text-slate-500">
        Tip: the calendar-plus button fills {fmtDateTime(new Date().toISOString())} as start and end
        28 days later. Only rows with unsaved changes enable the Save button.
      </p>
    </div>
  );
}
