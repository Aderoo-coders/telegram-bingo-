import { Bot, InlineKeyboard } from 'grammy';
import { getBalance, getMaintenanceMode } from '../../database.js';
import { config } from '../../config.js';

export function registerGameHandlers(bot: Bot) {
  bot.hears('🎮 Play Bingo', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const webAppUrl = `${config.WEBAPP_URL}/webapp/index.html`;
    const keyboard = new InlineKeyboard()
      .webApp("🎮 Play Bingo spark", webAppUrl);

    await ctx.reply(
      "🎲 *Welcome to Bingo spark!*\n" +
      "Your ultimate bingo experience—play, win, and celebrate every number!\n\n" +
      "Bingo spark: 🎮 *Ready to play? Choose your amount to start playing:*",
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  });

  bot.callbackQuery(/^stake_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const stakeStr = ctx.match[1];
    const stake = parseInt(stakeStr, 10);

    const isMaintenance = await getMaintenanceMode();
    const isAdmin = config.isAdmin(userId);
    if (isMaintenance && !isAdmin) {
      await ctx.answerCallbackQuery({
        text: "🔧 The system is under maintenance. Play is temporarily disabled.",
        show_alert: true
      });
      return;
    }

    const balance = await getBalance(userId);
    if (balance < stake) {
      await ctx.answerCallbackQuery({
        text: "❌ Not enough balance!",
        show_alert: true
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const webAppUrl = `${config.WEBAPP_URL}/webapp/index.html?stake=${stake}`;
    const keyboard = new InlineKeyboard().webApp("🎮 Open Bingo spark", webAppUrl);

    await ctx.reply(
      `✅ *Stake ${stake} ETB selected*\n\nTap the button below to open the game:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  });
}
