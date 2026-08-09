import type { Theme } from '../types';

const STORAGE_KEY = 'bingo-theme';

export function loadTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'obsidian' || stored === 'light' ? stored : 'neon';
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function themeBodyClass(theme: Theme): string {
  if (theme === 'light') return 'light-theme';
  if (theme === 'obsidian') return 'obsidian-theme';
  return '';
}
