import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from current directory or root workspace
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

// Always include both known admins; env may only set a single ADMIN_ID.
const DEFAULT_ADMIN_IDS = [2146240208, 7636281033];
const fromEnv = (process.env.ADMIN_IDS || process.env.ADMIN_ID || '')
  .split(',')
  .map(id => parseInt(id.trim(), 10))
  .filter(id => !isNaN(id) && id > 0);
const parsedAdminIds = [...new Set([...DEFAULT_ADMIN_IDS, ...fromEnv])];

export interface Config {
  BOT_TOKEN: string;
  DATABASE_URL: string;
  ADMIN_ID: number;
  ADMIN_IDS: number[];
  isAdmin: (userId: number | string | undefined | null) => boolean;
  SESSION_SECRET: string;
  WEBAPP_URL: string;
  PORT: number;
}

export const config: Config = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  DATABASE_URL: process.env.DATABASE_URL || '',
  ADMIN_ID: parsedAdminIds[0] || 0,
  ADMIN_IDS: parsedAdminIds,
  isAdmin: (userId: number | string | undefined | null): boolean => {
    if (!userId) return false;
    const num = typeof userId === 'number' ? userId : parseInt(userId.toString(), 10);
    return parsedAdminIds.includes(num);
  },
  SESSION_SECRET: process.env.SESSION_SECRET || 'default-session-secret-change-me',
  WEBAPP_URL: process.env.WEBAPP_URL || 'http://localhost:8080',
  PORT: parseInt(process.env.PORT || '8080', 10),
};

if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing in environment variables.');
}
if (!config.DATABASE_URL) {
  console.error('❌ DATABASE_URL is missing in environment variables.');
}
