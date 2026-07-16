import { Bot, InlineKeyboard } from 'grammy';
import { getBalance } from '../../database.js';
import { config } from '../../config.js';

export function registerGameHandlers(bot: Bot) {
  bot.hears('🎮 Play Bingo', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const keyboard = new InlineKeyboard()
      .text("30 ETB", "stake_30").text("50 ETB", "stake_50").row()
      .text("100 ETB", "stake_100").text("200 ETB", "stake_200");

    await ctx.reply("💰 Choose your stake amount:", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^stake_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const stakeStr = ctx.match[1];
    const stake = parseInt(stakeStr, 10);

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
    const keyboard = new InlineKeyboard().webApp("🎮 Open Shamo Bingo", webAppUrl);

    await ctx.reply(
      `✅ *Stake ${stake} ETB selected*\n\nTap the button below to open the game:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  });
}
