import { Bot, Keyboard } from 'grammy';
import { getBalance, registerUser, getUser, pool, createWithdrawal, addTransaction, updateBalance } from '../../database.js';
import { mainMenu } from '../keyboards.js';
import { config } from '../../config.js';

export function registerUserHandlers(bot: Bot) {
  // Start Command
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const user = await getUser(userId);

    if (user && user.phone) {
      await ctx.reply("✅ Welcome back to *Shamo Bingo*!", {
        parse_mode: 'Markdown',
        reply_markup: mainMenu()
      });
    } else {
      const shareMarkup = new Keyboard().requestContact("📱 Share My Number").resized().oneTime();
      await ctx.reply(
        "👋 Welcome to *Shamo Bingo*!\n\nPlease share your phone number to register and start playing.",
        {
          parse_mode: 'Markdown',
          reply_markup: shareMarkup
        }
      );
    }
  });

  // Handle Shared Contact
  bot.on('message:contact', async (ctx) => {
    const contact = ctx.message.contact;
    const userId = ctx.from?.id;
    if (!userId || !contact) return;

    // Check if the contact belongs to the user who clicked it
    if (contact.user_id !== userId) {
      await ctx.reply("❌ Please share your own contact number.");
      return;
    }

    const phone = contact.phone_number;
    const username = ctx.from.username || ctx.from.first_name || 'Player';

    await registerUser(userId, username, phone);

    await ctx.reply("✅ Registration Successful! Welcome to Shamo Bingo.", {
      reply_markup: mainMenu()
    });
  });

  // Balance
  bot.hears('💵 Balance', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const bal = await getBalance(userId);
    await ctx.reply(`💰 *Your Balance:* ${bal.toFixed(2)} ETB`, { parse_mode: 'Markdown' });
  });

  // Deposit Info
  bot.hears('💰 Deposit', async (ctx) => {
    await ctx.reply(
      "💳 *Deposit Options*\n\n" +
      "To deposit funds into your Shamo Bingo account, please contact the administrator:\n" +
      `👤 *Admin:* @Derash_Admin or send your User ID \`${ctx.from?.id}\` for manual credit.\n\n` +
      "Once you transfer funds, the administrator will update your balance immediately.",
      { parse_mode: 'Markdown' }
    );
  });

  // Withdraw request page
  bot.hears('💸 Withdraw', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const bal = await getBalance(userId);
    if (bal < 50) {
      await ctx.reply("❌ *Minimum withdrawal amount is 50 ETB.*", { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply(
      `💰 *Your Balance:* ${bal.toFixed(2)} ETB\n\n` +
      "To request a withdrawal, please use the following command format:\n" +
      "`/withdraw <amount>`\n\n" +
      "Example: `/withdraw 150`",
      { parse_mode: 'Markdown' }
    );
  });

  // Process /withdraw command
  bot.command('withdraw', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const user = await getUser(userId);
    if (!user || !user.phone) {
      await ctx.reply("❌ Please register your phone number first by clicking /start.");
      return;
    }

    const match = ctx.match;
    if (!match) {
      await ctx.reply("❌ Please specify the amount. Usage: `/withdraw <amount>`");
      return;
    }

    const amount = parseFloat(match.trim());
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Please enter a valid positive number for withdrawal.");
      return;
    }

    if (amount < 50) {
      await ctx.reply("❌ Minimum withdrawal amount is 50 ETB.");
      return;
    }

    const balance = await getBalance(userId);
    if (balance < amount) {
      await ctx.reply(`❌ Insufficient balance! Your current balance is ${balance.toFixed(2)} ETB.`);
      return;
    }

    // Process withdrawal: lock the balance instantly
    await updateBalance(userId, -amount);
    const withdrawal = await createWithdrawal(userId, amount, user.phone);
    await addTransaction(userId, 'withdrawal_request', -amount, `Pending withdrawal to ${user.phone} (Ref ID: ${withdrawal.id})`);

    await ctx.reply(`✅ *Withdrawal request submitted!*\n\nAmount: ${amount.toFixed(2)} ETB\nPhone: ${user.phone}\nRef ID: ${withdrawal.id}\nStatus: Pending Admin Approval.\nYour balance has been updated.`, { parse_mode: 'Markdown' });

    // Notify Admin
    if (config.ADMIN_ID) {
      const adminText = `🔔 *New Withdrawal Request*\n\n` +
        `👤 *Ref ID:* \`${withdrawal.id}\`\n` +
        `👤 *User ID:* \`${userId}\`\n` +
        `👤 *Username:* @${user.username || 'N/A'}\n` +
        `📱 *Phone:* ${user.phone}\n` +
        `💰 *Amount:* ${amount.toFixed(2)} ETB\n\n` +
        `To approve, use: \`/approve_withdraw ${withdrawal.id}\`\n` +
        `To reject, use: \`/reject_withdraw ${withdrawal.id}\``;
      bot.api.sendMessage(config.ADMIN_ID, adminText, { parse_mode: 'Markdown' }).catch(err => {
        console.error('Error notifying admin of withdrawal:', err);
      });
    }
  });

  // Recent Transactions
  bot.hears('📜 Transactions', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const res = await pool.query(
        `SELECT type, amount, description, timestamp 
         FROM transactions 
         WHERE user_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 10`,
        [userId]
      );

      if (res.rows.length === 0) {
        await ctx.reply("📜 No transactions found in your history.");
        return;
      }

      let text = "📜 *Your Recent Transactions (Last 10)*\n\n";
      for (const row of res.rows) {
        const date = new Date(row.timestamp).toLocaleString();
        const amtStr = row.amount >= 0 ? `+${parseFloat(row.amount).toFixed(2)}` : `${parseFloat(row.amount).toFixed(2)}`;
        text += `• *${date}* \n  *Type:* \`${row.type}\` | *Amt:* \`${amtStr} ETB\`\n  *Desc:* _${row.description}_\n\n`;
      }

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Error fetching transaction history.");
    }
  });
}
