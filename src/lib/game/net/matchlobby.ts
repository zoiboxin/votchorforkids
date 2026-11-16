/**
 * matchlobby — the 🏟️ PUBG-style matchmaking glue.
 *
 * Flow (mirrors how PUBG builds a 100-soul session):
 *   1. A player presses Play → they DON'T boot the world alone. They park in a
 *      MATCH LOBBY with a shared 30-second countdown and a room code.
 *   2. Anyone who Quick joins during that window lands in the SAME lobby —
 *      matchmaking prefers rooms that are still gathering.
 *   3. When the countdown fires, every lobby member boots the night TOGETHER:
 *      the real players claim their seats and the engine fills every remaining
 *      slot with AI bots — survivors, vote-runners & police officers — always
 *      100 souls in one session (seed 1337 deterministic world, so every
 *      client spawns the identical roster).
 *   4. Joining a night that's ALREADY running → you wait in a fresh 30 s lobby
 *      ("relobby") and the whole room restarts together when it fires, so
 *      nobody ever gets dropped into a mismatched mid-match world (that was
 *      the "player 1 is ahead, player 2 sees something else" bug).
 *
 * The countdown deadline is ONE shared epoch-ms stamp owned by the relay
 * (mp:countdown → roster broadcast), so every client renders the same clock
 * even across machines; the host's "start" event is the final launch backstop.
 */
import { net, type LobbyPlayer } from "./client";
import { useGame } from "@/components/game/store";
import type { Appearance } from "../constants";

/** how long the match lobby gathers before the night launches (PUBG-style) */
export const LOBBY_MS = 30000;

/** Patch the store's mp.roster from a relay lobby snapshot. */
export function syncMpRoster(lobby: { code: string; host: string; players: LobbyPlayer[] }) {
  const me = lobby.players.find((p) => p.sid === net.mySid);
  useGame.getState().patchMp({
    code: lobby.code,
    isHost: lobby.host === net.mySid,
    players: lobby.players.map((p) => ({
      sid: p.sid, slot: p.slot, name: p.name, ready: p.ready, self: p.sid === net.mySid,
    })),
    slot: me?.slot ?? 0,
  });
}

/**
 * Arm (or extend) the shared countdown for the seat we're holding.
 * Call AFTER the seat is claimed (or with no seat at all → offline solo lobby).
 */
export function armCountdown(): void {
  const g = useGame.getState();
  const now = Date.now();
  if (net.code && net.slot >= 0) {
    const cur = net.lobby?.lobbyEndsAt ?? 0;
    if (cur > now) {
      // 🕐 a countdown is ALREADY running in this room (pre-match gathering OR
      // a relobby wait) — late joiners adopt the shared clock, PUBG-style
      g.patchMp({ matchEndsAt: cur, matchMode: net.sessionStarted ? "relobby" : "gather" });
      return;
    }
    if (net.sessionStarted) {
      // 🔴 live night with no countdown yet → call the restart-together: the
      // relay arms ONE shared deadline and every client (in-game squad included)
      // rewinds to night 1 together when it fires
      net.startCountdown(LOBBY_MS);
      g.patchMp({ matchEndsAt: now + LOBBY_MS, matchMode: "relobby" });
      return;
    }
    // fresh room — WE own the first countdown
    net.startCountdown(LOBBY_MS);
    g.patchMp({ matchEndsAt: now + LOBBY_MS, matchMode: "gather" });
    return;
  }
  // relay unreachable → offline lobby: pure local clock, solo night on launch
  g.patchMp({ matchEndsAt: now + LOBBY_MS, matchMode: "solo" });
}

/**
 * 🏟️ Route the player into the match lobby. Claims a matchmaking seat first
 * (quick-join: prefer a gathering lobby → a live night → a fresh room), then
 * arms the shared countdown. The MatchLobby component renders the clock and
 * launches everyone via mpStartRun when it fires.
 */
export async function enterMatchLobby(): Promise<void> {
  const g = useGame.getState();
  g.setScreen("matchlobby");
  try {
    if (!net.code || net.slot < 0) {
      const name = g.playerName || "Survivor";
      const r = await net.quick(name, g.look as Appearance);
      syncMpRoster(r.lobby);
    }
  } catch {
    // relay unreachable — the offline solo countdown still runs below
  }
  armCountdown();
}

/** Leave the match lobby / room entirely — back to a clean landing state. */
export function leaveMatchmaking(): void {
  net.leave();
  useGame.getState().patchMp({
    code: "", players: [], error: "", busy: false, isHost: false,
    chat: [], matchEndsAt: 0, matchMode: "",
  });
}
