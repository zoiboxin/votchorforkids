"use client";

/**
 * 🛒 SHOP PAGE — the ITEM SHOP as its own full-screen page (it outgrew the
 * lobby's cramped tab panel).
 *
 * Same visual language as Profile/Creator: the fixed hero-lobby-night backdrop
 * under a dark gradient, a max-w-6xl column, ghost back button and big black
 * title. The lobby's "Item Shop" tab now NAVIGATES here (deep-links too) and
 * [S] on the lobby jumps straight in.
 *
 * Layout:
 *   • header — back · ITEM SHOP title · 💰 wallet chip + owned count
 *   • intro banner — how banked cash funds every purchase (G / right-click 🎒 wheel)
 *   • one responsive grid per SHOP_KIND (gear · powers · support · style) with
 *     x/y owned counters, BUY / WEAR / "in every run" states
 *   • 🐉 MYTHIC VAULT — the legendary wide card; owning it lists every rigged
 *     RPG hero from MYTHIC_HEROES to wear on the spot
 *   • footer pointer back to the LOCKER collection
 *
 * Wiring: buys run through useGame.buyItem (wallet save slot), wears through
 * setLook — identical tone/toasts to the old shop panel.
 */

import { motion } from "framer-motion";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  outfitPreset, RPG_VAULT_ITEM_ID, SHOP_ITEMS, SHOP_KINDS, shopItem, type ShopItem,
} from "@/lib/game/shop";
import { MYTHIC_HEROES, glbCharDef } from "@/lib/game/glbCharacters";
import type { Appearance } from "@/lib/game/constants";
import { sfx } from "@/lib/game/audio";
import { useGame } from "./store";

