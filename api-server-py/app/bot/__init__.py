from telegram.ext import Application

from .. import config
from .handlers.admin import register_admin_handlers
from .handlers.game import register_game_handlers
from .handlers.user import register_user_handlers

if not config.BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is required to run the Telegram Bot")

application: Application = Application.builder().token(config.BOT_TOKEN).build()

# Registration order mirrors the Node original (user -> game -> admin); PTB's
# handler dispatch doesn't depend on this order the way grammy's `bot.use`
# middleware chain did (each handler here matches on distinct
# commands/text/callback patterns), but the ordering is kept for parity.
register_user_handlers(application)
register_game_handlers(application)
register_admin_handlers(application)
