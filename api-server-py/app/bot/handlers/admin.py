import functools
import logging
import re

from telegram import Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from ... import config, database, game_manager
from ..keyboards import build_dashboard_keyboard, build_stats_keyboard

logger = logging.getLogger("bingo")

DASHBOARD_TEXT = (
    "🛠️ *Admin Control Panel*\n"
    "___________________________\n\n"
    "Welcome to the admin dashboard. Select an option below to manage the system."
)


def _fmt_dt(dt) -> str:
    return dt.strftime("%m/%d/%Y, %I:%M:%S %p") if dt else ""


def admin_only(handler):
    @functools.wraps(handler)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        user_id = update.effective_user.id if update.effective_user else None
        if not config.is_admin(user_id):
            if update.message and update.message.text and update.message.text.startswith("/"):
                await update.message.reply_text("❌ Unauthorized. Admin only.")
            return
        return await handler(update, context)

    return wrapper


async def _build_stats_text() -> str:
    stats = await database.get_system_stats()
    is_maintenance = await database.get_maintenance_mode()
    active_games = game_manager.get_active_games_status()
    return (
        "📊 *System Stats*\n"
        "___________________________\n\n"
        f"👥 *Total users:* *{stats['totalUsers']}*\n"
        f"✅ *Registered:* *{stats['registeredUsers']}*\n"
        f"💰 *Total ETB in system:* *{stats['totalEtb']:.2f} ETB*\n"
        f"🎮 *Active game:* *{active_games}*\n"
        f"🔧 *Maintenance:* *{'ON' if is_maintenance else 'OFF'}* {'🔴' if is_maintenance else '🟢'}"
    )


@admin_only
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    is_maintenance = await database.get_maintenance_mode()
    await update.message.reply_text(DASHBOARD_TEXT, parse_mode="Markdown", reply_markup=build_dashboard_keyboard(is_maintenance))


@admin_only
async def stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = await _build_stats_text()
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=build_stats_keyboard())


@admin_only
async def admin_stats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = await _build_stats_text()
    await update.callback_query.edit_message_text(text, parse_mode="Markdown", reply_markup=build_stats_keyboard())
    await update.callback_query.answer()


@admin_only
async def admin_dashboard_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    is_maintenance = await database.get_maintenance_mode()
    await update.callback_query.edit_message_text(
        DASHBOARD_TEXT, parse_mode="Markdown", reply_markup=build_dashboard_keyboard(is_maintenance)
    )
    await update.callback_query.answer()


@admin_only
async def toggle_maintenance_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    current = await database.get_maintenance_mode()
    await database.set_maintenance_mode(not current)
    await update.callback_query.edit_message_text(
        DASHBOARD_TEXT, parse_mode="Markdown", reply_markup=build_dashboard_keyboard(not current)
    )
    await update.callback_query.answer(text=f"Maintenance mode toggled to {'ON' if not current else 'OFF'}")


@admin_only
async def admin_withdrawals_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        pending = await database.get_pending_withdrawals()
        if not pending:
            text = "✅ *Pending Withdrawal Requests*:\n\nNo pending withdrawals at the moment."
        else:
            text = "🔔 *Pending Withdrawal Requests*:\n\n"
            for w in pending:
                text += (
                    f"• *ID:* `{w['id']}` | *User:* `{w['user_id']}` (@{w.get('username') or 'N/A'})\n"
                    f"  *Phone:* {w['phone']}\n"
                    f"  *Amount:* {float(w['amount']):.2f} ETB\n"
                    f"  *Time:* {_fmt_dt(w['request_time'])}\n"
                    f"  *Action:* /approve_withdraw {w['id']} or /reject_withdraw {w['id']}\n\n"
                )
        await update.callback_query.edit_message_text(text, parse_mode="Markdown", reply_markup=build_stats_keyboard())
    except Exception:
        logger.exception("Error fetching pending withdrawals")
        await update.callback_query.message.reply_text("❌ Error fetching pending withdrawals.")
    await update.callback_query.answer()


