import { Bot } from 'grammy';
import { config } from '../../config.js';
import { updateBalance, addTransaction, getPendingWithdrawals, updateWithdrawalStatus, pool } from '../../database.js';

export function registerAdminHandlers(bot: Bot) {
  // Middleware to restrict access to ADMIN_ID
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== config.ADMIN_ID) {
      if (ctx.message?.text?.startsWith('/')) {
        await ctx.reply("❌ Unauthorized. Admin only.");
      }
      return;
    }
    await next();
  });

  // /addbalance <user_id> <amount>
  bot.command('addbalance', async (ctx) => {
    const args = ctx.match?.split(' ');
    if (!args || args.length < 2) {
      await ctx.reply("Usage: `/addbalance <user_id> <amount>`", { parse_mode: 'Markdown' });
      return;
    }

    const targetUserId = args[0].trim();
    const amount = parseFloat(args[1].trim());

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Please specify a valid positive amount.");
      return;
    }

    try {
      const userRes = await pool.query('SELECT * FROM users WHERE user_id = $1', [targetUserId]);
      if (userRes.rows.length === 0) {
        await ctx.reply(`❌ User with ID \`${targetUserId}\` does not exist in the system.`, { parse_mode: 'Markdown' });
        return;
      }

      await updateBalance(targetUserId, amount);
      await addTransaction(targetUserId, 'admin_add', amount, 'Balance added by admin');

      await ctx.reply(`✅ Success! Added ${amount.toFixed(2)} ETB to User ID \`${targetUserId}\`.`, { parse_mode: 'Markdown' });
      
      bot.api.sendMessage(
        targetUserId, 
        `✅ *Admin credited your account!*\n\nAmount: ${amount.toFixed(2)} ETB`, 
        { parse_mode: 'Markdown' }
      ).catch(err => {
        console.error('Error notifying user of credit:', err);
      });
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Failed to update balance.");
    }
  });

  // /withdrawals - View pending requests
  bot.command('withdrawals', async (ctx) => {
    try {
      const list = await getPendingWithdrawals();
      if (list.length === 0) {
        await ctx.reply("✅ No pending withdrawals at the moment.");
        return;
      }

      let text = "🔔 *Pending Withdrawal Requests*:\n\n";
      for (const w of list) {
        text += `• *ID:* \`${w.id}\` | *User:* \`${w.user_id}\` (@${w.username || 'N/A'})\n` +
          `  *Phone:* ${w.phone}\n` +
          `  *Amount:* ${parseFloat(w.amount).toFixed(2)} ETB\n` +
          `  *Time:* ${new Date(w.request_time).toLocaleString()}\n` +
          `  *Action:* /approve_withdraw ${w.id} or /reject_withdraw ${w.id}\n\n`;
      }
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Error fetching pending withdrawals.");
    }
  });

  // /approve_withdraw <id>
  bot.command('approve_withdraw', async (ctx) => {
    const idStr = ctx.match;
    if (!idStr) {
      await ctx.reply("Usage: `/approve_withdraw <id>`", { parse_mode: 'Markdown' });
      return;
    }

    const id = parseInt(idStr.trim(), 10);
    if (isNaN(id)) {
      await ctx.reply("❌ Please enter a valid request ID.");
      return;
    }

    try {
      const wRes = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [id]);
      if (wRes.rows.length === 0) {
        await ctx.reply(`❌ Withdrawal request with ID \`${id}\` not found.`, { parse_mode: 'Markdown' });
        return;
      }

      const w = wRes.rows[0];
      if (w.status !== 'pending') {
        await ctx.reply(`❌ Request is already ${w.status}.`);
        return;
      }

      await updateWithdrawalStatus(id, 'completed', 'Processed by admin');
      
      await pool.query(
        "UPDATE transactions SET description = $1 WHERE user_id = $2 AND type = 'withdrawal_request' AND description LIKE $3",
        [`Completed withdrawal (Ref: ${id})`, w.user_id, `%Ref ID: ${id}%`]
      );

      await ctx.reply(`✅ Approved and processed withdrawal request #${id} of ${parseFloat(w.amount).toFixed(2)} ETB.`);

      bot.api.sendMessage(
        w.user_id, 
        `✅ *Withdrawal Approved!*\n\nYour request for ${parseFloat(w.amount).toFixed(2)} ETB has been approved and processed.`, 
        { parse_mode: 'Markdown' }
      ).catch(err => console.error(err));

    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Error approving withdrawal request.");
    }
  });

  // /reject_withdraw <id>
  bot.command('reject_withdraw', async (ctx) => {
    const idStr = ctx.match;
    if (!idStr) {
      await ctx.reply("Usage: `/reject_withdraw <id>`", { parse_mode: 'Markdown' });
      return;
    }

    const id = parseInt(idStr.trim(), 10);
    if (isNaN(id)) {
      await ctx.reply("❌ Please enter a valid request ID.");
      return;
    }

    try {
      const wRes = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [id]);
      if (wRes.rows.length === 0) {
        await ctx.reply(`❌ Withdrawal request with ID \`${id}\` not found.`, { parse_mode: 'Markdown' });
        return;
      }

      const w = wRes.rows[0];
      if (w.status !== 'pending') {
        await ctx.reply(`❌ Request is already ${w.status}.`);
        return;
      }

      const amount = parseFloat(w.amount);
      await updateWithdrawalStatus(id, 'rejected', 'Rejected by admin');
      
      await updateBalance(w.user_id, amount);
      await addTransaction(w.user_id, 'withdrawal_refund', amount, `Refunded rejected withdrawal (Ref: ${id})`);

      await ctx.reply(`❌ Rejected and refunded withdrawal request #${id} of ${amount.toFixed(2)} ETB.`);

      bot.api.sendMessage(
        w.user_id, 
        `❌ *Withdrawal Rejected!*\n\nYour request for ${amount.toFixed(2)} ETB was rejected. The funds have been refunded to your wallet.`, 
        { parse_mode: 'Markdown' }
      ).catch(err => console.error(err));

    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Error rejecting withdrawal request.");
    }
  });
}
