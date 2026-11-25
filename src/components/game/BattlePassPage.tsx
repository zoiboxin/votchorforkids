"use client";

/**
 * BattlePassPage — the full-page 🎫 SEASON PASS.
 *
 * PUBG / Fortnite-style: season hero header (name plate, days-left, premium
 * CTA), a 50-tier reward track (FREE row on top · PREMIUM row below, milestone
 * tiers glow), claim buttons that pay REAL rewards (coins → wallet, XP →
 * profile bonus), the rank ladder, and the game ad carousel.
 *
 * Progress = career XP (every banked point + daily/quest bonus, forever).
 * Claims persist per season in localStorage (votechor_bp_v1); the premium
 * unlock is a real wallet purchase (bp-premium) so it survives cloud sync.
 */

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Crown, Flame, Lock, Sparkles, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { RANKS } from "@/lib/game/ranks";
import {
  BP_PREMIUM_ITEM_ID, BP_PREMIUM_PRICE, BP_TIERS, BP_TIERS_COUNT, XP_PER_TIER,
  bpClaims, bpMarkClaimed, claimKey, seasonWindow, type BpReward, type BpTier,
} from "@/lib/game/battlepass";
import { AdCarousel, PageShell, Strip, XpBar } from "./PageKit";

/* reward chip → tailwind text color */
function rewardText(r: BpReward): string {
  if (r.kind === "coins") return "text-yellow-300";
  if (r.kind === "xp") return "text-emerald-300";
  return "text-fuchsia-200";
}

/* one reward box inside a tier card */
function RewardBox({
  reward, owned, unlocked, claimed, onClaim, premium,
}: {
  reward: BpReward;
  owned: boolean;        // premium track unlocked?
  unlocked: boolean;     // tier reached?
  claimed: boolean;
  onClaim: () => void;
  premium: boolean;
}) {
  const locked = premium && !owned;
  const canClaim = unlocked && !locked && !claimed;

  return (
    <div
      className={`relative flex flex-1 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-center transition-colors ${
        claimed
          ? "border-emerald-300/45 bg-emerald-400/12"
          : canClaim
            ? "border-yellow-300/70 bg-yellow-400/15 shadow-[0_0_14px_rgba(253,224,71,0.35)]"
            : locked
              ? "border-white/10 bg-black/30 opacity-70"
              : unlocked
                ? "border-white/20 bg-white/8"
                : "border-white/10 bg-black/25 opacity-55"
      }`}
    >
      {premium && (
        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-500 px-1.5 py-px text-[8px] font-black uppercase tracking-wider text-white shadow">
          gold
        </span>
      )}
      <span aria-hidden className={`text-xl leading-none ${locked ? "grayscale" : ""}`}>{locked ? "🔒" : reward.emoji}</span>
      <span className={`text-[9px] font-black leading-tight ${rewardText(reward)}`}>{reward.label}</span>
      {claimed ? (
        <span className="mt-0.5 flex items-center gap-0.5 text-[9px] font-black uppercase text-emerald-300">
          <Check size={10} strokeWidth={3.5} /> claimed
        </span>
      ) : canClaim ? (
        <button
          onClick={onClaim}
          className="mt-0.5 rounded-full bg-yellow-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-950 shadow-[0_2px_0_rgba(161,98,7,0.55)] transition-transform hover:scale-105 active:scale-95"
        >
          claim
        </button>
      ) : locked ? (
        <span className="mt-0.5 flex items-center gap-0.5 text-[9px] font-black uppercase text-white/45">
          <Lock size={9} /> premium
        </span>
      ) : (
        <span className="mt-0.5 text-[9px] font-black uppercase text-white/40">
          {unlocked ? "—" : "locked"}
        </span>
      )}
    </div>
  );
}