@admin_only
async def admin_deposits_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        deposits = await database.get_pending_deposits()
        if not deposits:
            text = "✅ *Pending Deposit Requests*:\n\nNo pending deposits at the moment."
        else:
            text = "🔔 *Pending Deposit Requests*:\n\n"
            for d in deposits:
                text += (
                    f"• *ID:* `{d['id']}` | *User:* `{d['user_id']}` (@{d.get('username') or 'N/A'})\n"
                    f"  *Platform:* {d['platform'].upper()} | *Amount:* {float(d['amount']):.2f} ETB\n"
                    f"  *Ref/TXID:* `{d['reference_id']}`\n"
                    f"  *Time:* {_fmt_dt(d['request_time'])}\n\n"
                )
            text += "Approve or reject these via the inline buttons sent to you upon request submission."
        await update.callback_query.edit_message_text(text, parse_mode="Markdown", reply_markup=build_stats_keyboard())
    except Exception:
        logger.exception("Error fetching pending deposits")
        await update.callback_query.message.reply_text("❌ Error fetching pending deposits.")
    await update.callback_query.answer()


@admin_only
async def addbalance_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    args = context.args
    if not args or len(args) < 2:
        await update.message.reply_text("Usage: `/addbalance <user_id> <amount>`", parse_mode="Markdown")
        return

    target_user_id = args[0].strip()
    try:
        amount = float(args[1].strip())
    except ValueError:
        amount = float("nan")
    if amount != amount or amount <= 0:
        await update.message.reply_text("❌ Please specify a valid positive amount.")
        return

    try:
        async with database.pool.acquire() as conn:
            user_row = await conn.fetchrow("SELECT * FROM users WHERE user_id = $1", int(target_user_id))
        if not user_row:
            await update.message.reply_text(f"❌ User with ID `{target_user_id}` does not exist in the system.", parse_mode="Markdown")
            return

        await database.update_balance(target_user_id, amount)
        await database.add_transaction(target_user_id, "admin_add", amount, "Balance added by admin")

        await update.message.reply_text(f"✅ Success! Added {amount:.2f} ETB to User ID `{target_user_id}`.", parse_mode="Markdown")

        try:
            await context.bot.send_message(
                int(target_user_id), f"✅ *Admin credited your account!*\n\nAmount: {amount:.2f} ETB", parse_mode="Markdown"
            )
        except Exception:
            logger.exception("Error notifying user of credit")
    except Exception:
        logger.exception("addbalance failed")
        await update.message.reply_text("❌ Failed to update balance.")


@admin_only
async def withdrawals_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        pending = await database.get_pending_withdrawals()
        if not pending:
            await update.message.reply_text("✅ No pending withdrawals at the moment.")
            return
        text = "🔔 *Pending Withdrawal Requests*:\n\n"
        for w in pending:
            text += (
                f"• *ID:* `{w['id']}` | *User:* `{w['user_id']}` (@{w.get('username') or 'N/A'})\n"
                f"  *Phone:* {w['phone']}\n"
                f"  *Amount:* {float(w['amount']):.2f} ETB\n"
                f"  *Time:* {_fmt_dt(w['request_time'])}\n"
                f"  *Action:* /approve_withdraw {w['id']} or /reject_withdraw {w['id']}\n\n"
            )
        await update.message.reply_text(text, parse_mode="Markdown")
    except Exception:
        logger.exception("Error fetching pending withdrawals")
        await update.message.reply_text("❌ Error fetching pending withdrawals.")


@admin_only
async def approve_withdraw_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Usage: `/approve_withdraw <id>`", parse_mode="Markdown")
        return
    try:
        id_ = int(context.args[0].strip())
    except ValueError:
        await update.message.reply_text("❌ Please enter a valid request ID.")
        return

    try:
        async with database.pool.acquire() as conn:
            w = await conn.fetchrow("SELECT * FROM withdrawals WHERE id = $1", id_)
        if not w:
            await update.message.reply_text(f"❌ Withdrawal request with ID `{id_}` not found.", parse_mode="Markdown")
            return
        if w["status"] != "pending":
            await update.message.reply_text(f"❌ Request is already {w['status']}.")
            return

        await database.update_withdrawal_status(id_, "completed", "Processed by admin")
        async with database.pool.acquire() as conn:
            await conn.execute(
                "UPDATE transactions SET description = $1 WHERE user_id = $2 AND type = 'withdrawal_request' AND description LIKE $3",
                f"Completed withdrawal (Ref: {id_})",
                w["user_id"],
                f"%Ref ID: {id_}%",
            )

        amount = float(w["amount"])
        await update.message.reply_text(f"✅ Approved and processed withdrawal request #{id_} of {amount:.2f} ETB.")

        try:
            await context.bot.send_message(
                w["user_id"],
                f"✅ *Withdrawal Approved!*\n\nYour request for {amount:.2f} ETB has been approved and processed.",
                parse_mode="Markdown",
            )
        except Exception:
            logger.exception("Error notifying user of withdrawal approval")
    except Exception:
        logger.exception("Error approving withdrawal request")
        await update.message.reply_text("❌ Error approving withdrawal request.")


