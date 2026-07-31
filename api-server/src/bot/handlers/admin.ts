import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../../config.js';
import { 
  updateBalance, 
  addTransaction, 
  getPendingWithdrawals, 
  updateWithdrawalStatus, 
  pool,
  getSystemStats,
  getMaintenanceMode,
  setMaintenanceMode
} from '../../database.js';
import { getActiveGamesStatus } from '../../game-manager.js';

async function buildStatsText(): Promise<string> {
  const stats = await getSystemStats();
  const isMaintenance = await getMaintenanceMode();
  const activeGames = getActiveGamesStatus();
  
  return `📊 *System Stats*\n` +
         `___________________________\n\n` +
         `👥 *Total users:* *${stats.totalUsers}*\n` +
         `✅ *Registered:* *${stats.registeredUsers}*\n` +
         `💰 *Total ETB in system:* *${stats.totalEtb.toFixed(2)} ETB*\n` +
         `🎮 *Active game:* *${activeGames}*\n` +
         `🔧 *Maintenance:* *${isMaintenance ? 'ON' : 'OFF'}* ${isMaintenance ? '🔴' : '🟢'}`;
}

async function buildDashboardKeyboard(): Promise<InlineKeyboard> {
  const isMaintenance = await getMaintenanceMode();
  return new InlineKeyboard()
    .text("📊 View Stats", "admin_stats").row()
    .text(`🔧 Toggle Maintenance (currently: ${isMaintenance ? 'ON 🔴' : 'OFF 🟢'})`, "toggle_maintenance").row()
    .text("💵 Pending Withdrawals", "admin_withdrawals").text("📥 Pending Deposits", "admin_deposits");
}

function buildStatsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⬅️ Back to Dashboard", "admin_dashboard");
}