/* one tier card (free row + premium row — rows hide by track filter) */
function TierCard({
  tier, careerXp, claimed, premiumOwned, onClaim, mode,
}: {
  tier: BpTier;
  careerXp: number;
  claimed: ReadonlySet<string>;
  premiumOwned: boolean;
  onClaim: (track: "f" | "p", t: number) => void;
  mode: "all" | "free" | "premium";
}) {
  const unlocked = careerXp >= tier.xp;
  const milestone = tier.tier % 10 === 0;
  const current = careerXp >= tier.xp && careerXp < tier.xp + XP_PER_TIER;

  return (
    <div
      className={`relative flex w-[124px] shrink-0 snap-center flex-col gap-1 rounded-xl border p-1.5 transition-colors sm:w-[136px] ${
        current
          ? "border-yellow-300/80 bg-yellow-400/10 shadow-[0_0_20px_rgba(253,224,71,0.35)]"
          : milestone
            ? "border-fuchsia-300/45 bg-fuchsia-400/8"
            : unlocked
              ? "border-white/20 bg-slate-900/70"
              : "border-white/10 bg-slate-950/70"
      }`}
    >
      {/* tier header */}
      <div className="flex items-center justify-between px-1">
        <span className={`text-[10px] font-black uppercase tabular-nums ${current ? "text-yellow-200" : "text-white/60"}`}>
          Tier {tier.tier}
        </span>
        {milestone && <Sparkles size={11} className="text-fuchsia-300" />}
      </div>
      {/* free reward (hidden on the gold-only view) */}
      {mode !== "premium" && (
        <RewardBox
          reward={tier.free}
          owned
          unlocked={unlocked}
          claimed={claimed.has(claimKey("f", tier.tier))}
          onClaim={() => onClaim("f", tier.tier)}
          premium={false}
        />
      )}
      {/* premium reward (hidden on the free-only view) */}
      {mode !== "free" && (
        <RewardBox
          reward={tier.premium}
          owned={premiumOwned}
          unlocked={unlocked}
          claimed={claimed.has(claimKey("p", tier.tier))}
          onClaim={() => onClaim("p", tier.tier)}
          premium
        />
      )}
      {/* XP requirement */}
      <div className="px-1 pb-0.5 text-center text-[9px] font-bold tabular-nums text-white/40">
        {tier.xp.toLocaleString()} XP
      </div>
    </div>
  );
}

