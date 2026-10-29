"use client";

import dynamic from "next/dynamic";

const GameRoot = dynamic(
  () => import("@/components/game/GameRoot").then((m) => m.GameRoot),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-400 to-emerald-400">
        <div className="animate-bounce rounded-2xl bg-white/85 px-6 py-3 text-lg font-black text-slate-800 shadow-xl">
          VoteChor is loading… 🏃‍♀️💨
        </div>
      </div>
    ),
  },
);

export default function Home() {
  return <GameRoot />;
}