export function registerAdminHandlers(bot: Bot) {
  // Middleware to restrict access to admins
  bot.use(async (ctx, next) => {
    if (!config.isAdmin(ctx.from?.id)) {
      if (ctx.message?.text?.startsWith('/')) {
        await ctx.reply("❌ Unauthorized. Admin only.");
      }
      return;
    }
    await next();
  });

  // Admin Dashboard Commands
  bot.command('admin', async (ctx) => {
    const keyboard = await buildDashboardKeyboard();
    await ctx.reply(
      `🛠️ *Admin Control Panel*\n` +
      `___________________________\n\n` +
      `Welcome to the admin dashboard. Select an option below to manage the system.`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  });

  bot.command('stats', async (ctx) => {
    const text = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: buildStatsKeyboard()
    });
  });

  bot.callbackQuery('admin_stats', async (ctx) => {
    const text = await buildStatsText();
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: buildStatsKeyboard()
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin_dashboard', async (ctx) => {
    const keyboard = await buildDashboardKeyboard();
    await ctx.editMessageText(
      `🛠️ *Admin Control Panel*\n` +
      `___________________________\n\n` +
      `Welcome to the admin dashboard. Select an option below to manage the system.`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('toggle_maintenance', async (ctx) => {
    const current = await getMaintenanceMode();
    await setMaintenanceMode(!current);
    const keyboard = await buildDashboardKeyboard();
    await ctx.editMessageText(
      `🛠️ *Admin Control Panel*\n` +
      `___________________________\n\n` +
      `Welcome to the admin dashboard. Select an option below to manage the system.`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
    await ctx.answerCallbackQuery({
      text: `Maintenance mode toggled to ${!current ? 'ON' : 'OFF'}`
    });
  });

  bot.callbackQuery('admin_withdrawals', async (ctx) => {
    try {
      const list = await getPendingWithdrawals();
      let text = '';
      if (list.length === 0) {
        text = "✅ *Pending Withdrawal Requests*:\n\nNo pending withdrawals at the moment.";
      } else {
        text = "🔔 *Pending Withdrawal Requests*:\n\n";
        for (const w of list) {
          text += `• *ID:* \`${w.id}\` | *User:* \`${w.user_id}\` (@${w.username || 'N/A'})\n` +
            `  *Phone:* ${w.phone}\n` +
            `  *Amount:* ${parseFloat(w.amount).toFixed(2)} ETB\n` +
            `  *Time:* ${new Date(w.request_time).toLocaleString()}\n` +
            `  *Action:* /approve_withdraw ${w.id} or /reject_withdraw ${w.id}\n\n`;
        }
      }
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: buildStatsKeyboard()
      });
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Error fetching pending withdrawals.");
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin_deposits', async (ctx) => {
    try {
      const list = await pool.query(
        `SELECT d.*, u.username 
         FROM deposits d
         JOIN users u ON d.user_id = u.user_id 
         WHERE d.status = 'pending' 
         ORDER BY d.request_time DESC`
      );
      const deposits = list.rows;
      let text = '';
      if (deposits.length === 0) {
        text = "✅ *Pending Deposit Requests*:\n\nNo pending deposits at the moment.";
      } else {
        text = "🔔 *Pending Deposit Requests*:\n\n";
        for (const d of deposits) {
          text += `• *ID:* \`${d.id}\` | *User:* \`${d.user_id}\` (@${d.username || 'N/A'})\n` +
            `  *Platform:* ${d.platform.toUpperCase()} | *Amount:* ${parseFloat(d.amount).toFixed(2)} ETB\n` +
            `  *Ref/TXID:* \`${d.reference_id}\`\n` +
            `  *Time:* ${new Date(d.request_time).toLocaleString()}\n\n`;
        }
        text += `Approve or reject these via the inline buttons sent to you upon request submission.`;
      }
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: buildStatsKeyboard()
      });
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Error fetching pending deposits.");
    }
    await ctx.answerCallbackQuery();
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

  // Handle inline callback buttons for deposit approval/rejection
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('approve_dep:') && !data.startsWith('reject_dep:')) {
      return;
    }

    const isApprove = data.startsWith('approve_dep:');
    const depositIdStr = data.split(':')[1];
    const depositId = parseInt(depositIdStr, 10);

    if (isNaN(depositId)) {
      await ctx.answerCallbackQuery({ text: "❌ Invalid Deposit ID" });
      return;
    }

    try {
      // Fetch deposit details
      const depRes = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
      if (depRes.rows.length === 0) {
        await ctx.answerCallbackQuery({ text: "❌ Deposit request not found" });
        return;
      }

      const deposit = depRes.rows[0];
      if (deposit.status !== 'pending') {
        await ctx.answerCallbackQuery({ text: `⚠️ Already ${deposit.status}` });
        // Update message to show status
        await ctx.editMessageText(`⚠️ *Deposit Request #${depositId} is already ${deposit.status.toUpperCase()}*`, { parse_mode: 'Markdown' });
        return;
      }

      const amount = parseFloat(deposit.amount);
      const userId = deposit.user_id;

      if (isApprove) {
        // Calculate Cashback bonus: 10% for mobile payments, 100% for USDT
        let bonusRate = 0.10;
        if (deposit.platform.toLowerCase() === 'usdt') {
          bonusRate = 1.0;
        }
        const bonus = amount * bonusRate;
        const totalCredit = amount + bonus;

        // Start database transaction
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Update user balance and bonus
          await client.query('UPDATE users SET balance = balance + $1, bonus = bonus + $2 WHERE user_id = $3', [amount, bonus, userId]);
          // Log transactions: deposit and cashback bonus
          await client.query(
            `INSERT INTO transactions (user_id, type, amount, description) 
             VALUES ($1, $2, $3, $4)`,
            [userId, 'deposit', amount, `Deposit via ${deposit.platform.toUpperCase()} (Ref: ${deposit.reference_id})`]
          );
          if (bonus > 0) {
            await client.query(
              `INSERT INTO transactions (user_id, type, amount, description) 
               VALUES ($1, $2, $3, $4)`,
              [userId, 'cashback_bonus', bonus, `${bonusRate * 100}% Cashback Bonus for ${deposit.platform.toUpperCase()} deposit`]
            );
          }
          // Update deposit request status
          await client.query(
            `UPDATE deposits SET status = $1, processed_time = CURRENT_TIMESTAMP, admin_note = $2 WHERE id = $3`,
            ['completed', 'Approved by admin', depositId]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }

        // Notify user via Bot
        ctx.api.sendMessage(
          userId,
          `✅ *Deposit Approved!*\n\n` +
          `💰 *Amount:* ${amount.toFixed(2)} ETB\n` +
          `🎁 *Cashback Bonus:* ${bonus.toFixed(2)} ETB (${bonusRate * 100}%)\n` +
          `💳 *Payment:* ${deposit.platform.toUpperCase()}\n` +
          `🎉 *Total Credited:* ${totalCredit.toFixed(2)} ETB\n` +
          `Your wallet balance has been updated!`,
          { parse_mode: 'Markdown' }
        ).catch(err => console.error('Error notifying user of deposit approval:', err));

        // Answer callback query & update admin message
        await ctx.answerCallbackQuery({ text: "✅ Deposit approved and credited!" });
        await ctx.editMessageText(
          `✅ *Deposit Approved (#${depositId})*\n\n` +
          `👤 *User ID:* \`${userId}\`\n` +
          `📱 *Platform:* *${deposit.platform.toUpperCase()}*\n` +
          `💰 *Amount:* ${amount.toFixed(2)} ETB\n` +
          `🎁 *Cashback:* ${bonus.toFixed(2)} ETB\n` +
          `🧾 *Ref/TXID:* \`${deposit.reference_id}\`\n\n` +
          `🟢 *Status:* Approved and Credited.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        // Reject Deposit
        await pool.query(
          `UPDATE deposits SET status = $1, processed_time = CURRENT_TIMESTAMP, admin_note = $2 WHERE id = $3`,
          ['rejected', 'Rejected by admin', depositId]
        );

        // Notify User
        ctx.api.sendMessage(
          userId,
          `❌ *Deposit Request Rejected!*\n\n` +
          `💰 *Amount:* ${amount.toFixed(2)} ETB\n` +
          `💳 *Payment:* ${deposit.platform.toUpperCase()}\n` +
          `🧾 *Ref/TXID:* \`${deposit.reference_id}\`\n` +
          `Please contact support @Derash_Admin if you have questions.`,
          { parse_mode: 'Markdown' }
        ).catch(err => console.error('Error notifying user of deposit rejection:', err));

        // Answer callback query & update admin message
        await ctx.answerCallbackQuery({ text: "❌ Deposit request rejected." });
        await ctx.editMessageText(
          `❌ *Deposit Rejected (#${depositId})*\n\n` +
          `👤 *User ID:* \`${userId}\`\n` +
          `📱 *Platform:* *${deposit.platform.toUpperCase()}*\n` +
          `💰 *Amount:* ${amount.toFixed(2)} ETB\n` +
          `🧾 *Ref/TXID:* \`${deposit.reference_id}\`\n\n` +
          `🔴 *Status:* Rejected by Admin.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err) {
      console.error('Error processing deposit callback:', err);
      await ctx.answerCallbackQuery({ text: "❌ Database error." });
    }
  });
}
