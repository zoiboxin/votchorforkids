"use client";

import dynamic from "next/dynamic";
import { BootScreen } from "@/components/game/BootScreen";

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
    loading: () => <BootScreen />,
  },
);

export default function Home() {
  return <GameRoot />;
}
