// Shared types for the 7Nights admin control panel.
// These mirror the server-side /api/admin/* response contracts.

export type SectionId =
  | "dashboard"
  | "seasons"
  | "players"
  | "chat"
  | "words"
  | "settings";

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLogin?: string | null;
}

export interface LiveSeasonInfo {
  id: string;
  number: number;
  title: string;
  tagline: string;
  startsAt: string;
  endsAt: string;
}

export interface ChatStats {
  online: number | null;
  words: number | null;
  mutedCount: number | null;
  chatBannedCount: number | null;
  messages24h: number | null;
  flagged24h: number | null;
  relay: boolean;
}

export interface Stats {
  players: number;
  banned: number;
  muted: number;
  scores: number;
  scoresToday: number;
  season: LiveSeasonInfo | null;
  chat: ChatStats;
  generatedAt: string;
}

export interface Season {
  id: string;
  number: number;
  title: string;
  kit: string;
  tagline: string;
  startsAt: string;
  endsAt: string;
  live: boolean;
  past: boolean;
}

export interface Player {
  name: string;
  xp: number;
  coins: number;
  wins: number;
  runs: number;
  games: number;
  bestPoints: number;
  lastPlayedAt: string | null;
  profileUpdatedAt: string | null;
  synced: boolean;
  banned: boolean;
  banReason: string | null;
  muted: boolean;
  muteUntil: string | null;
  flaggedCount: number;
  notes: string | null;
}

export type WordAction = "block" | "flag";

export interface WordEntry {
  word: string;
  action: WordAction;
}

export interface MutedEntry {
  name: string;
  until: number; // epoch ms
  reason: string | null;
}

export interface ChatBannedEntry {
  name: string;
  reason: string | null;
  at: number; // epoch ms
}

export interface ChatMessage {
  id: string;
  name: string;
  msg: string;
  flagged: boolean;
  ts: number; // epoch ms
}

export interface ChatState {
  words: WordEntry[];
  muted: MutedEntry[];
  chatBanned: ChatBannedEntry[];
  online: number;
}

// ---- success payloads (errors arrive as thrown ApiError) ----

export interface OkData {
  ok: true;
}

export interface LoginData extends OkData {
  admin: Admin;
}

export interface MeData extends OkData {
  admin: Admin;
}

export interface StatsData extends OkData {
  stats: Stats;
}

export interface SeasonsData extends OkData {
  seasons: Season[];
}

export interface PlayersData extends OkData {
  total: number;
  players: Player[];
}

export interface ChatData extends OkData {
  messages: ChatMessage[];
  state: ChatState;
}

export interface WordsData extends OkData {
  words: WordEntry[];
  muted: MutedEntry[];
  chatBanned: ChatBannedEntry[];
  online: number;
  messages24h: number;
  flagged24h: number;
}

// ---- request payloads ----

export type PlayerActionType =
  | "ban"
  | "unban"
  | "mute"
  | "unmute"
  | "notes"
  | "clearflags";

export interface PlayerActionPayload {
  action: PlayerActionType;
  name: string;
  reason?: string;
  hours?: number;
  notes?: string;
}

export type ChatModAction =
  | "mute"
  | "unmute"
  | "chatban"
  | "chatunban"
  | "broadcast";

export interface ChatModPayload {
  action: ChatModAction;
  name?: string;
  hours?: number;
  reason?: string;
  message?: string;
}
