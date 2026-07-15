import { Bot } from 'grammy';
import { config } from '../config.js';
import { registerUserHandlers } from './handlers/user.js';
import { registerGameHandlers } from './handlers/game.js';
import { registerAdminHandlers } from './handlers/admin.js';

if (!config.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required to run the Telegram Bot');
}

export const bot = new Bot(config.BOT_TOKEN);

// Register User Commands & Actions
registerUserHandlers(bot);

// Register Game Settings & WebApp Launcher
registerGameHandlers(bot);

// Register Admin Commands (Balance credit & Withdrawal audits)
registerAdminHandlers(bot);

console.log('🤖 Telegram Bot handlers initialized.');
