import logging

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from app.config import config
from app.database import database
from .keyboards import contact_request_keyboard, main_menu

logger = logging.getLogger("bingo")


async def _require_phone_verification(update: Update, user: dict | None) -> bool:
    if user and user.get("phone") and str(user["phone"]).strip() != "":
        return True
    await update.message.reply_text(
        "🔐 *Phone Contact Verification Required*\n\n"
        "🎁 *Welcome Bonus:* You have a **30.00 ETB Welcome Bonus** waiting!\n\n"
        "To verify your identity and protect your wallet balance, please tap the button below to share your phone number.",
        parse_mode="Markdown",
        reply_markup=contact_request_keyboard(),
    )
    return False


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return

    user = await database.get_user(user_id)
    username = update.effective_user.username or update.effective_user.first_name or "Player"
    if not user:
        user = await database.register_user(user_id, username, "")

    if await _require_phone_verification(update, user):
        await update.message.reply_text(
            "✅ Welcome back to Bingo Spark!", parse_mode="Markdown", reply_markup=main_menu()
        )


async def contact_shared(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    contact = update.message.contact
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id or not contact:
        return

    if contact.user_id != user_id:
        await update.message.reply_text("❌ Authentication failed. Please share your own contact number.")
        return

    phone = contact.phone_number
    username = update.effective_user.username or update.effective_user.first_name or "Player"

    await database.register_user(user_id, username, phone)
    current_balance = await database.get_balance(user_id)

    await update.message.reply_text(
        "🎉 *Phone Verification Successful!*\n\n"
        "🎁 Your **30.00 ETB Welcome Bonus** is credited to your wallet!\n"
        f"💰 *Current Wallet Balance:* **{current_balance:.2f} ETB**\n\n"
        "You can now tap *🎮 Play Bingo* to join games immediately.",
        parse_mode="Markdown",
        reply_markup=main_menu(),
    )


async def hears_balance(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return
    bal = await database.get_balance(user_id)
    await update.message.reply_text(f"💰 *Your Balance:* {bal:.2f} ETB", parse_mode="Markdown")


async def hears_deposit(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else "?"
    await update.message.reply_text(
        "💳 *Deposit Options*\n\n"
        "To deposit funds into your Bingo Spark account, please contact the administrator:\n"
        f"👤 *Admin:* @Derash_Admin or send your User ID `{user_id}` for manual credit.\n\n"
        "Once you transfer funds, the administrator will update your balance immediately.",
        parse_mode="Markdown",
    )


async def hears_withdraw(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return
    bal = await database.get_balance(user_id)
    if bal < 50:
        await update.message.reply_text("❌ *Minimum withdrawal amount is 50 ETB.*", parse_mode="Markdown")
        return
    await update.message.reply_text(
        f"💰 *Your Balance:* {bal:.2f} ETB\n\n"
        "To request a withdrawal, please use the following command format:\n"
        "`/withdraw <amount>`\n\n"
        "Example: `/withdraw 150`",
        parse_mode="Markdown",
    )


async def withdraw_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return

    user = await database.get_user(user_id)
    if not user or not user.get("phone"):
        await update.message.reply_text("❌ Please register your phone number first by clicking /start.")
        return

    match = " ".join(context.args) if context.args else None
    if not match:
        await update.message.reply_text("❌ Please specify the amount. Usage: `/withdraw <amount>`", parse_mode="Markdown")
        return

    try:
        amount = float(match.strip())
    except ValueError:
        amount = float("nan")
    if amount != amount or amount <= 0:  # NaN check
        await update.message.reply_text("❌ Please enter a valid positive number for withdrawal.")
        return

    if amount < 50:
        await update.message.reply_text("❌ Minimum withdrawal amount is 50 ETB.")
        return

    balance = await database.get_balance(user_id)
    if balance < amount:
        await update.message.reply_text(f"❌ Insufficient balance! Your current balance is {balance:.2f} ETB.")
        return

    await database.update_balance(user_id, -amount)
    withdrawal = await database.create_withdrawal(user_id, amount, user["phone"])
    await database.add_transaction(
        user_id, "withdrawal_request", -amount, f"Pending withdrawal to {user['phone']} (Ref ID: {withdrawal['id']})"
    )

    await update.message.reply_text(
        f"✅ *Withdrawal request submitted!*\n\nAmount: {amount:.2f} ETB\nPhone: {user['phone']}\n"
        f"Ref ID: {withdrawal['id']}\nStatus: Pending Admin Approval.\nYour balance has been updated.",
        parse_mode="Markdown",
    )

    if config.ADMIN_ID:
        admin_text = (
            "🔔 *New Withdrawal Request*\n\n"
            f"👤 *Ref ID:* `{withdrawal['id']}`\n"
            f"👤 *User ID:* `{user_id}`\n"
            f"👤 *Username:* @{user.get('username') or 'N/A'}\n"
            f"📱 *Phone:* {user['phone']}\n"
            f"💰 *Amount:* {amount:.2f} ETB\n\n"
            f"To approve, use: `/approve_withdraw {withdrawal['id']}`\n"
            f"To reject, use: `/reject_withdraw {withdrawal['id']}`"
        )
        try:
            await context.bot.send_message(config.ADMIN_ID, admin_text, parse_mode="Markdown")
        except Exception:
            logger.exception("Error notifying admin of withdrawal")


async def hears_transactions(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return

    try:
        async with database.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT type, amount, description, timestamp FROM transactions WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 10",
                user_id,
            )

        if not rows:
            await update.message.reply_text("📜 No transactions found in your history.")
            return

        text = "📜 *Your Recent Transactions (Last 10)*\n\n"
        for row in rows:
            date = row["timestamp"].strftime("%m/%d/%Y, %I:%M:%S %p")
            amt = float(row["amount"])
            amt_str = f"+{amt:.2f}" if amt >= 0 else f"{amt:.2f}"
            text += f"• *{date}* \n  *Type:* `{row['type']}` | *Amt:* `{amt_str} ETB`\n  *Desc:* _{row['description']}_\n\n"

        await update.message.reply_text(text, parse_mode="Markdown")
    except Exception:
        logger.exception("Error fetching transaction history")
        await update.message.reply_text("❌ Error fetching transaction history.")


def register_user_handlers(app: Application) -> None:
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(MessageHandler(filters.CONTACT, contact_shared))
    app.add_handler(MessageHandler(filters.Text(["💵 Balance"]), hears_balance))
    app.add_handler(MessageHandler(filters.Text(["💰 Deposit"]), hears_deposit))
    app.add_handler(MessageHandler(filters.Text(["💸 Withdraw"]), hears_withdraw))
    app.add_handler(CommandHandler("withdraw", withdraw_command))
    app.add_handler(MessageHandler(filters.Text(["📜 Transactions"]), hears_transactions))
