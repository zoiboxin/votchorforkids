"use client";

import * as React from "react";
import {
  CalendarRange,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  ShieldBan,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Admin, SectionId } from "./types";
import { StatusDot } from "./shared";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    subtitle: "Live overview of players, seasons and the NightLine relay",
  },
  {
    id: "seasons",
    label: "Seasons",
    icon: CalendarRange,
    title: "Seasons",
    subtitle: "Schedule the 27-season calendar — the current window goes live instantly",
  },
  {
    id: "players",
    label: "Players",
    icon: Users,
    title: "Players",
    subtitle: "Profiles, bans, chat mutes and moderation notes",
  },
  {
    id: "chat",
    label: "Chat Monitor",
    icon: MessagesSquare,
    title: "Chat Monitor",
    subtitle: "NightLine live feed — review, delete and broadcast",
  },
  {
    id: "words",
    label: "Word Filter",
    icon: ShieldBan,
    title: "Word Filter",
    subtitle: "Blocked and flagged keywords with strike-based auto-mute",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    title: "Settings",
    subtitle: "Admin account, password and session details",
  },
];

function useIsLg(): boolean {
  const [isLg, setIsLg] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLg(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isLg;
}

interface ShellProps {
  admin: Admin;
  section: SectionId;
  onSectionChange: (s: SectionId) => void;
  onLogout: () => void;
  onRefresh: () => void;
  online: number | null;
  relayOk: boolean | null;
  children: React.ReactNode;
}

export function Shell({
  admin,
  section,
  onSectionChange,
  onLogout,
  onRefresh,
  online,
  relayOk,
  children,
}: ShellProps) {
  const isLg = useIsLg();
  const [collapsedOverride, setCollapsedOverride] = React.useState<boolean | null>(null);
  const [spinning, setSpinning] = React.useState(false);

  // Auto-collapse to icons at md widths unless the user explicitly toggled.
  const collapsed = collapsedOverride ?? !isLg;

  const active = NAV_ITEMS.find((n) => n.id === section) ?? NAV_ITEMS[0];

  function handleRefresh() {
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 700);
    onRefresh();
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      {/* ---------------- Sidebar (md and up) ---------------- */}
      <aside
        data-collapsed={collapsed}
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/10 bg-slate-950/95 transition-[width] duration-200 md:flex",
          collapsed ? "w-14" : "w-56"
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-16 items-center border-b border-white/10",
            collapsed ? "justify-center px-2" : "gap-2.5 px-4"
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
            <MoonStar className="size-4 text-white" aria-hidden="true" />
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-slate-100">7Nights</p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Control Panel
              </p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav
          aria-label="Admin sections"
          className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}
        >
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === section;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSectionChange(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex w-full items-center rounded-lg text-sm font-medium transition-colors",
                      collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
                      isActive
                        ? "bg-orange-500/15 text-orange-400"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute left-0 h-5 w-0.5 rounded-r bg-orange-500",
                          collapsed && "hidden"
                        )}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer: admin identity */}
        <div className={cn("border-t border-white/10 p-3", collapsed && "px-2")}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-orange-500/15 text-sm font-semibold text-orange-400"
              >
                {admin.email.charAt(0).toUpperCase()}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onLogout}
                aria-label="Log out"
                className="text-slate-400 hover:text-red-400"
              >
                <LogOut className="size-4" aria-hidden="true" />
              </Button>
              <a
                href="/"
                target="_top"
                aria-label="Open game"
                title="Open game"
                className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-sm font-semibold text-orange-400"
                >
                  {admin.email.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-300" title={admin.email}>
                    {admin.email}
                  </p>
                  <span className="mt-0.5 inline-flex rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-orange-400">
                    {admin.role}
                  </span>
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLogout}
                  className="flex-1 justify-start gap-2 text-slate-400 hover:text-red-400"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Log out
                </Button>
                <a
                  href="/"
                  target="_top"
                  aria-label="Open game"
                  title="Open game"
                  className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- Main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 md:px-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsedOverride(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden text-slate-400 hover:text-slate-200 md:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              )}
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold text-slate-100 md:text-lg">
                {active.title}
              </h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block">
                {active.subtitle}
              </p>
            </div>

            {/* Chat online pill */}
            <div aria-live="polite">
              {online !== null ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
                  <StatusDot ok />
                  {online} online
                </span>
              ) : relayOk === false ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400">
                  <StatusDot ok={false} />
                  Relay offline
                </span>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              aria-label="Refresh data"
              className="text-slate-400 hover:text-slate-200"
            >
              <RefreshCw
                className={cn("size-4", spinning && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          </div>

          {/* Mobile horizontal tab bar */}
          <nav
            aria-label="Admin sections"
            className={cn(
              "flex gap-1 overflow-x-auto px-3 pb-2 md:hidden",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            )}
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSectionChange(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-orange-500/15 text-orange-400"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[110rem] flex-1 px-4 py-5 md:px-6 md:py-6">
          {children}
        </main>

        <footer className="mt-auto border-t border-white/10 px-6 py-4">
          <p className="text-center text-[11px] text-slate-600">
            7Nights Control Panel · internal administration tool · not part of the game
          </p>
        </footer>
      </div>
    </div>
  );
}
