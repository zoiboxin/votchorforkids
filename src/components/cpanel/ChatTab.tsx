"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Flag,
  Megaphone,
  MessagesSquare,
  Mic,
  MicOff,
  MoreVertical,
  Send,
  ShieldOff,
  Trash2,
  UserX,
} from "lucide-react";

import { api, fmtClock, relTime } from "./api";
import type {
  ChatBannedEntry,
  ChatMessage,
  ChatModPayload,
  ChatState,
  MutedEntry,
} from "./types";
import { ErrorBanner, PANEL, SCROLLBAR, SkeletonRows, ToneBadge } from "./shared";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChatTabProps {
  refreshTick: number;
}

const POLL_INTERVAL_MS = 5000;

export function ChatTab({ refreshTick }: ChatTabProps) {
  const { toast } = useToast();

  const [messages, setMessages] = React.useState<ChatMessage[] | null>(null);
  const [chatState, setChatState] = React.useState<ChatState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [pendingName, setPendingName] = React.useState<string | null>(null);
  const [broadcast, setBroadcast] = React.useState("");
  const [broadcasting, setBroadcasting] = React.useState(false);

  const load = React.useCallback(async () => {
    // Pause while the tab is hidden — resume on visibilitychange.
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      setError(null);
      const d = await api.getChat(150);
      setMessages(d.messages);
      setChatState(d.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, refreshTick]);

  // Keep relative timestamps fresh.
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const mutedNames = React.useMemo(() => {
    const set = new Set<string>();
    for (const m of chatState?.muted ?? []) {
      if (m.until > now) set.add(m.name);
    }
    return set;
  }, [chatState, now]);

  const bannedNames = React.useMemo(() => {
    return new Set((chatState?.chatBanned ?? []).map((b) => b.name));
  }, [chatState]);

  const shown = React.useMemo(() => {
    const list = flaggedOnly
      ? (messages ?? []).filter((m) => m.flagged)
      : (messages ?? []);
    return [...list].sort((a, b) => b.ts - a.ts);
  }, [messages, flaggedOnly]);

  async function runChatMod(payload: ChatModPayload, title: string) {
    if (payload.name) setPendingName(payload.name);
    try {
      await api.chatMod(payload);
      toast({ title, description: payload.name ?? undefined });
      await load();
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingName(null);
    }
  }

  async function handleBroadcast() {
    const message = broadcast.trim();
    if (!message || broadcasting) return;
    setBroadcasting(true);
    try {
      await api.chatMod({ action: "broadcast", message } satisfies ChatModPayload);
      toast({ title: "Announcement sent", description: message.slice(0, 80) });
      setBroadcast("");
      await load();
    } catch (err) {
      toast({
        title: "Broadcast failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBroadcasting(false);
    }
  }

  async function deleteMessage(m: ChatMessage) {
    setDeletingId(m.id);
    try {
      await api.deleteChatMessage(m.id);
      toast({ title: "Message removed", description: `${m.name}: ${m.msg.slice(0, 60)}` });
      await load();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2" aria-live="polite">
            <MessagesSquare className="size-4 text-orange-400" aria-hidden="true" />
            <p className="text-sm text-slate-300">
              {chatState ? (
                <>
                  <span className="font-semibold tabular-nums text-slate-100">
                    {chatState.online}
                  </span>{" "}
                  souls online ·{" "}
                  <span className="font-semibold tabular-nums text-slate-100">
                    {messages?.length ?? 0}
                  </span>{" "}
                  recent messages
                </>
              ) : (
                "Connecting to relay…"
              )}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-emerald-400"
            />
            auto-refresh 5s
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="flagged-only"
            checked={flaggedOnly}
            onCheckedChange={setFlaggedOnly}
            aria-label="Show flagged messages only"
          />
          <Label htmlFor="flagged-only" className="cursor-pointer text-sm text-slate-300">
            Flagged only
          </Label>
        </div>
      </motion.div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Message feed */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        >
          <div className={`${PANEL} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-200">NightLine feed</h2>
              {flaggedOnly ? <ToneBadge tone="amber">filtered: flagged</ToneBadge> : null}
            </div>

            {loading && !messages ? (
              <div className="p-4" aria-busy="true">
                <SkeletonRows rows={7} />
              </div>
            ) : shown.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-slate-400">
                  {flaggedOnly
                    ? "No flagged messages — the channel is clean."
                    : "No chat activity yet. Messages appear here as survivors talk."}
                </p>
              </div>
            ) : (
              <div className={`max-h-[34rem] overflow-y-auto ${SCROLLBAR}`}>
                <ul role="list" aria-label="Chat messages, newest first">
                  {shown.map((m) => {
                    const isMuted = mutedNames.has(m.name);
                    const isBanned = bannedNames.has(m.name);
                    const busy = pendingName === m.name || deletingId === m.id;
                    return (
                      <li
                        key={m.id}
                        className="group flex items-start gap-3 border-b border-white/5 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold text-slate-200">
                              {m.name}
                            </span>
                            <span className="text-[11px] text-slate-500" title={fmtClock(m.ts)}>
                              {relTime(m.ts, now)}
                            </span>
                            {m.flagged ? <ToneBadge tone="red">FLAGGED</ToneBadge> : null}
                            {isMuted ? <ToneBadge tone="amber">muted</ToneBadge> : null}
                            {isBanned ? <ToneBadge tone="red">chat-banned</ToneBadge> : null}
                          </div>
                          <p className="mt-0.5 break-words text-sm text-slate-300">{m.msg}</p>
                        </div>

                        <div
                          className={`flex shrink-0 items-center gap-1 transition-opacity ${
                            busy ? "opacity-100" : "opacity-50 group-hover:opacity-100 focus-within:opacity-100"
                          }`}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                aria-label={`Moderation actions for ${m.name}`}
                              >
                                <MoreVertical className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              {!isMuted ? (
                                <>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      void runChatMod(
                                        { action: "mute", name: m.name, hours: 0.5 },
                                        "Muted for 30 minutes"
                                      )
                                    }
                                  >
                                    <MicOff aria-hidden="true" />
                                    Mute 30m
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      void runChatMod(
                                        { action: "mute", name: m.name, hours: 24 },
                                        "Muted for 24 hours"
                                      )
                                    }
                                  >
                                    <MicOff aria-hidden="true" />
                                    Mute 24h
                                  </DropdownMenuItem>
                                  {!isBanned ? (
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() =>
                                        void runChatMod(
                                          { action: "chatban", name: m.name },
                                          "Player chat-banned"
                                        )
                                      }
                                    >
                                      <UserX aria-hidden="true" />
                                      Chat-ban
                                    </DropdownMenuItem>
                                  ) : null}
                                </>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    void runChatMod(
                                      { action: "unmute", name: m.name },
                                      "Chat unmuted"
                                    )
                                  }
                                >
                                  <Mic aria-hidden="true" />
                                  Unmute
                                </DropdownMenuItem>
                              )}
                              {isBanned ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    void runChatMod(
                                      { action: "chatunban", name: m.name },
                                      "Chat ban lifted"
                                    )
                                  }
                                >
                                  <ShieldOff aria-hidden="true" />
                                  Unchat-ban
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            onClick={() => void deleteMessage(m)}
                            aria-label={`Delete message from ${m.name}`}
                            className="text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </motion.div>

        {/* Side panel */}
        <motion.aside
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="space-y-4"
          aria-label="Chat moderation panel"
        >
          {/* Broadcast composer */}
          <div className={PANEL}>
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Megaphone className="size-4 text-orange-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-200">
                  Send NightLine announcement
                </h2>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleBroadcast();
                }}
                className="flex gap-2"
              >
                <Input
                  value={broadcast}
                  onChange={(e) => setBroadcast(e.target.value)}
                  placeholder="A system message for every survivor…"
                  aria-label="Announcement message"
                  maxLength={200}
                  disabled={broadcasting}
                  className="border-white/10 bg-slate-950/60 text-sm text-slate-100 placeholder:text-slate-600"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!broadcast.trim() || broadcasting}
                  aria-label="Send announcement"
                  className="shrink-0 bg-orange-500 text-white hover:bg-orange-600"
                >
                  <Send className="size-4" aria-hidden="true" />
                </Button>
              </form>
              <p className="text-[11px] text-slate-500">
                Appears as a NightLine system message in the live chat. Max 200 characters.
              </p>
            </div>
          </div>

          {/* Muted list */}
          <MutedList
            muted={chatState?.muted ?? []}
            now={now}
            pendingName={pendingName}
            onUnmute={(name) =>
              void runChatMod({ action: "unmute", name }, "Chat unmuted")
            }
          />

          {/* Chat-banned list */}
          <BannedList
            banned={chatState?.chatBanned ?? []}
            now={now}
            pendingName={pendingName}
            onUnban={(name) =>
              void runChatMod({ action: "chatunban", name }, "Chat ban lifted")
            }
          />
        </motion.aside>
      </div>
    </div>
  );
}

function MutedList({
  muted,
  now,
  pendingName,
  onUnmute,
}: {
  muted: MutedEntry[];
  now: number;
  pendingName: string | null;
  onUnmute: (name: string) => void;
}) {
  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MicOff className="size-4 text-amber-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-200">Muted</h2>
        </div>
        <ToneBadge tone="amber">{muted.length}</ToneBadge>
      </div>
      {muted.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-500">
          Nobody is muted right now.
        </p>
      ) : (
        <ul role="list" className={`max-h-52 overflow-y-auto ${SCROLLBAR}`}>
          {muted.map((m) => (
            <li
              key={m.name}
              className="flex items-start justify-between gap-2 border-b border-white/5 px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">{m.name}</p>
                <p className="text-[11px] text-amber-400/80">
                  until {relTime(m.until, now)}
                </p>
                {m.reason ? (
                  <p className="mt-0.5 truncate text-[11px] italic text-slate-500" title={m.reason}>
                    {m.reason}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingName === m.name}
                onClick={() => onUnmute(m.name)}
                aria-label={`Unmute ${m.name}`}
                className="shrink-0 text-slate-400 hover:text-emerald-400"
              >
                <Mic className="size-3.5" aria-hidden="true" />
                Unmute
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BannedList({
  banned,
  now,
  pendingName,
  onUnban,
}: {
  banned: ChatBannedEntry[];
  now: number;
  pendingName: string | null;
  onUnban: (name: string) => void;
}) {
  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <UserX className="size-4 text-red-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-200">Chat-banned</h2>
        </div>
        <ToneBadge tone="red">{banned.length}</ToneBadge>
      </div>
      {banned.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-500">
          No chat bans in effect.
        </p>
      ) : (
        <ul role="list" className={`max-h-52 overflow-y-auto ${SCROLLBAR}`}>
          {banned.map((b) => (
            <li
              key={b.name}
              className="flex items-start justify-between gap-2 border-b border-white/5 px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">{b.name}</p>
                <p className="text-[11px] text-red-400/80">
                  banned {relTime(b.at, now)}
                </p>
                {b.reason ? (
                  <p className="mt-0.5 truncate text-[11px] italic text-slate-500" title={b.reason}>
                    {b.reason}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingName === b.name}
                onClick={() => onUnban(b.name)}
                aria-label={`Lift chat ban for ${b.name}`}
                className="shrink-0 text-slate-400 hover:text-emerald-400"
              >
                <ShieldOff className="size-3.5" aria-hidden="true" />
                Unban
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
