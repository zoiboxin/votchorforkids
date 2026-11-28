"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Ban,
  Flag,
  Ghost,
  Mic,
  MicOff,
  MoreHorizontal,
  Search,
  ShieldCheck,
  StickyNote,
} from "lucide-react";

import { api, fmtNum, relTime } from "./api";
import type { Player, PlayerActionPayload } from "./types";
import {
  ErrorBanner,
  PANEL,
  SCROLLBAR,
  SkeletonRows,
  ToneBadge,
} from "./shared";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface PlayersTabProps {
  refreshTick: number;
}

type ConfirmKind = "unban" | "mute24" | "unmute" | "clearflags";
type DialogKind = "ban" | "notes";

const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: string; description: string; actionLabel: string; destructive?: boolean }
> = {
  unban: {
    title: "Lift this ban?",
    description:
      "The player will be able to join runs and appear on the leaderboard again immediately.",
    actionLabel: "Unban player",
  },
  mute24: {
    title: "Mute chat for 24 hours?",
    description:
      "The player will not be able to post in NightLine chat for the next 24 hours.",
    actionLabel: "Mute 24h",
    destructive: true,
  },
  unmute: {
    title: "Remove chat mute?",
    description: "The player can post in NightLine chat again immediately.",
    actionLabel: "Unmute player",
  },
  clearflags: {
    title: "Clear all flags?",
    description:
      "Every flagged-message strike on this profile will be reset. Strike-based auto-mutes stay untouched.",
    actionLabel: "Clear flags",
  },
};

