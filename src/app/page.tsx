"use client";

import dynamic from "next/dynamic";

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
