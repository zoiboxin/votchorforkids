"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MoonStar } from "lucide-react";

import { api, setUnauthorizedHandler } from "./api";
import type { Admin, SectionId } from "./types";
import { Login } from "./Login";
import { Shell } from "./Shell";
import { DashboardTab } from "./DashboardTab";
import { SeasonsTab } from "./SeasonsTab";
import { PlayersTab } from "./PlayersTab";
import { ChatTab } from "./ChatTab";
import { WordsTab } from "./WordsTab";
import { SettingsTab } from "./SettingsTab";

type View = "checking" | "login" | "panel";

const STATS_PULSE_MS = 60000;

export function CPanelApp() {
  const [view, setView] = React.useState<View>("checking");
  const [admin, setAdmin] = React.useState<Admin | null>(null);
  const [section, setSection] = React.useState<SectionId>("dashboard");
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [online, setOnline] = React.useState<number | null>(null);
  const [relayOk, setRelayOk] = React.useState<boolean | null>(null);

  // Force the app-wide dark theme (also powers portal/dialog theming).
  React.useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, []);

  const handleUnauthorized = React.useCallback(() => {
    setAdmin(null);
    setView("login");
  }, []);

  // Bootstrap: register the central 401 handler and restore the session.
  React.useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setAdmin(me.admin);
        setView("panel");
      } catch {
        if (cancelled) return;
        setAdmin(null);
        setView("login");
      }
    })();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [handleUnauthorized]);

  // Lightweight stats pulse for the topbar pill (also refreshes on demand).
  const pulse = React.useCallback(async () => {
    try {
      const d = await api.getStats();
      setOnline(d.stats.chat.online);
      setRelayOk(d.stats.chat.relay);
    } catch {
      // 401 is handled centrally; other failures just keep the last known pill.
    }
  }, []);

  React.useEffect(() => {
    if (view !== "panel") return;
    void pulse();
    const id = window.setInterval(() => void pulse(), STATS_PULSE_MS);
    return () => window.clearInterval(id);
  }, [view, pulse, refreshTick]);

  const handleLoggedIn = React.useCallback((a: Admin) => {
    setAdmin(a);
    setSection("dashboard");
    setView("panel");
  }, []);

  const handleLogout = React.useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Session may already be gone — clear locally regardless.
    }
    setAdmin(null);
    setView("login");
  }, []);

  const handleRefresh = React.useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  if (view === "checking") {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-300"
        style={{ colorScheme: "dark" }}
      >
        <div className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600">
          <MoonStar className="size-6 text-white" aria-hidden="true" />
        </div>
        <p className="text-sm text-slate-400" role="status" aria-live="polite">
          Restoring admin session…
        </p>
      </div>
    );
  }

  if (view === "login" || !admin) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  return (
    <Shell
      admin={admin}
      section={section}
      onSectionChange={setSection}
      onLogout={() => void handleLogout()}
      onRefresh={handleRefresh}
      online={online}
      relayOk={relayOk}
    >
      <motion.div
        key={section}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        {section === "dashboard" ? (
          <DashboardTab refreshTick={refreshTick} onNavigate={setSection} />
        ) : section === "seasons" ? (
          <SeasonsTab refreshTick={refreshTick} />
        ) : section === "players" ? (
          <PlayersTab refreshTick={refreshTick} />
        ) : section === "chat" ? (
          <ChatTab refreshTick={refreshTick} />
        ) : section === "words" ? (
          <WordsTab refreshTick={refreshTick} />
        ) : (
          <SettingsTab admin={admin} />
        )}
      </motion.div>
    </Shell>
  );
}
