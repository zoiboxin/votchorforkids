"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Plus, ShieldBan, Trash2 } from "lucide-react";

import { api, fmtNum } from "./api";
import type { WordAction, WordEntry } from "./types";
import {
  EmptyState,
  ErrorBanner,
  InfoBanner,
  PANEL,
  SCROLLBAR,
  SkeletonRows,
  ToneBadge,
} from "./shared";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WordsTabProps {
  refreshTick: number;
}

export function WordsTab({ refreshTick }: WordsTabProps) {
  const { toast } = useToast();

  const [words, setWords] = React.useState<WordEntry[] | null>(null);
  const [online, setOnline] = React.useState<number | null>(null);
  const [messages24h, setMessages24h] = React.useState<number | null>(null);
  const [flagged24h, setFlagged24h] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [newWord, setNewWord] = React.useState("");
  const [newAction, setNewAction] = React.useState<WordAction>("block");
  const [adding, setAdding] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [deletingWord, setDeletingWord] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const d = await api.getWords();
      setWords(d.words);
      setOnline(typeof d.online === "number" ? d.online : null);
      setMessages24h(typeof d.messages24h === "number" ? d.messages24h : null);
      setFlagged24h(typeof d.flagged24h === "number" ? d.flagged24h : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load word filter.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  async function addWord() {
    const word = newWord.trim().toLowerCase();
    if (!word) {
      setFormError("Type a word first.");
      return;
    }
    if ((words ?? []).some((w) => w.word === word)) {
      setFormError("That word is already on the list.");
      return;
    }
    setFormError(null);
    setAdding(true);
    try {
      await api.addWord(word, newAction);
      toast({
        title: newAction === "block" ? "Word blocked" : "Word flagged",
        description: word,
      });
      setNewWord("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not add the word.");
    } finally {
      setAdding(false);
    }
  }

  async function removeWord(word: string) {
    setDeletingWord(word);
    try {
      await api.deleteWord(word);
      toast({ title: "Word removed", description: word });
      await load();
    } catch (err) {
      toast({
        title: "Remove failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingWord(null);
    }
  }

  const blocked = (words ?? []).filter((w) => w.action === "block").length;
  const flagged = (words ?? []).filter((w) => w.action === "flag").length;

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <InfoBanner icon={ShieldBan} tone="amber" title="How the filter works">
          <p>
            Blocked words are never broadcast; the sender gets a strike — 3 strikes in 10 minutes
            auto-mute 30 min. Flagged words are still shown, but every message containing them is
            marked for review here.
          </p>
        </InfoBanner>
      </motion.div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {/* Quick stats */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        <div className={PANEL}>
          <div className="px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Rules</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-100">
              {fmtNum(words?.length)}
            </p>
          </div>
        </div>
        <div className={PANEL}>
          <div className="px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Blocked</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-red-400">
              {fmtNum(blocked)}
            </p>
          </div>
        </div>
        <div className={PANEL}>
          <div className="px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Flagged</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-amber-400">
              {fmtNum(flagged)}
            </p>
          </div>
        </div>
        <div className={PANEL}>
          <div className="px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Msgs 24h / online</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-100">
              {fmtNum(messages24h)}
              <span className="text-sm text-slate-500"> / {fmtNum(online)}</span>
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* Add-word form */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.08 }}
        >
          <div className={PANEL}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addWord();
              }}
              className="space-y-4 p-4"
            >
              <div className="space-y-2">
                <Label htmlFor="new-word" className="text-slate-300">
                  Word or phrase
                </Label>
                <Input
                  id="new-word"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  placeholder="e.g. zombiezeta"
                  autoComplete="off"
                  disabled={adding}
                  className="border-white/10 bg-slate-950/60 text-slate-100 placeholder:text-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-action" className="text-slate-300">
                  Action
                </Label>
                <Select
                  value={newAction}
                  onValueChange={(v) => {
                    if (v === "block" || v === "flag") setNewAction(v);
                  }}
                >
                  <SelectTrigger
                    id="new-action"
                    aria-label="Filter action"
                    className="w-full border-white/10 bg-slate-950/60 text-slate-100"
                  >
                    <SelectValue placeholder="Choose action" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-slate-900 text-slate-200">
                    <SelectItem value="block">Block — never broadcast</SelectItem>
                    <SelectItem value="flag">Flag — show but mark for review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formError ? (
                <p role="alert" className="text-xs text-red-400">
                  {formError}
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={adding || !newWord.trim()}
                className="w-full bg-orange-500 text-white hover:bg-orange-600"
              >
                <Plus aria-hidden="true" />
                {adding ? "Adding…" : "Add word"}
              </Button>
            </form>
          </div>
        </motion.div>

        {/* Word list */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
        >
          <div className={`${PANEL} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <ShieldBan className="size-4 text-orange-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-200">Filter rules</h2>
              </div>
              <p className="text-xs text-slate-500">{fmtNum(words?.length ?? 0)} words</p>
            </div>

            {loading && !words ? (
              <div className="p-4" aria-busy="true">
                <SkeletonRows rows={5} />
              </div>
            ) : (words?.length ?? 0) === 0 ? (
              <EmptyState
                icon={ShieldBan}
                title="The filter list is empty"
                hint="Add a word on the left — blocked words stop messages instantly, flagged ones mark them for review."
              />
            ) : (
              <ul role="list" className={`max-h-96 overflow-y-auto ${SCROLLBAR}`}>
                {[...(words ?? [])]
                  .sort((a, b) => a.word.localeCompare(b.word))
                  .map((w) => (
                    <li
                      key={w.word}
                      className="group flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0 hover:bg-white/[0.03]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="truncate font-mono text-sm text-slate-200">
                          {w.word}
                        </span>
                        {w.action === "block" ? (
                          <ToneBadge tone="red" title="Never broadcast — sender gets a strike">
                            BLOCK
                          </ToneBadge>
                        ) : (
                          <ToneBadge tone="amber" title="Shown, but flagged for review">
                            FLAG
                          </ToneBadge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deletingWord === w.word}
                        onClick={() => void removeWord(w.word)}
                        aria-label={`Remove word ${w.word}`}
                        className="shrink-0 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