@admin_only
async def reject_withdraw_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Usage: `/reject_withdraw <id>`", parse_mode="Markdown")
        return
    try:
        id_ = int(context.args[0].strip())
    except ValueError:
        await update.message.reply_text("❌ Please enter a valid request ID.")
        return

    try:
        async with database.pool.acquire() as conn:
            w = await conn.fetchrow("SELECT * FROM withdrawals WHERE id = $1", id_)
        if not w:
            await update.message.reply_text(f"❌ Withdrawal request with ID `{id_}` not found.", parse_mode="Markdown")
            return
        if w["status"] != "pending":
            await update.message.reply_text(f"❌ Request is already {w['status']}.")
            return

        amount = float(w["amount"])
        await database.update_withdrawal_status(id_, "rejected", "Rejected by admin")
        await database.update_balance(w["user_id"], amount)
        await database.add_transaction(w["user_id"], "withdrawal_refund", amount, f"Refunded rejected withdrawal (Ref: {id_})")

        await update.message.reply_text(f"❌ Rejected and refunded withdrawal request #{id_} of {amount:.2f} ETB.")

        try:
            await context.bot.send_message(
                w["user_id"],
                f"❌ *Withdrawal Rejected!*\n\nYour request for {amount:.2f} ETB was rejected. The funds have been refunded to your wallet.",
                parse_mode="Markdown",
            )
        except Exception:
            logger.exception("Error notifying user of withdrawal rejection")
    except Exception:
        logger.exception("Error rejecting withdrawal request")
        await update.message.reply_text("❌ Error rejecting withdrawal request.")


