"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  Info,
  KeyRound,
  Mail,
  ShieldCheck,
} from "lucide-react";

import { api, fmtDateTime, relTime } from "./api";
import type { Admin } from "./types";
import { ErrorBanner, InfoBanner, PANEL } from "./shared";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface SettingsTabProps {
  admin: Admin;
}

export function SettingsTab({ admin }: SettingsTabProps) {
  const { toast } = useToast();

  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit =
    current.length > 0 && next.length >= 8 && next === confirm && !submitting;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      await api.changePassword(current, next);
      toast({ title: "Password updated", description: "Use the new password at next sign-in." });
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Password change failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Account card */}
      <motion.section
        aria-label="Admin account"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className={PANEL}>
          <div className="space-y-5 p-6">
            <div className="flex items-center gap-4">
              <div
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-full bg-orange-500/15 text-lg font-semibold text-orange-400"
              >
                {admin.email.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-100">{admin.name}</p>
                <p className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{admin.email}</span>
                </p>
              </div>
              <span className="ml-auto inline-flex rounded border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-orange-400">
                {admin.role}
              </span>
            </div>

            <Separator className="bg-white/10" />

            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-400">
                  <Clock className="size-4 text-slate-500" aria-hidden="true" />
                  Last login
                </dt>
                <dd className="text-right text-slate-200">
                  {admin.lastLogin ? fmtDateTime(admin.lastLogin) : "This is your first session"}
                  {admin.lastLogin ? (
                    <span className="ml-2 text-xs text-slate-500">
                      ({relTime(admin.lastLogin)})
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-400">
                  <ShieldCheck className="size-4 text-slate-500" aria-hidden="true" />
                  Session
                </dt>
                <dd className="text-right text-slate-200">
                  Cookie-based · expires with the browser session
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-400">
                  <Info className="size-4 text-slate-500" aria-hidden="true" />
                  Admin ID
                </dt>
                <dd className="font-mono text-xs text-slate-400">{admin.id}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-4">
          <InfoBanner icon={Info} tone="amber">
            <p>
              Default credentials are seeded on first boot
              (<span className="font-mono text-xs">info@zoibox.com · Admin@595965</span>).
              If you are still using them, change the password now.
            </p>
          </InfoBanner>
        </div>
      </motion.section>

      {/* Change password */}
      <motion.section
        aria-label="Change password"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className={PANEL}>
          <form onSubmit={submit} className="space-y-5 p-6">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-orange-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-200">Change password</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-slate-300">
                Current password
              </Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={submitting}
                className="border-white/10 bg-slate-950/60 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-slate-300">
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={submitting}
                aria-invalid={tooShort}
                className="border-white/10 bg-slate-950/60 text-slate-100"
              />
              {tooShort ? (
                <p className="text-xs text-amber-400">At least 8 characters required.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-slate-300">
                Confirm new password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
                aria-invalid={mismatch}
                className="border-white/10 bg-slate-950/60 text-slate-100"
              />
              {mismatch ? (
                <p className="text-xs text-red-400">Passwords do not match.</p>
              ) : null}
            </div>

            {formError ? <ErrorBanner message={formError} /> : null}

            {saved ? (
              <p
                role="status"
                className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400"
              >
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                Password updated — the new password is active immediately.
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-orange-500 text-white hover:bg-orange-600"
            >
              <KeyRound aria-hidden="true" />
              {submitting ? "Updating…" : "Update password"}
            </Button>
          </form>
        </div>
      </motion.section>
    </div>
  );
}
