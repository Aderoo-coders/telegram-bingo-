import { useCallback, useState } from 'react';
import * as api from '../lib/api';
import type { GameHistoryEntry, Transaction } from '../types';

export function useWallet(initData: string) {
  const [balance, setBalance] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [username, setUsername] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | number>('--');
  const [phone, setPhone] = useState<string | undefined>();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[] | null>(null);

  const refreshBalance = useCallback(async () => {
    const data = await api.fetchUserBalance(initData);
    if (data) {
      setBalance(parseFloat(String(data.balance || 0)));
      setBonus(parseFloat(String(data.bonus || 0)));
    }
    return data;
  }, [initData]);

  const refreshProfile = useCallback(async () => {
    const profile = await api.fetchUserProfile(initData);
    if (profile) {
      setUsername(profile.username);
      setUserId(profile.userId);
      setPhone(profile.phone);
      setBalance(parseFloat(String(profile.balance || 0)));
      setBonus(parseFloat(String(profile.bonus || 0)));
    }
    return profile;
  }, [initData]);

  const refreshTransactions = useCallback(async () => {
    const data = await api.fetchUserTransactions(initData);
    setTransactions(data ? data.transactions : []);
    await refreshBalance();
  }, [initData, refreshBalance]);

  const refreshHistory = useCallback(async () => {
    const data = await api.fetchGameHistory(initData);
    setHistory(data ? data.history : []);
  }, [initData]);

  const submitWithdrawal = useCallback(
    async (amount: number) => {
      const { ok, data } = await api.requestWithdrawal(initData, amount);
      if (ok && data.success && data.newBalance !== undefined) {
        setBalance(parseFloat(String(data.newBalance)));
        await refreshBalance();
      }
      return { ok, data };
    },
    [initData, refreshBalance],
  );

  const submitDeposit = useCallback(
    async (amount: number, platform: string, referenceId: string) => {
      return api.requestDeposit(initData, amount, platform, referenceId);
    },
    [initData],
  );

  return {
    balance,
    bonus,
    username,
    userId,
    phone,
    transactions,
    history,
    refreshBalance,
    refreshProfile,
    refreshTransactions,
    refreshHistory,
    submitWithdrawal,
    submitDeposit,
  };
}
