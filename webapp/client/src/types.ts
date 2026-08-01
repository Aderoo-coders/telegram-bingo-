export type CellValue = number | 'FREE';
export type TicketMatrix = CellValue[][];

export interface TicketEntry {
  number: number;
  ticketMatrix: TicketMatrix;
}

export interface LobbyPlayer {
  userId: string;
  username?: string;
}

export type ServerMessage =
  | { status: 'joined'; gameId: number | string; balance: number | string }
  | { status: 'lobby_update'; players: LobbyPlayer[]; isGameRunning: boolean; isCountdownActive: boolean; countdown: number }
  | { status: 'countdown'; secondsLeft: number }
  | { status: 'countdown_stopped' }
  | { status: 'game_start'; players?: LobbyPlayer[] }
  | { status: 'draw'; number: number; calledNumbers: number[] }
  | { status: 'finished'; outcome: 'draw' | 'winner'; winners?: { userId: string; username: string }[]; payout?: number | string }
  | { status: 'error'; message: string };

export interface Transaction {
  type: string;
  amount: number | string;
  timestamp: string;
  description?: string;
}

export interface GameHistoryEntry {
  id: number | string;
  winner_id: string | null;
  stake: number | string;
  matches: number;
  called_numbers: number[];
}

export interface UserProfile {
  username?: string;
  userId: string | number;
  phone?: string;
  balance: number | string;
  bonus: number | string;
}

export type Theme = 'neon' | 'obsidian' | 'light';

export type PlayPhase = 'welcome' | 'selection' | 'playing';

export type TabName = 'play' | 'wallet' | 'history' | 'settings';