export function ShopPage() {
  const setScreen = useGame((s) => s.setScreen);
  const coins = useGame((s) => s.coins);
  const owned = useGame((s) => s.owned);
  const buyItem = useGame((s) => s.buyItem);
  const look = useGame((s) => s.look);
  const setLook = useGame((s) => s.setLook);
  const pushToast = useGame((s) => s.pushToast);

  const vault = shopItem(RPG_VAULT_ITEM_ID);
  const vaultOwned = !!vault && owned.includes(vault.id);

  /** 🛒 buy with the wallet's banked cash — same tone/toasts as the lobby shop */
  const buy = (it: ShopItem) => {
    sfx.click();
    if (owned.includes(it.id)) return;
    if (buyItem(it.id)) {
      sfx.pickup();
      pushToast(
        it.kind === "style"
          ? `${it.emoji} ${it.name} purchased — wear it from the shop or the locker!`
          : `${it.emoji} ${it.name} purchased — it spawns with you every run (🎒 wheel: G / right-click)!`,
        "good",
      );
    } else {
      pushToast(`Not enough cash — ${it.name} costs $${it.price}. Roam the town & bank more 💰!`, "bad");
    }
  };

  /** 👕 wear a purchased outfit preset straight from the shop */
  const wearPreset = (it: ShopItem) => {
    const p = outfitPreset(it.presetId);
    if (p) {
      sfx.pickup();
      setLook(p.look);
      return;
    }
    /* 🎭 Shop Cast character — wearing swaps the rigged GLB hero itself */
    if (it.char) {
      const hero = glbCharDef(it.char);
      sfx.pickup();
      setLook({ char: it.char });
      pushToast(`${hero?.emoji ?? it.emoji} Wearing ${hero?.name ?? it.name} — looking sharp!`, "good");
    }
  };

  /** worn state = the preset's every look field matches, or the char slug does */
  const isWorn = (it: ShopItem) => {
    if (it.kind !== "style") return false;
    if (it.char) return look.char === it.char;
    const p = outfitPreset(it.presetId);
    return !!p && (Object.entries(p.look) as [keyof Appearance, unknown][]).every(([k, v]) => look[k] === v);
  };

  return (
    <div className="relative h-screen w-full overflow-y-auto overflow-x-hidden">
      {/* backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-lobby-night.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/65 to-slate-950/90" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 pb-28 lg:pb-8">
        {/* ---------- header: back · title · wallet ---------- */}
        <header className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm" onClick={() => { sfx.click(); setScreen("landing"); }}
            className="rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur hover:bg-black/50"
          >
            <ArrowLeft size={15} className="mr-1" /> Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)] sm:text-3xl">
              ITEM SHOP <span aria-hidden>🛒</span>
            </h1>
            <p className="hidden text-xs font-bold text-orange-300 sm:block">
              Spend the cash you banked in town — every purchase spawns with you, every run.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              title="Collected cash — banked from roaming the town. Spend it here!"
              className="flex items-center gap-1.5 rounded-[3px] border border-yellow-300/40 bg-yellow-400/15 px-2.5 py-1.5 backdrop-blur"
            >
              <span aria-hidden className="text-[13px] leading-none">💰</span>
              <span className="text-xs font-black tabular-nums text-yellow-300">${coins.toLocaleString()}</span>
              <span className="hidden text-[9px] font-bold uppercase text-yellow-200/70 sm:inline">CASH</span>
            </div>
            <div
              title="Purchases owned — they spawn with you every run"
              className="hidden items-center gap-1.5 rounded-[3px] border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1.5 backdrop-blur sm:flex"
            >
              <Check size={13} strokeWidth={3.5} className="text-emerald-300" />
              <span className="text-xs font-black tabular-nums text-emerald-200">{owned.length}</span>
              <span className="hidden text-[9px] font-bold uppercase text-emerald-200/70 md:inline">OWNED</span>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-5">
          {/* ---------- intro banner: how cash funds the shop ---------- */}
          <div className="rounded-xl border border-yellow-300/30 bg-yellow-400/10 px-3.5 py-2.5 text-[11px] font-bold leading-snug text-yellow-100 backdrop-blur">
            💰 Roam the town &amp; bank cash piles, purses and zombie hoards — every dollar
            funds this shop. Purchased gear spawns with you <b className="text-white">EVERY run</b>: press{" "}
            <b className="text-white">G</b> (or right-click) to open the 🎒 wheel and use it.
          </div>

          {/* ---------- one section per shop kind ---------- */}
          {SHOP_KINDS.map((sec) => {
            // 🐉 the Mythic Vault rides its own legendary section below — never in the kind grids
            const rows = SHOP_ITEMS.filter((it) => it.kind === sec.id && it.id !== RPG_VAULT_ITEM_ID);
            const ownCount = rows.filter((it) => owned.includes(it.id)).length;
            return (
              <section key={sec.id} aria-label={`${sec.label} — ${ownCount} of ${rows.length} owned`}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wider text-white/85 drop-shadow">
                    <span aria-hidden>{sec.emoji}</span> {sec.label}
                  </h2>
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/45">
                    {ownCount}/{rows.length} owned
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {rows.map((it) => {
                    const has = owned.includes(it.id);
                    const afford = coins >= it.price;
                    const worn = isWorn(it);
                    return (
                      <motion.div
                        key={it.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className={`flex flex-col gap-2.5 rounded-xl border p-3.5 backdrop-blur transition-colors ${
                          has ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/15 bg-white/5"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span aria-hidden className="w-12 shrink-0 text-center text-4xl leading-none">{it.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className="min-w-0 flex-1 text-sm font-black leading-tight text-white">{it.name}</span>
                              {has ? (
                                <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-200">
                                  <Check size={10} strokeWidth={3.5} /> owned
                                </span>
                              ) : (
                                <span className={`shrink-0 text-sm font-black ${afford ? "text-yellow-300" : "text-rose-300/80"}`}>
                                  ${it.price}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-white/55">{it.tip}</p>
                          </div>
                        </div>
                        <div className="mt-auto flex items-center justify-end">
                          {it.kind === "style" && has ? (
                            <button
                              onClick={() => wearPreset(it)}
                              aria-pressed={worn}
                              aria-label={worn ? `${it.name} — currently wearing it` : `Wear ${it.name}`}
                              className={`shrink-0 rounded-md px-3.5 py-2 text-[10px] font-black uppercase transition-colors ${
                                worn ? "bg-yellow-300/25 text-yellow-200" : "bg-yellow-400 text-slate-950 hover:bg-yellow-300"
                              }`}
                            >
                              {worn ? "✓ wearing" : "wear"}
                            </button>
                          ) : has ? (
                            <div className="shrink-0 rounded-md border border-emerald-300/30 px-2 py-2 text-center text-[9px] font-black uppercase leading-tight text-emerald-200/80">
                              in every run
                            </div>
                          ) : (
                            <button
                              onClick={() => buy(it)}
                              disabled={!afford}
                              aria-label={afford ? `Buy ${it.name} for $${it.price}` : `Not enough cash — ${it.name} costs $${it.price}`}
                              title={afford ? `Buy ${it.name} for $${it.price}` : `Not enough cash — ${it.name} costs $${it.price}`}
                              className={`shrink-0 rounded-md px-3.5 py-2 text-[10px] font-black uppercase transition-colors ${
                                afford
                                  ? "bg-orange-600 text-white hover:bg-orange-500"
                                  : "cursor-not-allowed bg-white/10 text-white/45"
                              }`}
                            >
                              {afford ? "buy" : "no cash"}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* ---------- 🐉 MYTHIC VAULT — the wallet's crown jewel ---------- */}
          {vault && (
            <section aria-label="Mythic Hero Vault">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wider text-white/85 drop-shadow">
                  <span aria-hidden>🐉</span> Mythic Vault
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-300/80">
                  {vaultOwned ? "unlocked — every rigged RPG hero" : "legendary · one purchase"}
                </span>
              </div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`rounded-xl border p-4 backdrop-blur ${
                  vaultOwned
                    ? "border-violet-300/50 bg-violet-500/15"
                    : "border-violet-400/35 bg-gradient-to-r from-violet-950/75 via-violet-900/50 to-fuchsia-900/40"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span aria-hidden className="shrink-0 text-5xl drop-shadow-[0_0_18px_rgba(167,139,250,0.6)] sm:text-6xl">🐉</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-black leading-tight text-white sm:text-lg">{vault.name}</span>
                      <span className="rounded-full bg-violet-400/25 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-200">
                        legendary
                      </span>
                      {!vaultOwned && (
                        <span className={`text-sm font-black ${coins >= vault.price ? "text-yellow-300" : "text-rose-300/80"}`}>
                          ${vault.price}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-white/70">{vault.tip}</p>
                    <p className="mt-1 text-[10px] font-bold leading-snug text-violet-200/80">
                      Purchase unlocks all rigged RPG heroes — wear any from here or the Locker&apos;s Hero tab.
                    </p>
                  </div>
                  {!vaultOwned && (
                    <button
                      onClick={() => buy(vault)}
                      disabled={coins < vault.price}
                      aria-label={coins >= vault.price ? `Buy ${vault.name} for $${vault.price}` : `Not enough cash — ${vault.name} costs $${vault.price}`}
                      title={coins >= vault.price ? `Buy ${vault.name} for $${vault.price}` : `Not enough cash — ${vault.name} costs $${vault.price}`}
                      className={`shrink-0 rounded-md px-3.5 py-2.5 text-[10px] font-black uppercase transition-colors ${
                        coins >= vault.price
                          ? "bg-violet-500 text-white shadow-[0_0_14px_rgba(139,92,246,0.45)] hover:bg-violet-400"
                          : "cursor-not-allowed bg-white/10 text-white/45"
                      }`}
                    >
                      {coins >= vault.price ? "buy" : "no cash"}
                    </button>
                  )}
                </div>

                {/* owned → wear any rigged RPG hero right here */}
                {vaultOwned && (
                  <div className="mt-3 border-t border-violet-300/20 pt-3">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-violet-200/80">
                      🐉 Rigged RPG heroes — {MYTHIC_HEROES.length} to wear
                    </div>
                    <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto [scrollbar-width:thin] sm:grid-cols-3 lg:grid-cols-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/25 [&::-webkit-scrollbar-track]:bg-transparent">
                      {MYTHIC_HEROES.map((hero) => {
                        const wornHero = look.char === hero.slug;
                        return (
                          <button
                            key={hero.slug}
                            onClick={() => {
                              sfx.pickup();
                              setLook({ char: hero.slug });
                              pushToast(`${hero.emoji} Wearing ${hero.name} — looking legendary!`, "good");
                            }}
                            aria-pressed={wornHero}
                            aria-label={`Wear ${hero.name}`}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                              wornHero
                                ? "border-yellow-300/70 bg-yellow-400/15 ring-1 ring-yellow-300/60"
                                : "border-white/15 bg-white/5 hover:border-violet-300/50 hover:bg-violet-500/15"
                            }`}
                          >
                            <span aria-hidden className="text-xl leading-none">{hero.emoji}</span>
                            <span className={`min-w-0 flex-1 truncate text-[11px] font-black ${wornHero ? "text-yellow-200" : "text-white/85"}`}>
                              {hero.name}
                            </span>
                            {wornHero && <Check size={12} strokeWidth={3.5} className="shrink-0 text-yellow-300" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            </section>
          )}

          {/* ---------- footer pointer ---------- */}
          <p className="px-1 text-[11px] font-bold text-white/45">
            Your full collection lives in the LOCKER — Items tab shows every purchase.
          </p>
        </main>
      </div>
    </div>
  );
}