@admin_only
async def deposit_review_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    data = query.data
    if not data.startswith("approve_dep:") and not data.startswith("reject_dep:"):
        return

    is_approve = data.startswith("approve_dep:")
    try:
        deposit_id = int(data.split(":")[1])
    except (IndexError, ValueError):
        await query.answer(text="❌ Invalid Deposit ID")
        return

    try:
        async with database.pool.acquire() as conn:
            deposit = await conn.fetchrow("SELECT * FROM deposits WHERE id = $1", deposit_id)
        if not deposit:
            await query.answer(text="❌ Deposit request not found")
            return

        if deposit["status"] != "pending":
            await query.answer(text=f"⚠️ Already {deposit['status']}")
            await query.edit_message_text(
                f"⚠️ *Deposit Request #{deposit_id} is already {deposit['status'].upper()}*", parse_mode="Markdown"
            )
            return

        amount = float(deposit["amount"])
        user_id = deposit["user_id"]
        platform = deposit["platform"]

        if is_approve:
            bonus_rate = 1.0 if platform.lower() == "usdt" else 0.10
            bonus = amount * bonus_rate
            total_credit = amount + bonus

            async with database.pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "UPDATE users SET balance = balance + $1, bonus = bonus + $2 WHERE user_id = $3",
                        amount,
                        bonus,
                        user_id,
                    )
                    await conn.execute(
                        "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                        user_id,
                        "deposit",
                        amount,
                        f"Deposit via {platform.upper()} (Ref: {deposit['reference_id']})",
                    )
                    if bonus > 0:
                        await conn.execute(
                            "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                            user_id,
                            "cashback_bonus",
                            bonus,
                            f"{bonus_rate * 100:g}% Cashback Bonus for {platform.upper()} deposit",
                        )
                    await conn.execute(
                        "UPDATE deposits SET status = $1, processed_time = CURRENT_TIMESTAMP, admin_note = $2 WHERE id = $3",
                        "completed",
                        "Approved by admin",
                        deposit_id,
                    )

            try:
                await context.bot.send_message(
                    user_id,
                    "✅ *Deposit Approved!*\n\n"
                    f"💰 *Amount:* {amount:.2f} ETB\n"
                    f"🎁 *Cashback Bonus:* {bonus:.2f} ETB ({bonus_rate * 100:g}%)\n"
                    f"💳 *Payment:* {platform.upper()}\n"
                    f"🎉 *Total Credited:* {total_credit:.2f} ETB\n"
                    "Your wallet balance has been updated!",
                    parse_mode="Markdown",
                )
            except Exception:
                logger.exception("Error notifying user of deposit approval")

            await query.answer(text="✅ Deposit approved and credited!")
            await query.edit_message_text(
                f"✅ *Deposit Approved (#{deposit_id})*\n\n"
                f"👤 *User ID:* `{user_id}`\n"
                f"📱 *Platform:* *{platform.upper()}*\n"
                f"💰 *Amount:* {amount:.2f} ETB\n"
                f"🎁 *Cashback:* {bonus:.2f} ETB\n"
                f"🧾 *Ref/TXID:* `{deposit['reference_id']}`\n\n"
                "🟢 *Status:* Approved and Credited.",
                parse_mode="Markdown",
            )
        else:
            async with database.pool.acquire() as conn:
                await conn.execute(
                    "UPDATE deposits SET status = $1, processed_time = CURRENT_TIMESTAMP, admin_note = $2 WHERE id = $3",
                    "rejected",
                    "Rejected by admin",
                    deposit_id,
                )

            try:
                await context.bot.send_message(
                    user_id,
                    "❌ *Deposit Request Rejected!*\n\n"
                    f"💰 *Amount:* {amount:.2f} ETB\n"
                    f"💳 *Payment:* {platform.upper()}\n"
                    f"🧾 *Ref/TXID:* {deposit['reference_id']}\n"
                    "Please contact support @Derash_Admin if you have questions.",
                    parse_mode="Markdown",
                )
            except Exception:
                logger.exception("Error notifying user of deposit rejection")

            await query.answer(text="❌ Deposit request rejected.")
            await query.edit_message_text(
                f"❌ *Deposit Rejected (#{deposit_id})*\n\n"
                f"👤 *User ID:* `{user_id}`\n"
                f"📱 *Platform:* *{platform.upper()}*\n"
                f"💰 *Amount:* {amount:.2f} ETB\n"
                f"🧾 *Ref/TXID:* `{deposit['reference_id']}`\n\n"
                "🔴 *Status:* Rejected by Admin.",
                parse_mode="Markdown",
            )
    except Exception:
        logger.exception("Error processing deposit callback")
        await query.answer(text="❌ Database error.")


def register_admin_handlers(app: Application) -> None:
    app.add_handler(CommandHandler("admin", admin_command))
    app.add_handler(CommandHandler("stats", stats_command))
    app.add_handler(CallbackQueryHandler(admin_stats_callback, pattern="^admin_stats$"))
    app.add_handler(CallbackQueryHandler(admin_dashboard_callback, pattern="^admin_dashboard$"))
    app.add_handler(CallbackQueryHandler(toggle_maintenance_callback, pattern="^toggle_maintenance$"))
    app.add_handler(CallbackQueryHandler(admin_withdrawals_callback, pattern="^admin_withdrawals$"))
    app.add_handler(CallbackQueryHandler(admin_deposits_callback, pattern="^admin_deposits$"))
    app.add_handler(CommandHandler("addbalance", addbalance_command))
    app.add_handler(CommandHandler("withdrawals", withdrawals_command))
    app.add_handler(CommandHandler("approve_withdraw", approve_withdraw_command))
    app.add_handler(CommandHandler("reject_withdraw", reject_withdraw_command))
    app.add_handler(CallbackQueryHandler(deposit_review_callback, pattern=r"^(approve|reject)_dep:\d+$"))
