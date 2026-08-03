import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("bingo")

DEFAULT_ADMIN_IDS = [2146240208, 7636281033]


def _parse_admin_ids() -> list[int]:
    raw = os.environ.get("ADMIN_IDS") or os.environ.get("ADMIN_ID") or ""
    from_env: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        try:
            value = int(part)
        except ValueError:
            continue
        if value > 0:
            from_env.append(value)
    # dict.fromkeys preserves insertion order while de-duplicating, matching
    # JS's `[...new Set([...DEFAULT_ADMIN_IDS, ...fromEnv])]`.
    return list(dict.fromkeys(DEFAULT_ADMIN_IDS + from_env))


_ADMIN_IDS = _parse_admin_ids()


def is_admin(user_id) -> bool:
    if not user_id:
        return False
    try:
        num = int(user_id)
    except (TypeError, ValueError):
        return False
    return num in _ADMIN_IDS


BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
ADMIN_ID = _ADMIN_IDS[0] if _ADMIN_IDS else 0
ADMIN_IDS = _ADMIN_IDS
SESSION_SECRET = os.environ.get("SESSION_SECRET", "default-session-secret-change-me")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "http://localhost:8080")
PORT = int(os.environ.get("PORT", "8080"))
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET") or SESSION_SECRET

if not BOT_TOKEN:
    logger.error("BOT_TOKEN is missing in environment variables.")
if not DATABASE_URL:
    logger.error("DATABASE_URL is missing in environment variables.")
