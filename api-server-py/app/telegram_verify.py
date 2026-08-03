import hashlib
import hmac
import json
import logging
from urllib.parse import parse_qsl

logger = logging.getLogger("bingo")


def verify_telegram_webapp(init_data: str, bot_token: str):
    """Port of game-manager.ts's verifyTelegramWebapp: validates Telegram
    WebApp initData via HMAC-SHA256 and returns the parsed `user` object, or
    None on any failure. No auth_date expiry check, matching the original.
    """
    try:
        # keep_blank_values matches URLSearchParams (empty values are kept,
        # not dropped); parse_qsl also decodes '+' as space by default, same
        # as URLSearchParams.
        pairs = parse_qsl(init_data, keep_blank_values=True)
        params: dict[str, str] = {}
        for key, value in pairs:
            # URLSearchParams.get() returns only the FIRST value for a
            # repeated key; parse_qsl yields all occurrences in order, so
            # only set if not already present.
            if key not in params:
                params[key] = value

        data_hash = params.get("hash")
        if not data_hash:
            return None

        keys = sorted(k for k in params.keys() if k != "hash")
        data_check_string = "\n".join(f"{k}={params[k]}" for k in keys)

        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if calculated_hash == data_hash:
            user_str = params.get("user")
            if user_str:
                return json.loads(user_str)
    except Exception:
        logger.exception("Error verifying telegram initData")
    return None
