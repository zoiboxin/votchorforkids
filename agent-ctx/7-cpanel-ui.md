# Task 7 — 7Nights Admin Panel UI (cpanel_app)

## Summary
Built the complete professional dark admin panel UI for the 7Nights zombie battle-royale game, consuming the pre-existing `/api/admin/*` endpoints. No backend files were touched; scope was strictly limited to `src/app/cpanel_app/page.tsx` and `src/components/cpanel/*`.

## Files created
| File | Purpose |
|---|---|
| `src/app/cpanel_app/page.tsx` | Client route that renders `<CPanelApp />` (served at `/cpanel_app`). |
| `src/components/cpanel/types.ts` | Strict TS types mirroring the admin API contract (Admin, Stats, Season, Player, ChatMessage, WordEntry, payloads, success envelopes). |
| `src/components/cpanel/api.ts` | Typed fetch helper (`ApiError`, central 401 → unauthorized handler), full `api` client for all 14 endpoints, plus time/format helpers (`relTime`, `fmtCountdown`, `fmtDateTime`, `fmtNum`, `isoToLocalInput`, `localInputToIso`, `fmtClock`). |
| `src/components/cpanel/shared.tsx` | Shared design tokens + primitives: `PANEL`, `SCROLLBAR`, `ToneBadge`, `StatusDot`, `ErrorBanner`, `InfoBanner`, `StatCard`, `EmptyState`, `SkeletonRows`, `SkeletonCards`, `Spinner`. |
| `src/components/cpanel/Login.tsx` | Ember-branded login card with server error display and hint "Default: info@zoibox.com · Admin@595965". Calls login then `/me` for full profile. |
| `src/components/cpanel/Shell.tsx` | Layout: w-56 sidebar (auto-collapses to icons at md, manual toggle), sticky topbar (title/subtitle, live online pill, per-tab refresh), mobile horizontal tab bar, footer with admin email + role badge + logout + "Open game" link. |
| `src/components/cpanel/CPanelApp.tsx` | Root orchestrator: session bootstrap via `/me`, central 401 handling, forces `dark` class on `<html>`, 60s stats pulse for topbar pill, section switching, refresh tick, framer-motion tab transitions. |
| `src/components/cpanel/DashboardTab.tsx` | 8 stat cards (tabular numbers + captions), Live Season hero (S-chip, title, tagline, date range, per-second "ENDS IN" countdown, progress bar), Relay status card (green/red dot + 4 mini stats). |
| `src/components/cpanel/SeasonsTab.tsx` | All 27 seasons sorted by number in a sticky-header scroll table: S-chip, title, kit slug, LIVE/PAST/SCHEDULED badges, two datetime-local inputs per row, dirty-tracking Save, per-row "start today +28d" preset, per-row success flash + validation errors, info banner. |
| `src/components/cpanel/PlayersTab.tsx` | Debounced search (?q=), sticky-header table with XP/coins/wins/games/best/flags/status/last-seen, cloud-synced vs leaderboard-only badges, red tint on banned rows, dropdown actions: Ban (dialog + reason), Unban/Mute 24h/Unmute/Clear flags (AlertDialog confirms), Add note (dialog, prefilled), toasts + spinners, empty state. |
| `src/components/cpanel/ChatTab.tsx` | 5s polling (paused when document hidden), newest-first feed, FLAGGED badge, per-message delete, per-name dropdown (Mute 30m/24h, Chat-ban/Unchat-ban contextual to state), "Flagged only" switch, Broadcast composer (NightLine announcement), side panel with Muted and Chat-banned lists + unmute/unban. |
| `src/components/cpanel/WordsTab.tsx` | Add-word form (input + block/flag Select), rule list with BLOCK/FLAG badges and delete, strike-rule info banner, quick stats (rules/blocked/flagged/msgs24h/online). |
| `src/components/cpanel/SettingsTab.tsx` | Account card (name, email, role, last login, session info, admin id), change-password form (>=8 chars, match validation, inline errors, success flash), seeded-credentials note. |

## Verification
- `bunx tsc --noEmit` → zero errors for cpanel files (0 project errors at the end).
- `bun run lint` → zero cpanel findings (only a pre-existing warning in `src/lib/game/cars/...` unrelated to this task).
- `GET /cpanel_app` → 200, compiles cleanly in dev.

## API contract assumptions
1. `POST /api/admin/login` with wrong credentials returns 401/400 `{ok:false,error}`; success returns `{ok:true,admin}` — after login the panel re-fetches `/api/admin/me` to obtain `lastLogin`.
2. `DELETE /api/admin/chat` and `DELETE /api/admin/words` send JSON bodies (`{id}`, `{word}`) and accept them.
3. Chat mute via `/api/admin/chatmod` accepts fractional `hours` (0.5 = 30 minutes); player mute uses `hours: 24`.
4. `muted[].until` in both `/chat` and `/words` payloads are epoch **milliseconds**; `chatBanned[].at` epoch ms too.
5. `season.startsAt/endsAt` are ISO strings; PUT receives ISO strings; datetime-local inputs are interpreted in local time.
6. Topbar pill: `chat.online` null + `chat.relay=false` → "Relay offline" red pill; numeric online → green "N online" pill.
7. `player.notes` payload key is `notes`; ban without a reason omits the `reason` field entirely.
8. Toasts use the globally mounted `@/hooks/use-toast` provider (already in root layout).
