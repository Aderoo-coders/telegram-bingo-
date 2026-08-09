import type { GameHistoryEntry, Transaction, UserProfile } from '../types';
import { apiUrl } from './apiBase';

interface BalanceResponse {
  balance: number | string;
  bonus: number | string;
}

interface TransactionsResponse {
  transactions: Transaction[];
}

interface HistoryResponse {
  history: GameHistoryEntry[];
}

interface WithdrawalResponse {
  success: boolean;
  refId?: string;
  newBalance?: number | string;
  error?: string;
}

interface DepositResponse {
  success: boolean;
  refId?: string;
  error?: string;
}

export async function fetchUserBalance(initData: string): Promise<BalanceResponse | null> {
  const response = await fetch(apiUrl(`/api/user-balance?initData=${encodeURIComponent(initData)}`));
  if (!response.ok) return null;
  return response.json();
}

export async function fetchUserProfile(initData: string): Promise<UserProfile | null> {
  const response = await fetch(apiUrl(`/api/user-profile?initData=${encodeURIComponent(initData)}`));
  if (!response.ok) return null;
  return response.json();
}

export async function fetchUserTransactions(initData: string): Promise<TransactionsResponse | null> {
  const response = await fetch(apiUrl(`/api/user-transactions?initData=${encodeURIComponent(initData)}`));
  if (!response.ok) return null;
  return response.json();
}

export async function fetchGameHistory(initData: string): Promise<HistoryResponse | null> {
  const response = await fetch(apiUrl(`/api/user-history?initData=${encodeURIComponent(initData)}`));
  if (!response.ok) return null;
  return response.json();
}

export async function requestWithdrawal(initData: string, amount: number): Promise<{ ok: boolean; data: WithdrawalResponse }> {
  const response = await fetch(apiUrl('/api/request-withdrawal'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, amount }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

export async function requestDeposit(
  initData: string,
  amount: number,
  platform: string,
  referenceId: string,
): Promise<{ ok: boolean; data: DepositResponse }> {
  const response = await fetch(apiUrl('/api/request-deposit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, amount, platform, referenceId }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}
