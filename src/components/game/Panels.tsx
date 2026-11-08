"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Music, Volume2, Gauge, Gamepad2, ShieldAlert, Siren, Sunrise, HeartHandshake,
  BarChart3, History as HistoryIcon, Trash2, Trophy, Timer, Star, Moon, MoonStar, Scale, Flame, Sparkles,
} from "lucide-react";
import { useGame, type RunRecord } from "./store";
import { RankCard } from "./RankCard";
import { DailyCard } from "./DailyCard";
import { setVolumes, sfx } from "@/lib/game/audio";

/* ----------------------------- How to play ----------------------------- */
const CONTROLS: [string, string][] = [
  ["W A S D / Arrows", "Move around the town"],
  ["Mouse drag", "Look around"],
  ["Shift", "Sprint — drains ⚡ stamina fast"],
  ["Space", "Jump — press again mid-air for a double-jump! 🤸"],
  ["F", "Attack / swing — chop trees, smash rocks, fight the beasts"],
  ["G", "🎒 Tool wheel — pick axe / sword / hammer / builder · 🪪 show your driving license"],
  ["B", "Build a barricade — 4 🪓 wood"],
  ["V", "Build a campfire — 2 🪓 wood + 2 🪨 stone"],
  ["E", "Inspect a body at dawn / enter or drive a car — a 🪪 license is REQUIRED: hunt a glowing blue card (or be handed one) before any car starts"],
  ["R", "Accuse a survivor — dawn only, and it's final!"],
  ["Q", "🌀 Blink — a short teleport where you look"],
  ["1 – 8", "Eat pocketed food ❤⚡ — or tap the bag bottom-left"],
  ["Z / X", "Camera — zoom / spin"],
  ["M", "Open the big map"],
  ["P or Esc", "Pause the game"],
];