export function PlayersTab({ refreshTick }: PlayersTabProps) {
  const { toast } = useToast();

  const [input, setInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [total, setTotal] = React.useState(0);
  const [players, setPlayers] = React.useState<Player[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  // Dialogs
  const [dialogKind, setDialogKind] = React.useState<DialogKind | null>(null);
  const [dialogPlayer, setDialogPlayer] = React.useState<Player | null>(null);
  const [banReason, setBanReason] = React.useState("");
  const [notesText, setNotesText] = React.useState("");
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [confirmKind, setConfirmKind] = React.useState<ConfirmKind | null>(null);
  const [confirmPlayer, setConfirmPlayer] = React.useState<Player | null>(null);

  // Debounced search → refetch with ?q=
  React.useEffect(() => {
    const t = window.setTimeout(() => setQ(input.trim()), 350);
    return () => window.clearTimeout(t);
  }, [input]);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const d = await api.getPlayers(q || undefined);
      setPlayers(d.players);
      setTotal(d.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load players.");
    } finally {
      setLoading(false);
    }
  }, [q]);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Keep relative "last seen" labels fresh.
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  function openDialog(kind: DialogKind, p: Player) {
    setDialogPlayer(p);
    setDialogKind(kind);
    setDialogError(null);
    if (kind === "ban") setBanReason("");
    if (kind === "notes") setNotesText(p.notes ?? "");
  }

  function openConfirm(kind: ConfirmKind, p: Player) {
    setConfirmPlayer(p);
    setConfirmKind(kind);
  }

  function closeDialogs() {
    setDialogKind(null);
    setDialogPlayer(null);
    setConfirmKind(null);
    setConfirmPlayer(null);
    setDialogError(null);
  }

  async function executePlayerAction(payload: PlayerActionPayload, successTitle: string) {
    setPending(payload.action);
    try {
      await api.playerAction(payload);
      toast({ title: successTitle, description: payload.name });
      await load();
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  }

  async function handleConfirm() {
    if (!confirmKind || !confirmPlayer) return;
    const p = confirmPlayer;
    const map: Record<ConfirmKind, { payload: PlayerActionPayload; title: string }> = {
      unban: { payload: { action: "unban", name: p.name }, title: "Ban lifted" },
      mute24: {
        payload: { action: "mute", name: p.name, hours: 24 },
        title: "Chat muted for 24h",
      },
      unmute: { payload: { action: "unmute", name: p.name }, title: "Chat unmuted" },
      clearflags: { payload: { action: "clearflags", name: p.name }, title: "Flags cleared" },
    };
    const { payload, title } = map[confirmKind];
    closeDialogs();
    await executePlayerAction(payload, title);
  }

  async function submitBan() {
    if (!dialogPlayer) return;
    const p = dialogPlayer;
    setDialogError(null);
    setPending("ban");
    try {
      await api.playerAction({
        action: "ban",
        name: p.name,
        reason: banReason.trim() || undefined,
      });
      toast({ title: "Player banned", description: p.name });
      closeDialogs();
      await load();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Ban failed.");
    } finally {
      setPending(null);
    }
  }

  async function submitNotes() {
    if (!dialogPlayer) return;
    const p = dialogPlayer;
    setDialogError(null);
    setPending("notes");
    try {
      await api.playerAction({ action: "notes", name: p.name, notes: notesText.trim() });
      toast({ title: "Note saved", description: p.name });
      closeDialogs();
      await load();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Saving note failed.");
    } finally {
      setPending(null);
    }
  }

  const showSkeleton = loading && !players;
  const empty = !showSkeleton && !error && (players?.length ?? 0) === 0;
  const confirmCopy = confirmKind ? CONFIRM_COPY[confirmKind] : null;
  const confirmName = confirmPlayer?.name ?? "";

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search players by name…"
            aria-label="Search players"
            className="border-white/10 bg-slate-950/60 pl-9 text-slate-100 placeholder:text-slate-600"
          />
        </div>
        <p className="text-xs text-slate-500" aria-live="polite">
          Showing {fmtNum(players?.length ?? 0)} of {fmtNum(total)} players
          {q ? ` · filtered by “${q}”` : ""}
        </p>
      </motion.div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {showSkeleton ? (
        <div className={PANEL} aria-busy="true">
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        </div>
      ) : empty ? (
        <div className={PANEL}>
          <EmptyPlayers q={q} />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        >
          <div className={`${PANEL} overflow-hidden`}>
            <div className={`max-h-[34rem] overflow-auto ${SCROLLBAR}`}>
              <Table className="min-w-[62rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="sticky top-0 z-10 min-w-[12rem] bg-slate-900">Player</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-900 text-right">XP</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-900 text-right">Coins</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-900 text-right">Wins</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-900 text-right">Games</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-900 text-right">Best</TableHead>
                    <TableHead className="sticky top-0 z-10 w-24 bg-slate-900">Flags</TableHead>
                    <TableHead className="sticky top-0 z-10 w-32 bg-slate-900">Status</TableHead>
                    <TableHead className="sticky top-0 z-10 w-24 bg-slate-900">Last seen</TableHead>
                    <TableHead className="sticky top-0 z-10 w-12 bg-slate-900">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(players ?? []).map((p) => {
                    const busy = pending !== null;
                    return (
                      <TableRow
                        key={p.name}
                        className={
                          p.banned ? "bg-red-950/30 hover:bg-red-950/40" : undefined
                        }
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <p
                              className="truncate text-sm font-semibold text-slate-200"
                              title={p.name}
                            >
                              {p.name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {p.synced ? (
                                <ToneBadge tone="green">cloud-synced</ToneBadge>
                              ) : (
                                <ToneBadge tone="slate">leaderboard-only</ToneBadge>
                              )}
                              {p.notes ? (
                                <span
                                  className="max-w-[14rem] truncate text-xs italic text-slate-500"
                                  title={p.notes}
                                >
                                  “{p.notes}”
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-300">
                          {fmtNum(p.xp)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-300">
                          {fmtNum(p.coins)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-300">
                          {fmtNum(p.wins)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-300">
                          {fmtNum(p.games)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-300">
                          {fmtNum(p.bestPoints)}
                        </TableCell>
                        <TableCell>
                          {p.flaggedCount > 0 ? (
                            <ToneBadge tone="red" title={`${p.flaggedCount} flagged messages`}>
                              <Flag className="size-3" aria-hidden="true" />
                              {p.flaggedCount}
                            </ToneBadge>
                          ) : (
                            <ToneBadge tone="slate">0</ToneBadge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            {p.banned ? (
                              <ToneBadge tone="red" title={p.banReason ?? undefined}>
                                BANNED
                              </ToneBadge>
                            ) : null}
                            {p.muted ? (
                              <ToneBadge tone="amber" title="Chat muted">
                                MUTED · {relTime(p.muteUntil, now)}
                              </ToneBadge>
                            ) : null}
                            {!p.banned && !p.muted ? (
                              <span className="text-xs text-slate-500">—</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {relTime(p.lastPlayedAt, now)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                aria-label={`Actions for ${p.name}`}
                              >
                                <MoreHorizontal className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuLabel className="text-xs text-slate-400">
                                {p.name}
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {!p.banned ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => openDialog("ban", p)}
                                >
                                  <Ban aria-hidden="true" />
                                  Ban…
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => openConfirm("unban", p)}>
                                  <ShieldCheck aria-hidden="true" />
                                  Unban
                                </DropdownMenuItem>
                              )}
                              {!p.muted ? (
                                <DropdownMenuItem onClick={() => openConfirm("mute24", p)}>
                                  <MicOff aria-hidden="true" />
                                  Mute chat 24h
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => openConfirm("unmute", p)}>
                                  <Mic aria-hidden="true" />
                                  Unmute chat
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openDialog("notes", p)}>
                                <StickyNote aria-hidden="true" />
                                Add note…
                              </DropdownMenuItem>
                              {p.flaggedCount > 0 ? (
                                <DropdownMenuItem onClick={() => openConfirm("clearflags", p)}>
                                  <Flag aria-hidden="true" />
                                  Clear flags
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </motion.div>
      )}

      {/* Ban / Notes dialog */}
      <Dialog
        open={dialogKind !== null}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
      >
        <DialogContent className="border-white/10 bg-slate-900 text-slate-200 sm:max-w-md">
          {dialogKind === "ban" && dialogPlayer ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-400">
                  Ban {dialogPlayer.name}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  Banned players cannot join runs, sync profiles or hold leaderboard
                  entries. You can lift the ban at any time.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="ban-reason" className="text-slate-300">
                  Reason (shown internally, optional)
                </Label>
                <Textarea
                  id="ban-reason"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="e.g. repeated cheating reports"
                  rows={3}
                  className="border-white/10 bg-slate-950/60 text-slate-100 placeholder:text-slate-600"
                />
              </div>
              {dialogError ? (
                <p role="alert" className="text-sm text-red-400">
                  {dialogError}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={closeDialogs} className="border-white/10 bg-transparent">
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void submitBan()}
                  disabled={pending === "ban"}
                >
                  <Ban aria-hidden="true" />
                  {pending === "ban" ? "Banning…" : "Ban player"}
                </Button>
              </DialogFooter>
            </>
          ) : dialogKind === "notes" && dialogPlayer ? (
            <>
              <DialogHeader>
                <DialogTitle>Note for {dialogPlayer.name}</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Moderator-only remarks kept on the player profile.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="player-notes" className="text-slate-300">
                  Notes
                </Label>
                <Textarea
                  id="player-notes"
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="e.g. appealed a ban on 2024-11-02 — verified manually"
                  rows={4}
                  className="border-white/10 bg-slate-950/60 text-slate-100 placeholder:text-slate-600"
                />
              </div>
              {dialogError ? (
                <p role="alert" className="text-sm text-red-400">
                  {dialogError}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={closeDialogs} className="border-white/10 bg-transparent">
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitNotes()}
                  disabled={pending === "notes"}
                  className="bg-orange-500 text-white hover:bg-orange-600"
                >
                  <StickyNote aria-hidden="true" />
                  {pending === "notes" ? "Saving…" : "Save note"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirmation dialogs */}
      <AlertDialog
        open={confirmKind !== null}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
      >
        <AlertDialogContent className="border-white/10 bg-slate-900 text-slate-200 sm:max-w-md">
          {confirmCopy ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  {confirmName ? `Player: ${confirmName}. ` : ""}
                  {confirmCopy.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/10 bg-transparent">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void handleConfirm()}
                  className={
                    confirmCopy.destructive
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-orange-500 text-white hover:bg-orange-600"
                  }
                >
                  {confirmCopy.actionLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyPlayers({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5"
      >
        <Ghost className="size-6 text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300">No players found</p>
      <p className="max-w-sm text-xs text-slate-500">
        {q
          ? `Nothing matches “${q}”. Names are matched case-insensitively — try a shorter term.`
          : "No profiles exist yet. Players appear here after their first run."}
      </p>
    </div>
  );
}
