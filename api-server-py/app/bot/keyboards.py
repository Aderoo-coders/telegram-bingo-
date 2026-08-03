from telegram import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("🎮 Play Bingo"), KeyboardButton("💰 Deposit")],
            [KeyboardButton("💵 Balance"), KeyboardButton("💸 Withdraw"), KeyboardButton("📜 Transactions")],
        ],
        resize_keyboard=True,
    )


def contact_request_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton("📱 Share My Contact to Verify", request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def build_dashboard_keyboard(is_maintenance: bool) -> InlineKeyboardMarkup:
    label = f"🔧 Toggle Maintenance (currently: {'ON 🔴' if is_maintenance else 'OFF 🟢'})"
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("📊 View Stats", callback_data="admin_stats")],
            [InlineKeyboardButton(label, callback_data="toggle_maintenance")],
            [
                InlineKeyboardButton("💵 Pending Withdrawals", callback_data="admin_withdrawals"),
                InlineKeyboardButton("📥 Pending Deposits", callback_data="admin_deposits"),
            ],
        ]
    )


def build_stats_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Back to Dashboard", callback_data="admin_dashboard")]])


def deposit_review_keyboard(deposit_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Approve ✅", callback_data=f"approve_dep:{deposit_id}"),
                InlineKeyboardButton("Reject ❌", callback_data=f"reject_dep:{deposit_id}"),
            ]
        ]
    )
