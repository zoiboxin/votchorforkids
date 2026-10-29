import { ROOM_CAPACITY } from "./constants.ts";

/**
 * Bot-fill rule: every room always holds ROOM_CAPACITY entities.
 * real + bots === capacity. A join removes one bot, a leave adds one back.
 */
export const botsNeeded = (realPlayers: number, capacity = ROOM_CAPACITY): number =>
  Math.max(0, capacity - Math.max(0, realPlayers));

/**
 * Pure model of the matchmaker policy used for tests and capacity planning:
 * fill the fullest room that still has a real-player slot, otherwise open a new room.
 */
export function placePlayer(rooms: number[], capacity = ROOM_CAPACITY): number[] {
  let best = -1;
  rooms.forEach((n, i) => { if (n < capacity && (best < 0 || n > rooms[best])) best = i; });
  const next = rooms.slice();
  if (best < 0) next.push(1); else next[best]++;
  return next;
}
