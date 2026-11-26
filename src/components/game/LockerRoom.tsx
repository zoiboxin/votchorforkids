"use client";

/**
 * 🎒 THE LOCKER ROOM — the PUBG-style loadout hub.
 *
 * Every item PURCHASED in the Item Shop lives here, and YOU decide what rides
 * into the next match: toggle anything off and the game spawns without it,
 * toggle it back on and it's in your pockets again. New purchases arrive
 * equipped (nothing silently vanishes for existing players).
 *
 *   • GEAR (🪓🔨🔧🗡️⚔️…)      → belt tools on the 🎒 wheel (G / right-click)
 *   • POWERS (⚡🦘🧲🌀)        → pocketed gems, unleash from the wheel
 *   • SUPPORT (🩹🍰🥪🪪)      → hotbar snacks + the VIP driving license
 *   • GARAGE (🏍️🏎️🚓…)       → rides parked beside you every run
 *   • STYLE (👕🐉…)           → outfits & rigged cast heroes — worn, not equipped
 *
 * Equipping is a LOCAL promise: the engine's grantLockerGear reads exactly
 * this list at every match boot (and every restart-together), so what you
 * see here is what you carry in-game.
 */

import { useMemo } from "react";
import { ArrowLeft, Check, CircleSlash, PackageOpen, ShieldCheck, Shirt, Sparkles, Store, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { gearSummary, outfitPreset, ownedGear, shopItem, type ShopItem } from "@/lib/game/shop";
import { glbCharDef } from "@/lib/game/glbCharacters";
import { ITEMS, TOOLS, POWERS, VEHICLE_LABELS, type Appearance } from "@/lib/game/constants";

/* ---------- one loadout card (equip toggle) ---------- */
function GearCard({ it, equipped, onToggle }: { it: ShopItem; equipped: boolean; onToggle: () => void }) {
  const powerDef = it.power ? POWERS.find((p) => p.kind === it.power) : null;
  const toolDef = it.tool ? TOOLS.find((t) => t.kind === it.tool) : null;
  const snackDef = it.snack ? ITEMS[it.snack.def] : null;
  const vehLabel = it.veh != null ? VEHICLE_LABELS[it.veh % VEHICLE_LABELS.length] : null;
  const sub = toolDef?.name ?? powerDef?.name ?? snackDef?.name ?? vehLabel ?? (it.license ? "Drive any parked car" : "");
  return (
    <button
      role="checkbox"
      aria-checked={equipped}
      onClick={onToggle}
      className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border p-2.5 text-left transition-all ${
        equipped
          ? "border-emerald-300/40 bg-emerald-400/12 shadow-[0_0_14px_rgba(52,211,153,0.12)] hover:bg-emerald-400/20"
          : "border-white/12 bg-slate-950/55 hover:border-white/30 hover:bg-slate-900/70"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl ${
          equipped ? "bg-emerald-400/25" : "bg-white/8 grayscale-[0.4]"
        }`}
      >
        {it.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-black leading-tight text-white">{it.name}</span>
        {sub && <span className="block truncate text-[10px] font-semibold text-white/55">{sub}</span>}
      </span>
      <span
        className={`flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[9px] font-black uppercase tracking-wider ${
          equipped ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white/50"
        }`}
      >
        {equipped ? <Check size={10} strokeWidth={4} /> : <X size={10} strokeWidth={4} />}
        {equipped ? "equipped" : "off"}
      </span>
    </button>
  );
}

/* ---------- one style card (wear action) ---------- */
function StyleCard({ it, worn, onWear }: { it: ShopItem; worn: boolean; onWear: () => void }) {
  const hero = it.char ? glbCharDef(it.char) : null;
  return (
    <div
      className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 transition-colors ${
        worn ? "border-violet-300/45 bg-violet-400/12" : "border-white/12 bg-slate-950/55"
      }`}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/8 text-xl"
      >
        {hero?.emoji ?? it.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-black leading-tight text-white">{hero?.name ?? it.name}</span>
        <span className="block truncate text-[10px] font-semibold text-white/55">
          {hero ? "Rigged Polyfork hero" : "Outfit preset"}
        </span>
      </span>
      {worn ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-violet-400 px-2.5 py-1 text-[9px] font-black uppercase text-slate-950">
          <Shirt size={10} strokeWidth={3.5} /> worn
        </span>
      ) : (
        <Button
          size="sm"
          onClick={onWear}
          className="h-7 rounded-full bg-violet-500/90 px-3 text-[10px] font-black uppercase text-white hover:bg-violet-400"
        >
          Wear
        </Button>
      )}
    </div>
  );
}

export function LockerRoom() {
  const setScreen = useGame((s) => s.setScreen);
  const owned = useGame((s) => s.owned);
  const loadout = useGame((s) => s.loadout);
  const toggleEquip = useGame((s) => s.toggleEquip);
  const equipAll = useGame((s) => s.equipAll);
  const unequipAll = useGame((s) => s.unequipAll);
  const coins = useGame((s) => s.coins);
  const look = useGame((s) => s.look);
  const setLook = useGame((s) => s.setLook);
  const playerName = useGame((s) => s.playerName);
  const pushToast = useGame((s) => s.pushToast);

  /* purchased items by locker section */
  const gear = useMemo(
    () => owned.map((id) => shopItem(id)).filter((it): it is ShopItem => !!it && it.kind === "gear"),
    [owned],
  );
  const powers = useMemo(
    () => owned.map((id) => shopItem(id)).filter((it): it is ShopItem => !!it && it.kind === "power"),
    [owned],
  );
  const support = useMemo(
    () => owned.map((id) => shopItem(id)).filter((it): it is ShopItem => !!it && it.kind === "support" && !!(it.snack || it.license)),
    [owned],
  );
  const garage = useMemo(
    () => owned.map((id) => shopItem(id)).filter((it): it is ShopItem => !!it && it.kind === "garage"),
    [owned],
  );
  const styles = useMemo(
    () => owned.map((id) => shopItem(id)).filter((it): it is ShopItem => !!it && it.kind === "style"),
    [owned],
  );

  /* the exact loadout that will spawn in-game (engine reads the same list) */
  const equippedGear = useMemo(() => ownedGear(loadout), [loadout]);
  const summary = useMemo(() => gearSummary(equippedGear), [equippedGear]);
  const equippedCount = loadout.filter((id) => owned.includes(id)).length;

  const toggle = (it: ShopItem) => {
    sfx.click();
    const was = loadout.includes(it.id);
    toggleEquip(it.id);
    pushToast(
      was
        ? `${it.emoji} ${it.name} left in the locker — hunt it in the world instead.`
        : `${it.emoji} ${it.name} equipped — it spawns with you every run!`,
      was ? "info" : "good",
    );
  };

  /** 👕 wear a purchased style (preset paint or rigged cast hero) */
  const wear = (it: ShopItem) => {
    const p = outfitPreset(it.presetId);
    if (p) {
      sfx.pickup();
      setLook(p.look);
      pushToast(`${it.emoji} Wearing ${it.name} — fresh fit!`, "good");
      return;
    }
    if (it.char) {
      const hero = glbCharDef(it.char);
      sfx.pickup();
      setLook({ char: it.char });
      pushToast(`${hero?.emoji ?? it.emoji} Wearing ${hero?.name ?? it.name} — looking sharp!`, "good");
    }
  };

  const isWornItem = (it: ShopItem): boolean => {
    if (it.char) return look.char === it.char;
    const p = outfitPreset(it.presetId);
    return !!p && (Object.entries(p.look) as [keyof Appearance, unknown][]).every(([k, v]) => look[k] === v);
  };

  const hasAny = gear.length + powers.length + support.length + garage.length + styles.length > 0;

  return (
    <div className="relative h-screen w-full overflow-y-auto overflow-x-hidden">
      {/* backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div aria-hidden className="fixed inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/hero-lobby-night.png)" }} />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/65 to-slate-950/90" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 pb-28 lg:pb-8">
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
              LOCKER ROOM <span aria-hidden>🎒</span>
            </h1>
            <p className="hidden text-xs font-bold text-emerald-300 sm:block">
              Pick what rides into the match — PUBG-style. Everything purchased lives here; you choose what spawns with you.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              title="Equipped purchases — they spawn with you every run"
              className="flex items-center gap-1.5 rounded-[3px] border border-emerald-300/40 bg-emerald-400/12 px-2.5 py-1.5 backdrop-blur"
            >
              <ShieldCheck size={13} className="text-emerald-300" />
              <span className="text-xs font-black tabular-nums text-emerald-200">{equippedCount}<span className="text-emerald-200/60">/{owned.length}</span></span>
              <span className="hidden text-[9px] font-bold uppercase text-emerald-200/70 sm:inline">EQUIPPED</span>
            </div>
            <div
              title="Collected cash — banked from roaming the town. Spend it in the Item Shop!"
              className="flex items-center gap-1.5 rounded-[3px] border border-yellow-300/40 bg-yellow-400/15 px-2.5 py-1.5 backdrop-blur"
            >
              <span aria-hidden className="text-[13px] leading-none">💰</span>
              <span className="text-xs font-black tabular-nums text-yellow-300">${coins.toLocaleString()}</span>
            </div>
          </div>
        </header>

        {/* ---------- next-run loadout summary ---------- */}
        <section
          aria-label="Next match loadout"
          className="rounded-2xl border border-emerald-300/25 bg-gradient-to-r from-emerald-400/12 via-slate-950/55 to-slate-950/55 p-4 backdrop-blur"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-300">
              <PackageOpen size={14} /> spawns with you next run
            </span>
            <span className="text-[13px] font-black text-white">
              {summary || "Nothing equipped — you'll hunt the world for gear!"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => { sfx.pickup(); equipAll(); pushToast("🎒 Full loadout equipped — everything you own rides into the match!", "good"); }}
              className="h-8 rounded-full bg-emerald-500 px-3.5 text-[11px] font-black uppercase text-white hover:bg-emerald-400"
            >
              <Check size={13} className="mr-1" strokeWidth={3.5} /> Equip all
            </Button>
            <Button
              size="sm"
              onClick={() => { sfx.click(); unequipAll(); pushToast("🫣 Traveling light — every pocket is empty. The world provides!", "info"); }}
              className="h-8 rounded-full border border-white/20 bg-black/40 px-3.5 text-[11px] font-black uppercase text-white/80 hover:bg-black/60"
            >
              <CircleSlash size={13} className="mr-1" /> Unequip all
            </Button>
            <Button
              size="sm"
              onClick={() => { sfx.click(); setScreen("creator"); }}
              className="h-8 rounded-full border border-white/20 bg-black/40 px-3.5 text-[11px] font-black uppercase text-white/80 hover:bg-black/60"
            >
              <Sparkles size={13} className="mr-1" /> Edit survivor
            </Button>
          </div>
        </section>

        {!hasAny ? (
          /* ---------- empty locker ---------- */
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-white/12 bg-slate-950/60 px-6 py-14 text-center backdrop-blur">
            <span aria-hidden className="text-5xl">🎒</span>
            <h2 className="text-lg font-black text-white">Your locker is empty</h2>
            <p className="max-w-md text-xs font-semibold leading-relaxed text-white/60">
              Buy gear, powers, snacks, licenses, rides and styles in the Item Shop — every purchase lands here,
              and you pick what spawns with you each match.
            </p>
            <Button
              onClick={() => { sfx.click(); setScreen("shop"); }}
              className="mt-1 rounded-full bg-orange-600 px-5 py-2.5 text-xs font-black uppercase text-white hover:bg-orange-500"
            >
              <Store size={14} className="mr-1.5" /> Open the Item Shop
            </Button>
          </section>
        ) : (
          <>
            {/* ---------- GEAR ---------- */}
            {gear.length > 0 && (
              <section aria-label="Belt tools">
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white/70">
                  <Wrench size={13} className="text-amber-300" /> Gear — belt tools <span className="font-bold normal-case tracking-normal text-white/40">(🎒 wheel · G)</span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {gear.map((it) => <GearCard key={it.id} it={it} equipped={loadout.includes(it.id)} onToggle={() => toggle(it)} />)}
                </div>
              </section>
            )}

            {/* ---------- POWERS ---------- */}
            {powers.length > 0 && (
              <section aria-label="Power gems">
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white/70">
                  <Sparkles size={13} className="text-cyan-300" /> Powers — pocketed gems <span className="font-bold normal-case tracking-normal text-white/40">(single-use)</span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {powers.map((it) => <GearCard key={it.id} it={it} equipped={loadout.includes(it.id)} onToggle={() => toggle(it)} />)}
                </div>
              </section>
            )}

            {/* ---------- SUPPORT ---------- */}
            {support.length > 0 && (
              <section aria-label="Snacks and license">
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white/70">
                  <ShieldCheck size={13} className="text-rose-300" /> Support — snacks &amp; license <span className="font-bold normal-case tracking-normal text-white/40">(hotbar 1–8)</span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {support.map((it) => <GearCard key={it.id} it={it} equipped={loadout.includes(it.id)} onToggle={() => toggle(it)} />)}
                </div>
              </section>
            )}

            {/* ---------- GARAGE ---------- */}
            {garage.length > 0 && (
              <section aria-label="Garage rides">
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white/70">
                  <span aria-hidden>🏪</span> Garage — your rides <span className="font-bold normal-case tracking-normal text-white/40">(parked at your drop · 🪪 + E)</span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {garage.map((it) => <GearCard key={it.id} it={it} equipped={loadout.includes(it.id)} onToggle={() => toggle(it)} />)}
                </div>
              </section>
            )}

            {/* ---------- STYLE ---------- */}
            {styles.length > 0 && (
              <section aria-label="Outfits and heroes">
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white/70">
                  <Shirt size={13} className="text-violet-300" /> Style — outfits &amp; heroes <span className="font-bold normal-case tracking-normal text-white/40">(worn, not equipped)</span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {styles.map((it) => (
                    <StyleCard key={it.id} it={it} worn={isWornItem(it)} onWear={() => wear(it)} />
                  ))}
                </div>
              </section>
            )}

            {/* ---------- survivor strip ---------- */}
            <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/12 bg-slate-950/55 px-4 py-3 backdrop-blur">
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/8 text-2xl"
              >
                {glbCharDef(look.char)?.emoji ?? "🧍"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-white">{playerName || "Survivor"}</div>
                <div className="truncate text-[11px] font-semibold text-white/55">
                  {glbCharDef(look.char)?.name ?? "Custom survivor — edit the fit in the creator"}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => { sfx.click(); setScreen("creator"); }}
                className="h-8 rounded-full border border-white/20 bg-black/40 px-3.5 text-[11px] font-black uppercase text-white/80 hover:bg-black/60"
              >
                <Sparkles size={13} className="mr-1" /> Customize
              </Button>
            </section>
          </>
        )}

        {/* ---------- shop cross-link ---------- */}
        {hasAny && (
          <button
            onClick={() => { sfx.click(); setScreen("shop"); }}
            className="group flex items-center gap-3 rounded-2xl border border-orange-400/30 bg-orange-500/12 px-4 py-3 text-left backdrop-blur transition-colors hover:bg-orange-500/22"
          >
            <span aria-hidden className="text-2xl">🛒</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-black text-white">Missing something? The Item Shop restocks you.</span>
              <span className="block text-[11px] font-semibold text-orange-200/80">
                Belt tools · power gems · snacks · the 🪪 license · garage rides · styles — all spawn-with-you purchases.
              </span>
            </span>
            <ArrowLeft size={15} className="shrink-0 rotate-180 text-orange-300 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>
    </div>
  );
}
