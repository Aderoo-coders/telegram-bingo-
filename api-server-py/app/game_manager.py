import asyncio
import json
import logging
import random
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from . import config, database
from .telegram_verify import verify_telegram_webapp

logger = logging.getLogger("bingo")


@dataclass
class Player:
    user_id: str
    username: str
    numbers: list[int]
    ws: WebSocket | None


@dataclass
class GameSession:
    game_id: int
    stake: float
    status: str
    players: list[Player] = field(default_factory=list)
    countdown_task: asyncio.Task | None = None
    countdown_seconds: int = 30
    called_numbers: list[int] = field(default_factory=list)
    draw_task: asyncio.Task | None = None
    available_numbers: list[int] = field(default_factory=list)
    rng_seed: str = ""  # generated for structural parity; unused, same as the Node original
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


sessions: dict[int, GameSession] = {}


def _parse_int_loose(value) -> int | None:
    """Best-effort port of JS's permissive `parseInt(value, 10)`. The real
    frontend always sends a proper integer/int-like string for `stake`, so
    this only needs to handle the realistic cases faithfully; a value with
    no leading digits at all (unreachable from the real client) is treated
    as invalid and the join message is dropped, rather than trying to
    replicate JS's NaN-propagates-into-a-DB-call behavior exactly."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    match = re.match(r"^\s*[+-]?\d+", str(value))
    return int(match.group(0)) if match else None


async def send_to_player(player: Player, message: dict) -> None:
    if player.ws is None:
        return
    try:
        await player.ws.send_text(json.dumps(message))
    except Exception:
        logger.debug("Failed to send to player %s (socket likely closed)", player.user_id)


async def broadcast(session: GameSession, message: dict) -> None:
    for player in session.players:
        await send_to_player(player, message)


async def transition_session_state(session: GameSession, next_status: str) -> None:
    logger.info("[Game #%s] State Transition: %s -> %s", session.game_id, session.status, next_status)
    session.status = next_status
    try:
        await database.update_game_status(session.game_id, next_status, None, session.called_numbers)
    except Exception:
        logger.exception("Error persisting status %s for game #%s", next_status, session.game_id)
    await broadcast(session, {"event": "STATE_CHANGE", "gameId": session.game_id, "status": session.status})


def is_game_running_for_stake(stake: float) -> bool:
    return any(
        s.stake == stake and s.status in ("LOCKED", "DRAWING", "WINNER_PENDING", "PAYOUT")
        for s in sessions.values()
    )


async def broadcast_lobby_update(session: GameSession) -> None:
    await broadcast(
        session,
        {
            "status": "lobby_update",
            "event": "LOBBY_UPDATE",
            "players": [{"userId": p.user_id} for p in session.players],
            "countdown": session.countdown_seconds,
            "isCountdownActive": session.countdown_task is not None,
            "isGameRunning": is_game_running_for_stake(session.stake),
        },
    )


async def get_or_create_lobby(stake: float) -> GameSession:
    for session in sessions.values():
        if session.stake == stake and session.status in ("WAITING_FOR_PLAYERS", "COUNTDOWN", "CREATED"):
            return session

    row = await database.get_active_lobby(stake)
    if row:
        game_id = row["id"]
    else:
        row = await database.create_game(stake, "CREATED")
        game_id = row["id"]

    session = GameSession(
        game_id=game_id,
        stake=stake,
        status="CREATED",
        rng_seed=secrets.token_hex(16),
    )
    sessions[game_id] = session
    await transition_session_state(session, "WAITING_FOR_PLAYERS")
    return session


async def check_and_start_next_round(stake: float) -> None:
    for session in list(sessions.values()):
        if session.stake != stake or session.status not in ("WAITING_FOR_PLAYERS", "CREATED"):
            continue
        await broadcast_lobby_update(session)
        if (
            len(session.players) >= 2
            and session.countdown_task is None
            and not is_game_running_for_stake(stake)
        ):
            await start_countdown(session)


async def start_countdown(session: GameSession) -> None:
    if session.status != "WAITING_FOR_PLAYERS":
        return
    await transition_session_state(session, "COUNTDOWN")
    session.countdown_seconds = 30
    session.countdown_task = asyncio.create_task(_countdown_loop(session))


async def _countdown_loop(session: GameSession) -> None:
    try:
        while True:
            await asyncio.sleep(1)
            session.countdown_seconds -= 1
            await broadcast(
                session,
                {"status": "countdown", "event": "COUNTDOWN", "secondsLeft": session.countdown_seconds},
            )
            if session.countdown_seconds <= 0:
                session.countdown_task = None
                await lock_lobby(session)
                return
    except asyncio.CancelledError:
        raise


async def lock_lobby(session: GameSession) -> None:
    await transition_session_state(session, "LOCKED")
    await broadcast(session, {"event": "LOCKED", "message": "Lobby locked. Preparing game draw..."})
    asyncio.create_task(_delayed_start_game(session))


async def _delayed_start_game(session: GameSession) -> None:
    await asyncio.sleep(1.5)
    await start_game(session)


async def start_game(session: GameSession) -> None:
    await transition_session_state(session, "DRAWING")
    await broadcast(
        session,
        {
            "status": "game_start",
            "event": "DRAW_START",
            "players": [{"userId": p.user_id, "username": p.username, "numbers": p.numbers} for p in session.players],
        },
    )
    session.available_numbers = list(range(1, 76))
    random.shuffle(session.available_numbers)
    session.called_numbers = []
    session.draw_task = asyncio.create_task(_draw_loop(session))


async def _draw_loop(session: GameSession) -> None:
    try:
        while True:
            await asyncio.sleep(2)

            if not session.available_numbers:
                session.draw_task = None
                await handle_draw_refund(session)
                return

            drawn = session.available_numbers.pop()
            session.called_numbers.append(drawn)
            await broadcast(
                session,
                {"status": "draw", "event": "NUMBER_DRAWN", "number": drawn, "calledNumbers": session.called_numbers},
            )

            winners = []
            for player in session.players:
                match_count = sum(1 for n in player.numbers if n in session.called_numbers)
                target = min(12, len(player.numbers))
                if match_count >= target:
                    winners.append(player)

            if winners:
                session.draw_task = None
                asyncio.create_task(process_winner_verification_pipeline(session, winners))
                return
    except asyncio.CancelledError:
        raise


async def process_winner_verification_pipeline(session: GameSession, claimed_winners: list[Player]) -> None:
    logger.info(
        "[Game #%s] [1. Winning Claim] Received claim candidate(s): %s",
        session.game_id,
        ", ".join(w.username for w in claimed_winners),
    )
    await transition_session_state(session, "WINNER_PENDING")

    called_set = set(session.called_numbers)
    verified_winners = []
    for candidate in claimed_winners:
        valid_matches = [n for n in candidate.numbers if n in called_set]
        target = min(12, len(candidate.numbers))
        if len(valid_matches) >= target:
            verified_winners.append(candidate)

    if not verified_winners:
        logger.warning("[Game #%s] All winner claims failed backend verification. Resuming drawing...", session.game_id)
        await transition_session_state(session, "DRAWING")
        # Deviation from the Node original (intentional, per product decision):
        # Node never restarts the draw interval here, so the game silently
        # stalls forever if this branch is ever hit. Restart it instead.
        session.draw_task = asyncio.create_task(_draw_loop(session))
        return

    await transition_session_state(session, "PAYOUT")

    total_stake = len(session.players) * session.stake
    admin_commission = total_stake * 0.20
    prize_pool = total_stake - admin_commission
    payout_per_winner = prize_pool / len(verified_winners)
    primary_winner_id = verified_winners[0].user_id

    try:
        await database.payout_game_atomic(
            session.game_id,
            [{"userId": w.user_id, "payout": payout_per_winner} for w in verified_winners],
            admin_commission,
            session.called_numbers,
            primary_winner_id,
        )
        await transition_session_state(session, "FINISHED")
        await broadcast(
            session,
            {
                "status": "finished",
                "event": "GAME_FINISHED",
                "outcome": "winner",
                "winners": [{"userId": w.user_id, "username": w.username} for w in verified_winners],
                "calledNumbers": session.called_numbers,
                "payout": payout_per_winner,
                "totalStake": total_stake,
                "adminCommission": admin_commission,
                "prizePool": prize_pool,
            },
        )
    except Exception:
        logger.exception("Payout failed for game #%s", session.game_id)
    finally:
        await check_and_start_next_round(session.stake)
        asyncio.create_task(_archive_after_delay(session))


async def handle_draw_refund(session: GameSession) -> None:
    await transition_session_state(session, "PAYOUT")
    try:
        await database.refund_game_atomic(
            session.game_id,
            [{"userId": p.user_id, "stake": session.stake} for p in session.players],
            session.called_numbers,
        )
        await transition_session_state(session, "FINISHED")
        await broadcast(
            session,
            {
                "status": "finished",
                "event": "GAME_FINISHED",
                "outcome": "draw",
                "message": "Game ended in a draw. All player stakes have been refunded.",
            },
        )
    except Exception:
        logger.exception("Refund failed for game #%s", session.game_id)
    finally:
        await check_and_start_next_round(session.stake)
        asyncio.create_task(_archive_after_delay(session))


async def _archive_after_delay(session: GameSession) -> None:
    await asyncio.sleep(60)
    await archive_session(session)


async def archive_session(session: GameSession) -> None:
    await transition_session_state(session, "ARCHIVED")
    sessions.pop(session.game_id, None)


async def _refund_on_early_leave(session: GameSession, player: Player) -> None:
    try:
        await database.refund_game_atomic(
            session.game_id, [{"userId": player.user_id, "stake": session.stake}], []
        )
    except Exception:
        logger.exception("Failed to refund early-leave player %s from game #%s", player.user_id, session.game_id)


def get_active_games_status() -> str:
    parts = [f"#{s.game_id} ({s.stake} ETB)" for s in sessions.values() if s.status in ("DRAWING", "LOCKED")]
    return ", ".join(parts)


async def handle_connection(ws: WebSocket) -> None:
    joined_player: Player | None = None
    joined_session: GameSession | None = None
    is_reconnect = False

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                logger.error("WebSocket message parsing error")
                continue

            if data.get("action") != "join":
                continue

            init_data = data.get("initData") or ""
            numbers = data.get("numbers")
            parsed_stake = _parse_int_loose(data.get("stake"))
            if parsed_stake is None:
                continue

            telegram_user = verify_telegram_webapp(init_data, config.BOT_TOKEN)
            if not telegram_user:
                await ws.send_text(
                    json.dumps({"status": "error", "message": "Authentication failed. Please launch app via Telegram."})
                )
                await ws.close()
                return

            user_id = str(telegram_user["id"])
            username = telegram_user.get("username") or telegram_user.get("first_name") or "Player"

            # Reconnection check — runs before numbers validation, and (like
            # the Node original) ignores whatever stake/numbers were resent.
            reconnect_player = None
            reconnect_session = None
            for session in sessions.values():
                if session.status in ("FINISHED", "ARCHIVED"):
                    continue
                for p in session.players:
                    if p.user_id == user_id:
                        reconnect_player, reconnect_session = p, session
                        break
                if reconnect_player:
                    break

            if reconnect_player and reconnect_session:
                reconnect_player.ws = ws
                await send_to_player(
                    reconnect_player,
                    {
                        "status": "reconnected",
                        "event": "RECONNECT_SUCCESS",
                        "gameId": reconnect_session.game_id,
                        "stake": reconnect_session.stake,
                        "state": reconnect_session.status,
                        "calledNumbers": reconnect_session.called_numbers,
                        "countdown": reconnect_session.countdown_seconds,
                        "numbers": reconnect_player.numbers,
                        "players": [{"userId": p.user_id} for p in reconnect_session.players],
                    },
                )
                joined_player, joined_session, is_reconnect = reconnect_player, reconnect_session, True
                continue

            if not isinstance(numbers, list) or not (1 <= len(numbers) <= 75):
                await ws.send_text(
                    json.dumps({"status": "error", "message": "You must select at least one valid bingo card."})
                )
                continue

            unique_numbers = list(dict.fromkeys(numbers))
            if len(unique_numbers) != len(numbers) or any(not isinstance(n, int) or n < 1 or n > 75 for n in numbers):
                await ws.send_text(
                    json.dumps(
                        {
                            "status": "error",
                            "message": "Invalid card numbers. Bingo values must be between 1 and 75 with no duplicates.",
                        }
                    )
                )
                continue

            if await database.get_maintenance_mode() and not config.is_admin(user_id):
                await ws.send_text(
                    json.dumps({"status": "error", "message": "The game is under maintenance. Play is temporarily disabled."})
                )
                continue

            session = await get_or_create_lobby(parsed_stake)
            if session.status not in ("WAITING_FOR_PLAYERS", "COUNTDOWN"):
                await ws.send_text(
                    json.dumps({"status": "error", "message": "Lobby is locked or game is already in progress. Please try again."})
                )
                continue

            if any(p.user_id == user_id for p in session.players):
                await ws.send_text(json.dumps({"status": "error", "message": "You have already joined this lobby."}))
                continue

            try:
                new_balance = await database.join_game_atomic(
                    session.game_id, user_id, parsed_stake, unique_numbers, username
                )
            except database.InsufficientBalanceError:
                await ws.send_text(json.dumps({"status": "error", "message": "Insufficient wallet balance."}))
                continue
            except Exception:
                logger.exception("Failed to join game lobby")
                await ws.send_text(json.dumps({"status": "error", "message": "Failed to join game lobby."}))
                continue

            new_player = Player(user_id=user_id, username=username, numbers=unique_numbers, ws=ws)
            session.players.append(new_player)
            joined_player, joined_session, is_reconnect = new_player, session, False

            await send_to_player(
                new_player,
                {
                    "status": "joined",
                    "event": "JOIN_SUCCESS",
                    "gameId": session.game_id,
                    "stake": parsed_stake,
                    "numbers": unique_numbers,
                    "balance": new_balance,
                },
            )
            await broadcast_lobby_update(session)

            if (
                len(session.players) >= 2
                and session.status == "WAITING_FOR_PLAYERS"
                and not is_game_running_for_stake(session.stake)
            ):
                await start_countdown(session)

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket handler error")
    finally:
        if joined_player and joined_session:
            if is_reconnect:
                joined_player.ws = None
            elif joined_session.status in ("WAITING_FOR_PLAYERS", "COUNTDOWN"):
                joined_session.players = [p for p in joined_session.players if p.user_id != joined_player.user_id]
                asyncio.create_task(_refund_on_early_leave(joined_session, joined_player))
                await broadcast_lobby_update(joined_session)
                if len(joined_session.players) < 2 and joined_session.countdown_task is not None:
                    joined_session.countdown_task.cancel()
                    joined_session.countdown_task = None
                    joined_session.countdown_seconds = 45
                    await transition_session_state(joined_session, "WAITING_FOR_PLAYERS")
                    await broadcast(joined_session, {"status": "countdown_stopped", "event": "COUNTDOWN_STOPPED"})
            else:
                joined_player.ws = None
