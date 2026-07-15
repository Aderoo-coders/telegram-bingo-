import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from current directory or root workspace
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  DATABASE_URL: process.env.DATABASE_URL || '',
  ADMIN_ID: parseInt(process.env.ADMIN_ID || '0', 10),
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
