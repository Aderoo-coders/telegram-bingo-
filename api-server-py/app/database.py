import logging
import ssl as ssl_module
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import asyncpg

from . import config

logger = logging.getLogger("bingo")

pool: asyncpg.Pool | None = None


def _prepare_dsn(url: str) -> str:
    """asyncpg manages SSL via an explicit `ssl=` kwarg (below), so strip
    sslmode/channel_binding query params that would otherwise confuse its
    own DSN parser; everything else about the URL is left untouched."""
    parsed = urlparse(url)
    query = [(k, v) for k, v in parse_qsl(parsed.query) if k not in ("sslmode", "channel_binding")]
    return urlunparse(parsed._replace(query=urlencode(query)))


async def create_pool() -> None:
    global pool
    url = config.DATABASE_URL
    if "localhost" in url or "127.0.0.1" in url:
        ssl_opt: bool | ssl_module.SSLContext = False
    else:
        ctx = ssl_module.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl_module.CERT_NONE
        ssl_opt = ctx
    pool = await asyncpg.create_pool(dsn=_prepare_dsn(url), ssl=ssl_opt)


async def close_pool() -> None:
    if pool is not None:
        await pool.close()


async def init_db() -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                  user_id BIGINT PRIMARY KEY,
                  username TEXT,
                  phone TEXT,
                  balance NUMERIC DEFAULT 30.0,
                  joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus NUMERIC DEFAULT 0.0")
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transactions (
                  id SERIAL PRIMARY KEY,
                  user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
                  type TEXT NOT NULL,
                  amount NUMERIC NOT NULL,
                  description TEXT,
                  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS withdrawals (
                  id SERIAL PRIMARY KEY,
                  user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
                  amount NUMERIC NOT NULL,
                  phone TEXT,
                  status TEXT DEFAULT 'pending',
                  request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  paid_time TIMESTAMP,
                  admin_note TEXT
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS games (
                  id SERIAL PRIMARY KEY,
                  stake NUMERIC NOT NULL,
                  status TEXT DEFAULT 'waiting',
                  called_numbers INTEGER[] DEFAULT '{}',
                  winner_id BIGINT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS game_players (
                  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
                  user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
                  selected_numbers INTEGER[] NOT NULL,
                  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (game_id, user_id)
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS deposits (
                  id SERIAL PRIMARY KEY,
                  user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
                  amount NUMERIC NOT NULL,
                  platform TEXT NOT NULL,
                  reference_id TEXT NOT NULL,
                  status TEXT DEFAULT 'pending',
                  request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  processed_time TIMESTAMP,
                  admin_note TEXT
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS settings (
                  key TEXT PRIMARY KEY,
                  value TEXT
                )
                """
            )
            await conn.execute(
                "INSERT INTO settings (key, value) VALUES ('maintenance_mode', 'OFF') ON CONFLICT (key) DO NOTHING"
            )
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_games_stake_status ON games(stake, status)")
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id, timestamp DESC)"
            )
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id)")
    logger.info("PostgreSQL database tables and indexes initialized successfully.")


async def get_user(user_id):
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM users WHERE user_id = $1", int(user_id))
        return dict(row) if row else None


async def register_user(user_id, username: str | None, phone: str):
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetch("SELECT * FROM users WHERE user_id = $1", int(user_id))
            is_new = len(existing) == 0

            row = await conn.fetchrow(
                """
                INSERT INTO users (user_id, username, phone, balance)
                VALUES ($1, $2, $3, 30.0)
                ON CONFLICT (user_id) DO UPDATE
                SET username = EXCLUDED.username, phone = COALESCE(NULLIF($3, ''), users.phone)
                RETURNING *
                """,
                int(user_id),
                username,
                phone,
            )

            tx_check = await conn.fetch(
                "SELECT id FROM transactions WHERE user_id = $1 AND type = 'welcome_bonus'", int(user_id)
            )
            if len(tx_check) == 0:
                if not is_new:
                    updated = await conn.fetchrow(
                        "UPDATE users SET balance = balance + 30.0 WHERE user_id = $1 RETURNING *", int(user_id)
                    )
                    if updated:
                        row = updated
                await conn.execute(
                    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                    int(user_id),
                    "welcome_bonus",
                    30.0,
                    "🎁 Welcome Bonus for joining Bingo Spark!",
                )
            return dict(row)


async def ensure_user_exists(user_id, username: str | None = None):
    user = await get_user(user_id)
    if not user:
        user = await register_user(user_id, username, "")
    else:
        await register_user(user_id, username or user.get("username"), user.get("phone") or "")
        user = await get_user(user_id)
    return user


async def _ensure_admin_balance(user_id) -> None:
    if not config.is_admin(user_id):
        return
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT balance FROM users WHERE user_id = $1", int(user_id))
        if not row or float(row["balance"]) < 100000.0:
            await conn.execute(
                """
                INSERT INTO users (user_id, username, phone, balance)
                VALUES ($1, 'Admin', 'Admin', 1000000.0)
                ON CONFLICT (user_id) DO UPDATE SET balance = 1000000.0
                """,
                int(user_id),
            )


async def get_balance(user_id) -> float:
    await _ensure_admin_balance(user_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT balance FROM users WHERE user_id = $1", int(user_id))
        return float(row["balance"]) if row else 0.0


async def get_wallet_balances(user_id) -> dict:
    await _ensure_admin_balance(user_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT balance, bonus FROM users WHERE user_id = $1", int(user_id))
        if not row:
            return {"balance": 0.0, "bonus": 0.0}
        return {"balance": float(row["balance"] or 0), "bonus": float(row["bonus"] or 0)}


async def update_balance(user_id, amount: float) -> float:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET balance = balance + $1 WHERE user_id = $2 RETURNING balance", amount, int(user_id)
        )
        return float(row["balance"]) if row else 0.0


async def update_bonus(user_id, amount: float) -> float:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET bonus = bonus + $1 WHERE user_id = $2 RETURNING bonus", amount, int(user_id)
        )
        return float(row["bonus"]) if row else 0.0


async def add_transaction(user_id, type_: str, amount: float, description: str):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4) RETURNING *",
            int(user_id),
            type_,
            amount,
            description,
        )
        return dict(row)


async def get_user_phone(user_id) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT phone FROM users WHERE user_id = $1", int(user_id))
        return row["phone"] if row else "Unknown"


async def create_withdrawal(user_id, amount: float, phone: str):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO withdrawals (user_id, amount, phone, status) VALUES ($1, $2, $3, 'pending') RETURNING *",
            int(user_id),
            amount,
            phone,
        )
        return dict(row)


async def get_pending_withdrawals() -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT w.*, u.username FROM withdrawals w
            JOIN users u ON w.user_id = u.user_id
            WHERE w.status = 'pending' ORDER BY w.request_time DESC
            """
        )
        return [dict(r) for r in rows]


async def update_withdrawal_status(id_: int, status: str, admin_note: str | None):
    import datetime

    paid_time = datetime.datetime.utcnow() if status == "completed" else None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE withdrawals SET status = $1, paid_time = $2, admin_note = $3 WHERE id = $4 RETURNING *",
            status,
            paid_time,
            admin_note,
            id_,
        )
        return dict(row) if row else None


async def create_game(stake: float, status: str = "CREATED"):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO games (stake, status) VALUES ($1, $2) RETURNING *", stake, status
        )
        return dict(row)


async def get_active_lobby(stake: float):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT * FROM games
            WHERE stake = $1 AND status IN ('CREATED', 'WAITING_FOR_PLAYERS', 'COUNTDOWN')
            ORDER BY created_at DESC LIMIT 1
            """,
            stake,
        )
        return dict(row) if row else None


async def join_game(game_id: int, user_id, selected_numbers: list[int]):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO game_players (game_id, user_id, selected_numbers) VALUES ($1, $2, $3) RETURNING *",
            game_id,
            int(user_id),
            selected_numbers,
        )
        return dict(row)


class InsufficientBalanceError(Exception):
    pass


async def join_game_atomic(
    game_id: int, user_id, stake: float, selected_numbers: list[int], username: str | None = None
) -> float:
    """Atomically checks balance, deducts stake, logs transaction, and joins
    the game in a single DB transaction. Auto-registers non-admin users with
    the 30 ETB welcome bonus if they don't exist yet."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            user_row = await conn.fetchrow(
                "SELECT balance FROM users WHERE user_id = $1 FOR UPDATE", int(user_id)
            )

            if config.is_admin(user_id):
                if not user_row or float(user_row["balance"]) < 100000.0:
                    await conn.execute(
                        """
                        INSERT INTO users (user_id, username, phone, balance)
                        VALUES ($1, 'Admin', 'Admin', 1000000.0)
                        ON CONFLICT (user_id) DO UPDATE SET balance = 1000000.0
                        """,
                        int(user_id),
                    )
                    user_row = await conn.fetchrow(
                        "SELECT balance FROM users WHERE user_id = $1 FOR UPDATE", int(user_id)
                    )
            elif not user_row:
                await conn.execute(
                    """
                    INSERT INTO users (user_id, username, phone, balance)
                    VALUES ($1, $2, '', 30.0)
                    ON CONFLICT (user_id) DO NOTHING
                    """,
                    int(user_id),
                    username or "Player",
                )
                await conn.execute(
                    """
                    INSERT INTO transactions (user_id, type, amount, description)
                    VALUES ($1, 'welcome_bonus', 30.0, '🎁 Welcome Bonus for joining Bingo Spark!')
                    ON CONFLICT DO NOTHING
                    """,
                    int(user_id),
                )
                user_row = await conn.fetchrow(
                    "SELECT balance FROM users WHERE user_id = $1 FOR UPDATE", int(user_id)
                )

            current_balance = float(user_row["balance"]) if user_row else 0.0
            if current_balance < stake:
                raise InsufficientBalanceError("INSUFFICIENT_BALANCE")

            new_row = await conn.fetchrow(
                "UPDATE users SET balance = balance - $1 WHERE user_id = $2 RETURNING balance",
                stake,
                int(user_id),
            )
            new_balance = float(new_row["balance"])

            await conn.execute(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                int(user_id),
                "stake_deduct",
                -stake,
                f"Staked on game #{game_id}",
            )

            await conn.execute(
                """
                INSERT INTO game_players (game_id, user_id, selected_numbers)
                VALUES ($1, $2, $3)
                ON CONFLICT (game_id, user_id) DO UPDATE SET selected_numbers = EXCLUDED.selected_numbers
                """,
                game_id,
                int(user_id),
                selected_numbers,
            )

            return new_balance


async def get_game_players(game_id: int) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT gp.*, u.username, u.phone FROM game_players gp
            JOIN users u ON gp.user_id = u.user_id
            WHERE gp.game_id = $1
            """,
            game_id,
        )
        return [dict(r) for r in rows]


async def update_game_status(game_id: int, status: str, winner_id=None, called_numbers: list[int] | None = None):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE games SET status = $1, winner_id = $2, called_numbers = $3 WHERE id = $4 RETURNING *",
            status,
            int(winner_id) if winner_id is not None else None,
            called_numbers or [],
            game_id,
        )
        return dict(row) if row else None


async def payout_game_atomic(
    game_id: int,
    winners: list[dict],
    admin_commission: float,
    called_numbers: list[int],
    primary_winner_id,
) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE games SET status = 'FINISHED', winner_id = $1, called_numbers = $2 WHERE id = $3",
                int(primary_winner_id) if primary_winner_id is not None else None,
                called_numbers,
                game_id,
            )
            for winner in winners:
                await conn.execute(
                    "UPDATE users SET balance = balance + $1 WHERE user_id = $2",
                    winner["payout"],
                    int(winner["userId"]),
                )
                await conn.execute(
                    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                    int(winner["userId"]),
                    "win_payout",
                    winner["payout"],
                    f"Won game #{game_id}",
                )
            if config.ADMIN_ID and admin_commission > 0:
                await conn.execute(
                    "UPDATE users SET balance = balance + $1 WHERE user_id = $2",
                    admin_commission,
                    config.ADMIN_ID,
                )
                await conn.execute(
                    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                    config.ADMIN_ID,
                    "admin_commission",
                    admin_commission,
                    f"20% admin fee from game #{game_id}",
                )


async def refund_game_atomic(game_id: int, players: list[dict], called_numbers: list[int]) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE games SET status = 'FINISHED', winner_id = NULL, called_numbers = $1 WHERE id = $2",
                called_numbers,
                game_id,
            )
            for player in players:
                await conn.execute(
                    "UPDATE users SET balance = balance + $1 WHERE user_id = $2",
                    player["stake"],
                    int(player["userId"]),
                )
                await conn.execute(
                    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
                    int(player["userId"]),
                    "refund",
                    player["stake"],
                    f"Refund for game #{game_id}",
                )


async def get_user_game_history(user_id) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT g.id, g.stake, g.status, g.winner_id, g.called_numbers, gp.joined_at,
                    u.username as winner_name,
                    (SELECT COUNT(*) FROM unnest(gp.selected_numbers) num WHERE num = ANY(g.called_numbers)) as matches
             FROM game_players gp
             JOIN games g ON gp.game_id = g.id
             LEFT JOIN users u ON g.winner_id = u.user_id
             WHERE gp.user_id = $1
             ORDER BY gp.joined_at DESC LIMIT 20
            """,
            int(user_id),
        )
        return [dict(r) for r in rows]


