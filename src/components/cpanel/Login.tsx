"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, MoonStar, ShieldAlert } from "lucide-react";

import { api, ApiError } from "./api";
import type { Admin } from "./types";
import { PANEL } from "./shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginProps {
  onLoggedIn: (admin: Admin) => void;
}

export function Login({ onLoggedIn }: LoginProps) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email.trim(), password);
      // Fetch the full profile (includes lastLogin) right after signing in.
      const me = await api.me();
      onLoggedIn(me.admin);
    } catch (err) {
      const message =
        err instanceof ApiError && err.message
          ? err.message
          : "Sign-in failed. Please try again.";
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-200"
      style={{ colorScheme: "dark" }}
    >
      {/* Ambient ember glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-orange-600/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-900/40">
            <MoonStar className="size-7 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">
              7Nights Control Panel
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Zombie battle-royale administration
            </p>
          </div>
        </div>

        <div className={PANEL}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-6">
            <div className="space-y-2">
              <Label htmlFor="admin-email" className="text-slate-300">
                Email
              </Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
                className="border-white/10 bg-slate-950/60 text-slate-100 placeholder:text-slate-600"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-password" className="text-slate-300">
                Password
              </Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
                className="border-white/10 bg-slate-950/60 text-slate-100 placeholder:text-slate-600"
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-orange-500 text-white hover:bg-orange-600"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>

            <p className="text-center text-xs text-slate-500">
              Default: info@zoibox.com · Admin@595965
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-600">
          Sessions are cookie-based and expire automatically.
        </p>
      </motion.div>
    </div>
  );
}