export function HowToPlay({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl border-red-300/30 bg-slate-900/95 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-yellow-300">
            <Gamepad2 size={22} /> How to play
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section className="rounded-2xl border border-indigo-300/30 bg-indigo-500/10 p-3">
            <div className="mb-1.5 flex items-center gap-2 font-black text-indigo-300"><Moon size={15} /> One town · 7 nights · 100 souls</div>
            <p className="leading-relaxed text-white/85">
              <b className="text-yellow-200">100 players</b> enter the contest — 99 contestants and you. Every dusk
              <b className="text-rose-200"> about HALF of everyone still alive turns</b> into zombies, and the turned must
              <b className="text-amber-200"> FEED before dawn or crumble</b> with the sunrise. Fight back with your fists, an
              axe, a sword or any tool — every swing costs them health, and punches barely scratch. Survive all
              <b> 7 nights</b> — or be the last one breathing — to win. And the law still holds by day: <b className="text-rose-200">murder,
              assault or robbery in front of witnesses</b> and the police will chase you down and lock you up.
            </p>
          </section>

          <section className="rounded-2xl border border-teal-300/25 bg-teal-400/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 font-black text-teal-300">🌐 Playing with friends</div>
            <p className="text-sm text-white/85">
              Hit <b className="text-teal-200">🌐 Multiplayer</b> on the home screen → <b>Host a night</b> and share the
              4-letter code, or <b>join</b> a friend&apos;s room. Up to 8 real souls share one town: the host&apos;s clock
              drives the week, everyone gathers &amp; builds together, loot &amp; barricades sync instantly, and a
              player-beast&apos;s claws reach across the wire. Died? Your run ends — the night goes on, and the host
              can restart the week for everyone.
            </p>
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-amber-300"><Sunrise size={15} /> ☀️ Day — build</div>
              <p className="text-white/85">Swing the 🪓 axe at trees and the 🔨 hammer at boulders for wood &amp; stone, then stack barricades and campfires. The beast can&apos;t touch you while the sun is up. The <b>bots forage too</b> — they scoop dropped purses, pocket snacks and grab power gems, so race them for every goodie!</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-orange-300"><Siren size={15} /> ⚠️ Dusk — the warning</div>
              <p className="text-white/85">Sirens howl… the spirit has chosen its hosts — <b>more than one of you</b> may turn, and it could be YOU. Watch the crew — black eyes, odd paths and missing faces are clues.</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-indigo-300"><MoonStar size={15} /> 🌑 Night — survive</div>
              <p className="text-white/85">The possessed become a PACK of beasts and hunt everyone else. Hide behind barricades, circle the campfires — or pick your sharpest tool and fight (F). If YOU are chosen… claw away! 🩸</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-yellow-300"><Scale size={15} /> ⚖️ Dawn — accuse</div>
              <p className="text-white/85">Inspect bodies with <b>E</b> for clues (torn cloth colors, wounds), then press <b>R</b> near your suspect. Right call: <b className="text-emerald-300">+200</b>. Wrong call: <b className="text-rose-300">−60</b>… and an innocent is gone forever.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-orange-400/25 bg-orange-500/10 p-3">
            <div className="mb-1.5 flex items-center gap-2 font-black text-orange-300"><Flame size={15} /> 🔥 Barricades &amp; campfires</div>
            <p className="leading-relaxed text-white/85">
              <b>Barricades</b> (B — 4 wood) block the beast&apos;s path and soak <b>100 HP</b> of hits.
              <b> Campfires</b> (V — 2 wood + 2 stone) throw a ring of light that beasts &amp; zombies won&apos;t cross.
              Build both — wood runs out, and the jungle is a long walk in the dark.
            </p>
          </section>

          <section className="rounded-2xl bg-white/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 font-black text-yellow-300"><Trophy size={15} /> Points &amp; tools</div>
            <p className="text-white/85">+15 harvest · +30 build · +80 survive a night · +40 zombie kill · +200 beast kill · +200 right accuse · −60 wrong accuse.</p>
            <p className="mt-1 text-white/85">Tools stack — carry them all: 🪓 axe chops wood · 🔨 hammer smashes stone · 🗡️ sword hits hardest · 🔧 builder builds everything. Press <b className="text-yellow-200">G</b> to open the tool wheel and mouse-pick one.</p>
          </section>

          <section className="rounded-2xl bg-white/5 p-3">
            <div className="mb-2 font-black text-white">Controls</div>
            <div className="grid gap-1.5">
              {CONTROLS.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-white/85">
                  <kbd className="min-w-24 rounded-lg border border-white/25 bg-black/40 px-2 py-0.5 text-center text-xs font-black text-yellow-200">{k}</kbd>
                  <span className="text-xs">{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/55">On phones & tablets you get a joystick + buttons automatically.</p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Settings ----------------------------- */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const settings = useGame((s) => s.settings);
  const patch = useGame((s) => s.patchSettings);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);

  const applyVolumes = (music: number, sfx01: number) => setVolumes(sfx01, music);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl border-sky-300/30 bg-slate-900/95 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-yellow-300">Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold"><Music size={15} className="text-emerald-300" /> Music volume</span>
              <span className="text-xs font-black text-white/60">{Math.round(settings.music * 100)}%</span>
            </div>
            <Slider
              aria-label="Music volume"
              value={[settings.music]}
              max={1} step={0.05}
              onValueChange={([v]) => { patch({ music: v }); applyVolumes(v, settings.sfx); }}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold"><Volume2 size={15} className="text-amber-300" /> Sound effects</span>
              <span className="text-xs font-black text-white/60">{Math.round(settings.sfx * 100)}%</span>
            </div>
            <Slider
              aria-label="Sound effects volume"
              value={[settings.sfx]}
              max={1} step={0.05}
              onValueChange={([v]) => { patch({ sfx: v }); applyVolumes(settings.music, v); sfx.pickup(); }}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
            <span className="text-sm font-bold">Show FPS counter</span>
            <Switch checked={settings.showFps} onCheckedChange={(showFps) => patch({ showFps })} />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
            <span className="text-sm font-bold">Mute everything</span>
            <Switch checked={muted} onCheckedChange={(m) => { setMuted(m); setAudioMuted(m); }} />
          </div>
        </div>
        <Button onClick={() => onOpenChange(false)} className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 font-black text-amber-950">
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function setAudioMuted(m: boolean) {
  import("@/lib/game/audio").then(({ setMuted }) => setMuted(m)).catch(() => {});
}

/* ----------------------------- shared helpers ----------------------------- */
function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtWhen(at: number) {
  const d = new Date(at);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/* ----------------------------- Stats ----------------------------- */
export function StatsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const careerXp = useGame((s) => s.careerXp);
  const bonusXp = useGame((s) => s.bonusXp);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const wins = useGame((s) => s.wins);
  const lifeVotes = useGame((s) => s.lifeVotes);
  const lifeRescues = useGame((s) => s.lifeRescues);
  const lifeCaught = useGame((s) => s.lifeCaught);
  const playtimeMs = useGame((s) => s.playtimeMs);
  const history = useGame((s) => s.history);
  const daily = useGame((s) => s.daily);

  const winRate = runsPlayed > 0 ? Math.round((wins / runsPlayed) * 100) : 0;
  // average RUN score — bonus XP (daily tasks/streaks) is kept out on purpose
  const runScoreTotal = Math.max(0, careerXp - bonusXp);
  const avgScore = runsPlayed > 0 ? Math.round(runScoreTotal / runsPlayed) : 0;
  const playH = Math.floor(playtimeMs / 3_600_000);
  const playM = Math.floor((playtimeMs % 3_600_000) / 60_000);
  const last5 = history.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-3xl border-sky-300/30 bg-slate-900/95 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-yellow-300">
            <BarChart3 size={22} /> Career stats
          </DialogTitle>
        </DialogHeader>

        <RankCard />

        <DailyCard />

        <div className="grid grid-cols-3 gap-2">
          <StatCell icon={<BarChart3 size={14} />} label="Runs" value={String(runsPlayed)} />
          <StatCell icon={<Trophy size={14} />} label="Wins" value={String(wins)} />
          <StatCell icon={<Gauge size={14} />} label="Win rate" value={`${winRate}%`} />
          <StatCell icon={<Star size={14} />} label="Best score" value={bestScore.toLocaleString()} />
          <StatCell icon={<span className="text-sm">💰</span>} label="Money banked" value={String(lifeVotes)} />
          <StatCell icon={<HeartHandshake size={14} />} label="Friends rescued" value={String(lifeRescues)} />
          <StatCell icon={<ShieldAlert size={14} />} label="Times caught" value={String(lifeCaught)} />
          <StatCell icon={<Timer size={14} />} label="Playtime" value={playH > 0 ? `${playH}h ${playM}m` : `${playM}m`} />
          <StatCell icon={<BarChart3 size={14} />} label="Avg score" value={avgScore.toLocaleString()} />
          <StatCell icon={<Flame size={14} />} label="🔥 Streak" value={`${daily.streak}d`} />
          <StatCell icon={<Flame size={14} />} label="Best streak" value={`${daily.bestStreak}d`} />
          <StatCell icon={<Sparkles size={14} />} label="Bonus XP" value={bonusXp.toLocaleString()} />
        </div>

        {last5.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Last 5 runs</div>
            <div className="space-y-1">
              {last5.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs">
                  <span aria-hidden>{r.won ? "🏆" : "🏃"}</span>
                  <b className="text-yellow-200">{r.score.toLocaleString()}</b>
                  <span className="text-white/55">pts</span>
                  <span className="ml-auto text-white/60">💰 ₹{r.votes} · ❤ {r.rescues} · {fmtClock(r.timeMs)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-white/45">XP = every point you ever scored <b>+</b> daily-task, streak &amp; all-done bonuses. Rank up by playing &amp; finishing daily tasks! 🚀</p>
      </DialogContent>
    </Dialog>
  );
}

function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2.5 text-center">
      <div className="mx-auto mb-0.5 flex items-center justify-center gap-1 text-yellow-300">{icon}</div>
      <div className="text-sm font-black text-white">{value}</div>
      <div className="text-[9px] font-bold uppercase leading-tight tracking-wide text-white/55">{label}</div>
    </div>
  );
}

/* ----------------------------- Run history ----------------------------- */
export function HistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const history = useGame((s) => s.history);
  const clearHistory = useGame((s) => s.clearHistory);
  const pushToast = useGame((s) => s.pushToast);
  const [confirmClear, setConfirmClear] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setConfirmClear(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-hidden rounded-3xl border-amber-300/30 bg-slate-900/95 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-yellow-300">
            <HistoryIcon size={22} /> Run history
          </DialogTitle>
        </DialogHeader>

        {history.length === 0 ? (
          <div className="rounded-2xl bg-white/5 p-6 text-center">
            <div className="text-3xl">📼</div>
            <p className="mt-2 text-sm font-bold text-white/70">No runs recorded yet.</p>
            <p className="mt-1 text-xs text-white/50">Play a run — every chase, rescue and delivery gets saved here automatically.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs font-bold text-white/60">
              <span>{history.length} run{history.length === 1 ? "" : "s"} on this device</span>
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="flex items-center gap-1 rounded-full border border-rose-300/40 px-2.5 py-1 text-[11px] font-black text-rose-200 hover:bg-rose-500/20"
                >
                  <Trash2 size={12} /> Clear
                </button>
              ) : (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => { clearHistory(); setConfirmClear(false); pushToast("Run history cleared.", "info"); }}
                    className="rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-black text-white hover:bg-rose-400"
                  >
                    Confirm clear
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="rounded-full border border-white/25 px-2.5 py-1 text-[11px] font-black text-white hover:bg-white/10"
                  >
                    Keep
                  </button>
                </span>
              )}
            </div>
            <ScrollArea className="h-[46vh] pr-2">
              <div className="space-y-1.5">
                {history.map((r: RunRecord) => (
                  <div key={r.id} className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${r.won ? "border-yellow-300/40 bg-yellow-300/10" : "border-white/10 bg-white/5"}`}>
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${r.won ? "bg-yellow-300/25" : "bg-black/30"}`} aria-hidden>
                      {r.won ? "🏆" : "🏃"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <b className="text-yellow-200">{r.score.toLocaleString()}</b>
                        <span className="text-[11px] text-white/55">pts</span>
                        {r.won && <span className="rounded-full bg-yellow-300/25 px-1.5 text-[9px] font-black uppercase text-yellow-200">Democracy saved</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[10px] font-bold text-white/60">
                        <span>💰 ₹{r.votes}</span>
                        <span>❤ {r.rescues}</span>
                        <span>⭐ {r.caught} caught</span>
                        <span>⏱ {fmtClock(r.timeMs)}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-right text-[10px] leading-tight text-white/45">{fmtWhen(r.at)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