async def get_user_transactions(user_id, limit: int = 20) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT type, amount, description, timestamp FROM transactions WHERE user_id = $1 ORDER BY timestamp DESC LIMIT $2",
            int(user_id),
            limit,
        )
        return [dict(r) for r in rows]


async def create_deposit(user_id, amount: float, platform: str, reference_id: str):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO deposits (user_id, amount, platform, reference_id) VALUES ($1, $2, $3, $4) RETURNING *",
            int(user_id),
            amount,
            platform,
            reference_id,
        )
        return dict(row)


async def get_pending_deposits() -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT d.*, u.username
            FROM deposits d
            JOIN users u ON d.user_id = u.user_id
            WHERE d.status = 'pending'
            ORDER BY d.request_time DESC
            """
        )
        return [dict(r) for r in rows]


async def update_deposit_status(id_: int, status: str, admin_note: str = ""):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE deposits SET status = $1, processed_time = CURRENT_TIMESTAMP, admin_note = $2 WHERE id = $3 RETURNING *",
            status,
            admin_note,
            id_,
        )
        return dict(row) if row else None


async def get_maintenance_mode() -> bool:
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT value FROM settings WHERE key = 'maintenance_mode'")
            return bool(row) and row["value"] == "ON"
    except Exception:
        logger.exception("Error fetching maintenance mode")
        return False


async def set_maintenance_mode(on: bool) -> None:
    value = "ON" if on else "OFF"
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO settings (key, value) VALUES ('maintenance_mode', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            value,
        )


async def get_system_stats() -> dict:
    async with pool.acquire() as conn:
        total_users = await conn.fetchval("SELECT COUNT(*)::integer AS count FROM users")
        registered_users = await conn.fetchval(
            "SELECT COUNT(*)::integer AS count FROM users WHERE phone IS NOT NULL AND phone != ''"
        )
        total_etb = await conn.fetchval("SELECT COALESCE(SUM(balance + bonus), 0.0)::numeric AS total FROM users")
        return {
            "totalUsers": total_users,
            "registeredUsers": registered_users,
            "totalEtb": float(total_etb),
        }
