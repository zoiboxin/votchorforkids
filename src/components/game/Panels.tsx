"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Music, Volume2, Gauge, Gamepad2, Flag, ShieldAlert, Sunrise, HeartHandshake, Vote } from "lucide-react";
import { useGame } from "./store";
import { setVolumes, sfx } from "@/lib/game/audio";

/* ----------------------------- How to play ----------------------------- */
const CONTROLS: [string, string][] = [
  ["W A S D / Arrows", "Run around the city"],
  ["Mouse drag", "Look around"],
  ["Shift", "Sprint (uses stamina)"],
  ["Space", "Jump"],
  ["E", "Rescue a detained friend"],
  ["1 / 2 / 3", "Nothing to press — votes auto-stack (max 3)"],
  ["P or Esc", "Pause the game"],
  ["M", "Mute / unmute"],
];

export function HowToPlay({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl border-emerald-300/30 bg-slate-900/95 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-yellow-300">
            <Gamepad2 size={22} /> How to play
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section className="rounded-2xl bg-white/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 font-black text-emerald-300"><Flag size={15} /> Mission</div>
            <p className="leading-relaxed text-white/85">
              Sneak through the city, snatch the <b className="text-yellow-300">16 missing votes</b> 🗳 and deliver them to the big
              glowing ballot box by Parliament. Carry up to 3 at a time — carrying votes makes police spot you from further away!
            </p>
          </section>

          <section className="rounded-2xl bg-white/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 font-black text-rose-300"><ShieldAlert size={15} /> The police</div>
            <p className="leading-relaxed text-white/85">
              Cops patrol and chase what they can see. Break line of sight behind buildings to lose them. Getting caught drops your
              votes and raises your <b>wanted stars</b> ⭐. You start each run with a short <b className="text-emerald-300">sneak shield</b> — police can&apos;t spot you for the first few seconds.
            </p>
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-yellow-300"><Vote size={15} /> Votes & points</div>
              <p className="text-white/85">+10 pick up · +120 deliver · +60 rescue · +500 save democracy!</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-pink-300"><HeartHandshake size={15} /> Rescue friends</div>
              <p className="text-white/85">Detained civilians wait in pink bubbles — walk close and press <b>E</b> to free them.</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-orange-300"><Sunrise size={15} /> Day & night</div>
              <p className="text-white/85">Grab mangoes, samosas & chai to stay strong. When night falls… graveyard zombies wake up 🧟</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 font-black text-sky-300"><Gauge size={15} /> Stamina</div>
              <p className="text-white/85">Sprinting drains stamina — it refills when you jog. Kids are nimble, elders regenerate fast!</p>
            </div>
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
