import re

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import Application, CallbackQueryHandler, ContextTypes, MessageHandler, filters

from config import config
from database import database


async def hears_play_bingo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return

    web_app_url = config.WEBAPP_URL
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("🎮 Play Bingo spark", web_app=WebAppInfo(url=web_app_url))]]
    )

    await update.message.reply_text(
        "🎲 *Welcome to Bingo spark!*\n"
        "Your ultimate bingo experience—play, win, and celebrate every number!\n\n"
        "Bingo spark: 🎮 *Ready to play? Choose your amount to start playing:*",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


async def stake_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    user_id = update.effective_user.id if update.effective_user else None
    if not user_id:
        return

    match = re.match(r"^stake_(\d+)$", query.data)
    stake = int(match.group(1))

    is_maintenance = await database.get_maintenance_mode()
    if is_maintenance and not config.is_admin(user_id):
        await query.answer(text="🔧 The system is under maintenance. Play is temporarily disabled.", show_alert=True)
        return

    balance = await database.get_balance(user_id)
    if balance < stake:
        await query.answer(text="❌ Not enough balance!", show_alert=True)
        return

    await query.answer()

    web_app_url = f"{config.WEBAPP_URL}?stake={stake}"
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("🎮 Open Bingo spark", web_app=WebAppInfo(url=web_app_url))]])

    await query.message.reply_text(
        f"✅ *Stake {stake} ETB selected*\n\nTap the button below to open the game:",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


def register_game_handlers(app: Application) -> None:
    app.add_handler(MessageHandler(filters.Text(["🎮 Play Bingo"]), hears_play_bingo))
    # Kept for parity with the Node original even though nothing currently
    # emits a `stake_<n>` callback_data button (dead/unreachable there too).
    app.add_handler(CallbackQueryHandler(stake_callback, pattern=r"^stake_\d+$"))
