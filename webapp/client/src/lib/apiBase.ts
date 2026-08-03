// Empty by default: same-origin relative calls, matching how this app has
// always worked when the API server also serves the frontend (local dev via
// Vite's proxy, or the old Node setup serving /webapp itself). Set
// VITE_API_BASE_URL at build time when the frontend is deployed separately
// from the API (e.g. a static Cloudflare Pages build calling a Render URL).
const rawBase = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE = rawBase ? rawBase.replace(/\/$/, '') : '';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function wsUrl(path: string): string {
  if (API_BASE) {
    return `${API_BASE.replace(/^http/, 'ws')}${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
