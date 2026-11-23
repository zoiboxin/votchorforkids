"use client";

import dynamic from "next/dynamic";

/* 🧪 dev diagnostic — ?block-storage=1 makes localStorage THROW like Safari
 * does inside cross-site / sandboxed iframes (the preview panel). Used to
 * verify the app boots without it; harmless without the flag. */
if (typeof window !== "undefined" && window.location.search.includes("block-storage")) {
  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("SecurityError: storage denied (simulated)", "SecurityError");
      },
    });
  } catch { /* ignore */ }
}

const GameRoot = dynamic(
  () => import("@/components/game/GameRoot").then((m) => m.GameRoot),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-950 to-indigo-950">
        <div className="animate-bounce rounded-2xl bg-white/10 px-6 py-3 text-lg font-black text-slate-100 shadow-xl ring-1 ring-white/20">
          7Nights is calling… 🌙
        </div>
      </div>
    ),
  },
);

export default function Home() {
  return <GameRoot />;
}
