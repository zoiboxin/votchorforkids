"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Design tokens shared across the control panel
// ---------------------------------------------------------------------------

export const PANEL = "rounded-xl border border-white/10 bg-slate-900/60";

export const SCROLLBAR =
  "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700/80 [&::-webkit-scrollbar-track]:bg-transparent";

export type Tone = "green" | "amber" | "red" | "slate" | "orange";

export const TONE_BADGE: Record<Tone, string> = {
  green: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  amber: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  red: "border-red-500/30 bg-red-500/15 text-red-400",
  slate: "border-white/15 bg-white/5 text-slate-400",
  orange: "border-orange-500/30 bg-orange-500/15 text-orange-400",
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={cn("size-4 animate-spin", className)} />;
}

export function StatusDot({
  ok,
  className,
}: {
  ok: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        ok ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]",
        ok && "animate-pulse",
        className
      )}
    />
  );
}

export function ToneBadge({
  tone,
  className,
  title,
  children,
}: {
  tone: Tone;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE_BADGE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300",
        className
      )}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          className="border-red-500/40 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function InfoBanner({
  icon: Icon,
  tone = "amber",
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const ring: Record<Tone, string> = {
    green: "border-emerald-500/25 bg-emerald-500/10",
    amber: "border-amber-500/25 bg-amber-500/10",
    red: "border-red-500/25 bg-red-500/10",
    slate: "border-white/10 bg-white/5",
    orange: "border-orange-500/25 bg-orange-500/10",
  };
  const iconTone: Record<Tone, string> = {
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
    slate: "text-slate-400",
    orange: "text-orange-400",
  };
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        ring[tone],
        className
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconTone[tone])} />
      <div className="min-w-0 flex-1 space-y-0.5 text-slate-300">
        {title ? <p className="font-medium text-slate-200">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

export function StatCard({
  icon: Icon,
  label,
  value,
  caption,
  tone = "orange",
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  caption?: string;
  tone?: Tone;
  className?: string;
}) {
  const iconTone: Record<Tone, string> = {
    green: "bg-emerald-500/10 text-emerald-400",
    amber: "bg-amber-500/10 text-amber-400",
    red: "bg-red-500/10 text-red-400",
    slate: "bg-white/5 text-slate-400",
    orange: "bg-orange-500/10 text-orange-400",
  };
  return (
    <div
      className={cn(
        PANEL,
        "flex items-center gap-4 px-4 py-4 transition-colors hover:border-white/20",
        className
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          iconTone[tone]
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p className="font-mono text-2xl font-semibold tabular-nums text-slate-100">
          {value}
        </p>
        {caption ? (
          <p className="truncate text-xs text-slate-500">{caption}</p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state + loading helpers
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className
      )}
    >
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5"
      >
        <Icon className="size-6 text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function SkeletonRows({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg bg-white/5" />
      ))}
    </div>
  );
}

export function SkeletonCards({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4",
        className
      )}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-xl bg-white/5" />
      ))}
    </div>
  );
}
