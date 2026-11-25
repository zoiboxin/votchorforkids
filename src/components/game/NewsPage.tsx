"use client";

/**
 * NewsPage — the full-page 📰 NIGHT LINE NEWSROOM.
 *
 * Featured hero article (big gradient banner), category filter chips
 * (All / Events / Patch / Community / Dev), the structured news grid from
 * src/lib/game/news.ts, a "Night Line" ticker marquee, patch-notes digest
 * and the game ad carousel. All content reads real build landmarks —
 * garage drop, possession nights, shop 2.0, railway rebake, lobby chat.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Newspaper, Radio } from "lucide-react";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { NEWS_ITEMS, NEWS_TAG_META, NEWS_TICKER, type NewsTag } from "@/lib/game/news";
import { AdCarousel, PageShell, Panel, Strip } from "./PageKit";

type Filter = "all" | NewsTag;

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "event", label: "Events" },
  { id: "patch", label: "Patch notes" },
  { id: "community", label: "Community" },
  { id: "dev", label: "Dev notes" },
];

export function NewsPage() {
  const setScreen = useGame((s) => s.setScreen);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState(0);

  const featured = NEWS_ITEMS.find((n) => n.featured) ?? NEWS_ITEMS[0];
  const rest = useMemo(() => {
    const list = NEWS_ITEMS.filter((n) => n.id !== featured.id);
    return filter === "all" ? list : list.filter((n) => n.tag === filter);
  }, [featured, filter]);

  /* the ticker rotates through lines like a newsroom crawl */
  useEffect(() => {
    const t = setInterval(() => setMarquee((m) => (m + 1) % NEWS_TICKER.length), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <PageShell
      title="NIGHT LINE NEWS"
      emoji="📰"
      subtitle="Dispatches, patch notes and events from the town that never truly sleeps."
      screen="news"
    >
      <AdCarousel placement="news" />

      {/* ---------- ticker marquee ---------- */}
      <section aria-label="Night Line ticker" className="flex items-center gap-2 overflow-hidden rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 backdrop-blur">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-red-200 ring-1 ring-red-300/40">
          <Radio size={11} className="animate-pulse" /> live ticker
        </span>
        <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
          {NEWS_TICKER.map((line, i) => (
            <motion.p
              key={i}
              aria-hidden={i !== marquee}
              className={`absolute inset-0 truncate text-[11px] font-bold text-red-100/90 transition-all duration-500 ${i === marquee ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"}`}
            >
              {line}
            </motion.p>
          ))}
        </div>
      </section>

      {/* ---------- featured article ---------- */}
      <motion.section
        key={featured.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="relative overflow-hidden rounded-2xl border border-white/20 shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
      >
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-rose-950/90 via-slate-950/92 to-fuchsia-950/85" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(244,63,94,0.25),transparent_55%),radial-gradient(circle_at_10%_80%,rgba(217,70,239,0.18),transparent_50%)]" />
        <div className="relative flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] ring-1 ${NEWS_TAG_META[featured.tag].chip}`}>
              {NEWS_TAG_META[featured.tag].label}
            </span>
            <span className="rounded-full bg-black/45 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/75 ring-1 ring-white/25">
              {featured.at} · top story
            </span>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <motion.span
              aria-hidden
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-black/35 text-5xl ring-2 ring-white/25"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              style={{ boxShadow: "0 0 30px rgba(244,63,94,0.45)" }}
            >
              {featured.emoji}
            </motion.span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-black uppercase leading-tight tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.4)] sm:text-2xl">
                {featured.title}
              </h2>
              <p className={`mt-2 text-[11px] font-bold leading-relaxed text-white/75 sm:text-xs ${openId === featured.id ? "" : "line-clamp-2"}`}>
                {featured.body}
              </p>
              <button
                onClick={() => { sfx.click(); setOpenId(openId === featured.id ? null : featured.id); }}
                className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-black/45 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white ring-1 ring-white/30 backdrop-blur transition-colors hover:bg-black/65"
              >
                {openId === featured.id ? "show less" : "read full story"} <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ---------- filter chips ---------- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => { sfx.click(); setFilter(f.id); }}
            aria-pressed={filter === f.id}
            className={`rounded-[3px] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${
              filter === f.id
                ? "bg-yellow-400 text-slate-950 shadow-[0_2px_0_rgba(161,98,7,0.5)]"
                : "bg-slate-950/85 text-white/70 ring-1 ring-white/15 hover:bg-slate-800/90 hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-1 text-[9px] font-black uppercase tracking-wider text-white/40 sm:flex">
          <Newspaper size={11} /> {rest.length + (filter === "all" ? 0 : NEWS_ITEMS.filter((n) => n.tag === filter && n.id === featured.id).length)} article{rest.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* ---------- news grid ---------- */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rest.map((n, i) => {
          const open = openId === n.id;
          return (
            <motion.article
              key={n.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, delay: Math.min(0.25, i * 0.04) }}
              className="flex flex-col overflow-hidden rounded-xl border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md transition-colors hover:border-white/25"
            >
              <div className="flex items-center gap-3 px-3.5 pt-3.5">
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/35 text-2xl ring-1 ring-white/15"
                >
                  {n.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] ring-1 ${NEWS_TAG_META[n.tag].chip}`}>
                      {NEWS_TAG_META[n.tag].label}
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-wider text-white/40">{n.at}</span>
                  </div>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3.5">
                <h3 className="mt-2 text-xs font-black uppercase leading-snug tracking-wide text-white/90">{n.title}</h3>
                <p className={`mt-1.5 flex-1 text-[11px] font-bold leading-relaxed text-white/60 ${open ? "" : "line-clamp-3"}`}>
                  {n.body}
                </p>
                <button
                  onClick={() => { sfx.click(); setOpenId(open ? null : n.id); }}
                  className="mt-2.5 inline-flex w-fit items-center gap-1 text-[10px] font-black uppercase tracking-wider text-yellow-300 transition-colors hover:text-yellow-200"
                  aria-expanded={open}
                >
                  {open ? "show less" : "read more"} <ChevronRight size={12} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
                </button>
              </div>
            </motion.article>
          );
        })}
      </div>

      {/* ---------- patch digest + ad ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <Strip right={<span className="text-[10px] font-black text-white/85">build highlights</span>}>
            Patch digest — this month
          </Strip>
          <div className="space-y-1.5 p-2.5 text-[11px] font-bold leading-relaxed text-white/70">
            <p>🛠️ <b className="text-white/90">World</b> — railway rebaked (chunked async bake, skinned mesh merge fix), station always lands, ~465 sections smooth.</p>
            <p>🎮 <b className="text-white/90">Gameplay</b> — zombie possession nights: one random soul turns at dusk, survivors continue to dawn, police killable.</p>
            <p>🛒 <b className="text-white/90">Economy</b> — shop 2.0 with 3D preview stage, 18 shop-cast heroes + 10 vehicles priced 1 coin per triangle.</p>
            <p>💬 <b className="text-white/90">Social</b> — global lobby chat on its own relay, unseen badges, full history catch-up.</p>
          </div>
        </Panel>
        <Panel>
          <Strip>Community board</Strip>
          <div className="space-y-1.5 p-2.5 text-[11px] font-bold leading-relaxed text-white/70">
            <p>🔥 Longest streak holder — keep the daily flame alive to see your name here.</p>
            <p>🏆 The Hall of Fame refreshes with every finished night — <button onClick={() => { sfx.click(); setScreen("career"); }} className="text-yellow-300 underline decoration-dotted hover:text-yellow-200">check your standing</button>.</p>
            <p>🎟️ Season quests pay once per season — <button onClick={() => { sfx.click(); setScreen("challenges"); }} className="text-yellow-300 underline decoration-dotted hover:text-yellow-200">claim what you&apos;ve earned</button>.</p>
            <p>🌙 New to town? The <button onClick={() => { sfx.click(); setScreen("landing"); }} className="text-yellow-300 underline decoration-dotted hover:text-yellow-200">lobby</button> drops you straight into tonight&apos;s 100-soul session.</p>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
