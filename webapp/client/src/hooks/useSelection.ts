import { useCallback, useState } from 'react';
import { MAX_SELECT, TOTAL_CARDS, getMiniTicketForNumber } from '../lib/tickets';
import type { TelegramWebApp } from '../telegram';
import type { TicketEntry } from '../types';

export function useSelection(tg: TelegramWebApp) {
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [ticketHistory, setTicketHistory] = useState<TicketEntry[]>([]);

  const clear = useCallback(() => {
    setSelectedNumbers([]);
    setTicketHistory([]);
  }, []);

  const toggleNumber = useCallback(
    (num: number) => {
      setSelectedNumbers((prev) => {
        if (prev.includes(num)) {
          setTicketHistory((history) => history.filter((entry) => entry.number !== num));
          return prev.filter((n) => n !== num);
        }
        if (prev.length < MAX_SELECT) {
          setTicketHistory((history) => [...history, { number: num, ticketMatrix: getMiniTicketForNumber(num) }]);
          return [...prev, num];
        }
        tg.HapticFeedback?.notificationOccurred('warning');
        return prev;
      });
    },
    [tg],
  );

  const quickPick = useCallback(() => {
    const nums: number[] = [];
    while (nums.length < MAX_SELECT) {
      const r = Math.floor(Math.random() * TOTAL_CARDS) + 1;
      if (!nums.includes(r)) nums.push(r);
    }
    nums.sort((a, b) => a - b);
    setSelectedNumbers(nums);
    setTicketHistory(nums.map((num) => ({ number: num, ticketMatrix: getMiniTicketForNumber(num) })));
    tg.HapticFeedback?.impactOccurred('medium');
  }, [tg]);

  return { selectedNumbers, ticketHistory, toggleNumber, quickPick, clear };
}
