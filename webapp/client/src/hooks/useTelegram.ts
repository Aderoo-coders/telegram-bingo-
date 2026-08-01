import { useMemo } from 'react';
import type { TelegramWebApp } from '../telegram';

let didInit = false;

export function useTelegram(): TelegramWebApp {
  const tg = useMemo(() => window.Telegram.WebApp, []);

  if (!didInit) {
    didInit = true;
    tg.expand();
    tg.ready();
  }

  return tg;
}