export function BattlePassPage() {
  const coins = useGame((s) => s.coins);
  const owned = useGame((s) => s.owned);
  const careerXp = useGame((s) => s.careerXp);
  const buyItem = useGame((s) => s.buyItem);
  const bankCoins = useGame((s) => s.bankCoins);
  const addBonusXp = useGame((s) => s.addBonusXp);
  const pushToast = useGame((s) => s.pushToast);

  const season = seasonWindow();
  /* claims hydrate lazily on first render — GameRoot is ssr:false, so the
     window (and localStorage) is always present when this page mounts */
  const [claimed, setClaimed] = useState<ReadonlySet<string>>(() => new Set(bpClaims(season.no)));
  const [filter, setFilter] = useState<"all" | "free" | "premium">("all");
  const trackRef = useRef<HTMLDivElement | null>(null);

  const premiumOwned = owned.includes(BP_PREMIUM_ITEM_ID);
  const currentTier = Math.min(BP_TIERS_COUNT, Math.floor(careerXp / XP_PER_TIER));
  const intoTier = careerXp % XP_PER_TIER;
  /* the track filter hides one reward row per card — ALL shows both */
  const trackMode = filter;

  /** pay a claim for real: coins → wallet · xp → bonus pool · flair → toast */
  const claim = (track: "f" | "p", tier: number) => {
    const t = BP_TIERS[tier - 1];
    if (!t) return;
    const reward = track === "f" ? t.free : t.premium;
    if (track === "p" && !premiumOwned) { sfx.click(); return; }
    sfx.pickup();
    if (reward.kind === "coins" && reward.n > 0) {
      bankCoins(reward.n);
      pushToast(`🎫 Pass reward — $${reward.n} cash banked!`, "good");
    } else if (reward.kind === "xp" && reward.n > 0) {
      addBonusXp(reward.n);
      pushToast(`🎫 Pass reward — +${reward.n} bonus XP!`, "good");
    } else {
      pushToast(`🎫 Pass reward — ${reward.emoji} ${reward.label} unlocked!`, "good");
    }
    setClaimed(new Set(bpMarkClaimed(season.no, claimKey(track, tier))));
  };

  const buyPremium = () => {
    sfx.click();
    if (buyItem(BP_PREMIUM_ITEM_ID)) {
      pushToast(`🎫 BP PREMIUM unlocked — all ${BP_TIERS_COUNT} gold tiers live!`, "good");
    } else {
      pushToast(`💰 Not enough cash — the gold track costs $${BP_PREMIUM_PRICE.toLocaleString()}.`, "info");
    }
  };

  const scrollTrack = (dir: 1 | -1) => {
    sfx.click();
    trackRef.current?.scrollBy({ left: dir * 420, behavior: "smooth" });
  };

  return (
    <PageShell
      title="BATTLE PASS"
      emoji="🎫"
      subtitle={`Season ${season.no} · ${season.name} — climb the 50-tier reward track with career XP.`}
      screen="battlepass"
    >
      <AdCarousel placement="battle pass" />

      {/* ---------- season hero ---------- */}
      <section className="relative overflow-hidden rounded-2xl border border-fuchsia-300/30 bg-gradient-to-r from-fuchsia-950/85 via-purple-950/80 to-slate-950/85 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(217,70,239,0.22),transparent_55%),radial-gradient(circle_at_85%_70%,rgba(168,85,247,0.18),transparent_50%)]" />
        <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
          {/* season plate */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-fuchsia-200 ring-1 ring-fuchsia-300/40">
                <Ticket size={11} /> season {season.no}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/75 ring-1 ring-white/25">
                <Flame size={11} className="text-orange-400" /> ends in {season.daysLeft} day{season.daysLeft === 1 ? "" : "s"} · {season.endsOn}
              </span>
              {premiumOwned && (
                <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-300 to-amber-400 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-slate-950">
                  <Crown size={11} /> premium active
                </span>
              )}
            </div>
            <h2 className="mt-2 bg-gradient-to-r from-fuchsia-200 via-white to-amber-200 bg-clip-text text-3xl font-black italic uppercase tracking-tight text-transparent drop-shadow-[0_3px_0_rgba(0,0,0,0.4)] sm:text-4xl">
              {season.name}
            </h2>
            <p className="mt-1 max-w-xl text-[11px] font-bold leading-snug text-white/70 sm:text-xs">
              Every point you bank in town feeds the pass — runs, dailies and quest bonuses all count, and XP never resets.
            </p>
          </div>

          {/* tier progress ring-ish panel */}
          <div className="shrink-0 rounded-xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur sm:min-w-[240px]">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black italic tabular-nums text-white">{currentTier}</span>
              <span className="text-xs font-black uppercase text-white/50">/ {BP_TIERS_COUNT} tier</span>
            </div>
            <div className="mt-2">
              <XpBar pct={currentTier >= BP_TIERS_COUNT ? 1 : intoTier / XP_PER_TIER} bar="from-fuchsia-400 via-purple-400 to-amber-300" />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] font-bold tabular-nums text-white/55">
              <span>{intoTier}/{XP_PER_TIER} XP</span>
              <span className="text-fuchsia-200/90">{careerXp.toLocaleString()} career XP</span>
            </div>
            {!premiumOwned ? (
              <Button
                onClick={buyPremium}
                className="mt-3 w-full rounded-lg bg-gradient-to-r from-yellow-300 to-amber-400 px-3 py-2.5 text-[11px] font-black uppercase tracking-wider text-slate-950 shadow-[0_4px_0_rgba(161,98,7,0.55)] hover:from-yellow-200 hover:to-amber-300"
                aria-label={`Buy BP Premium for $${BP_PREMIUM_PRICE}`}
              >
                <Crown size={14} className="mr-1.5" /> unlock premium — ${BP_PREMIUM_PRICE}
              </Button>
            ) : (
              <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-yellow-300/40 bg-yellow-400/12 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-yellow-200">
                <Crown size={13} /> gold track unlocked
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- reward track ---------- */}
      <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
        <Strip
          right={
            <div className="flex items-center gap-1.5">
              {(["all", "free", "premium"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { sfx.click(); setFilter(f); }}
                  aria-pressed={filter === f}
                  className={`rounded-[3px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-colors ${
                    filter === f ? "bg-yellow-400 text-slate-950" : "bg-black/35 text-white/70 ring-1 ring-white/20 hover:bg-black/55"
                  }`}
                >
                  {f}
                </button>
              ))}
              <span className="ml-1 hidden items-center gap-1 sm:flex">
                <button onClick={() => scrollTrack(-1)} aria-label="Scroll rewards left"
                  className="rounded-[3px] bg-black/35 p-1 text-white/75 ring-1 ring-white/20 hover:bg-black/55">
                  <ChevronLeft size={13} />
                </button>
                <button onClick={() => scrollTrack(1)} aria-label="Scroll rewards right"
                  className="rounded-[3px] bg-black/35 p-1 text-white/75 ring-1 ring-white/20 hover:bg-black/55">
                  <ChevronRight size={13} />
                </button>
              </span>
            </div>
          }
        >
          Reward track — free &amp; gold
        </Strip>

        <div className="relative p-3">
          {/* current-tier beacon line */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-3 z-10 hidden w-0.5 bg-yellow-300/70 shadow-[0_0_10px_rgba(253,224,71,0.6)] sm:block"
            style={{ left: `calc(1rem + ${Math.max(0, currentTier - 1) * 148}px + 62px)` }}
          />
          <div
            ref={trackRef}
            className="lobby-scroll flex snap-x gap-2.5 overflow-x-auto pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar]:h-2"
            role="list"
            aria-label="Battle pass reward tiers"
          >
            {BP_TIERS.map((t) => (
              <motion.div
                key={t.tier}
                role="listitem"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: Math.min(0.3, t.tier * 0.008) }}
              >
                <TierCard
                  tier={t}
                  careerXp={careerXp}
                  claimed={claimed}
                  premiumOwned={premiumOwned}
                  onClaim={claim}
                  mode={trackMode}
                />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- rank ladder + pass summary ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
          <Strip right={<span className="text-[10px] font-black text-white/85">tied to career XP</span>}>
            Rank ladder
          </Strip>
          <div className="grid grid-cols-1 gap-1.5 p-2.5 sm:grid-cols-2">
            {RANKS.map((r) => {
              const reached = careerXp >= r.min;
              return (
                <div
                  key={r.id}
                  className={`flex items-center gap-2 rounded border px-2.5 py-1.5 ${
                    reached ? "border-white/15 bg-white/5" : "border-white/10 opacity-55"
                  }`}
                >
                  <span aria-hidden className="w-6 text-center text-base">{reached ? r.emoji : "🔒"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-white/85">{r.name}</div>
                    <div className="text-[9px] font-bold tabular-nums text-white/45">{r.min.toLocaleString()} XP</div>
                  </div>
                  {reached && <Check size={13} className="shrink-0 text-emerald-300" />}
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
          <Strip>How the pass works</Strip>
          <div className="space-y-1.5 p-2.5 text-[11px] font-bold leading-relaxed text-white/70">
            <p>🎯 <b className="text-white/90">Earn XP</b> — bank points, rescue friends, finish runs, and clear the daily board (the +100 all-done bonus counts too).</p>
            <p>🎖️ <b className="text-white/90">Climb tiers</b> — {XP_PER_TIER} XP per tier, {BP_TIERS_COUNT} tiers, a jackpot every 10th.</p>
            <p>💰 <b className="text-white/90">Claim for real</b> — cash lands in your wallet, XP lands on your profile, flair sticks to your legend.</p>
            <p>🎫 <b className="text-white/90">Go gold</b> — premium doubles the jackpots and adds the gold flair line. One purchase, this whole season.</p>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
