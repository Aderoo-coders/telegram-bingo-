import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import config, database
from ..telegram_verify import verify_telegram_webapp

logger = logging.getLogger("bingo")

router = APIRouter()


@router.get("/api/user-balance")
async def user_balance(request: Request):
    init_data = request.query_params.get("initData")
    if not init_data:
        return JSONResponse({"error": "Missing initData"}, status_code=400)
    try:
        user = verify_telegram_webapp(init_data, config.BOT_TOKEN)
        if not user:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        balances = await database.get_wallet_balances(user["id"])
        return {"balance": balances["balance"], "bonus": balances["bonus"]}
    except Exception:
        logger.exception("Error in /api/user-balance")
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@router.get("/api/user-profile")
async def user_profile(request: Request):
    init_data = request.query_params.get("initData")
    if not init_data:
        return JSONResponse({"error": "Missing initData"}, status_code=400)
    try:
        user_obj = verify_telegram_webapp(init_data, config.BOT_TOKEN)
        if not user_obj:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)

        user = await database.get_user(user_obj["id"])
        if not user:
            username = user_obj.get("username") or user_obj.get("first_name") or "Player"
            user = await database.ensure_user_exists(user_obj["id"], username)

        return {
            "userId": user["user_id"],
            "username": user["username"],
            "phone": user["phone"],
            "balance": float(user["balance"]),
            "bonus": float(user.get("bonus") or 0),
        }
    except Exception:
        logger.exception("Error in /api/user-profile")
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@router.get("/api/user-history")
async def user_history(request: Request):
    init_data = request.query_params.get("initData")
    if not init_data:
        return JSONResponse({"error": "Missing initData"}, status_code=400)
    try:
        user = verify_telegram_webapp(init_data, config.BOT_TOKEN)
        if not user:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        history = await database.get_user_game_history(user["id"])
        return {"history": history}
    except Exception:
        logger.exception("Error in /api/user-history")
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@router.get("/api/user-transactions")
async def user_transactions(request: Request):
    init_data = request.query_params.get("initData")
    if not init_data:
        return JSONResponse({"error": "Missing initData"}, status_code=400)
    try:
        user = verify_telegram_webapp(init_data, config.BOT_TOKEN)
        if not user:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        transactions = await database.get_user_transactions(user["id"])
        return {"transactions": transactions}
    except Exception:
        logger.exception("Error in /api/user-transactions")
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@router.post("/api/request-withdrawal")
async def request_withdrawal(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    init_data = body.get("initData")
    amount = body.get("amount")
    if not init_data or amount is None:
        return JSONResponse({"error": "Missing parameters"}, status_code=400)

    try:
        parsed_amount = float(amount)
    except (TypeError, ValueError):
        parsed_amount = float("nan")
    if parsed_amount != parsed_amount or parsed_amount < 50:
        return JSONResponse({"error": "Minimum withdrawal is 50 ETB."}, status_code=400)

    try:
        user_obj = verify_telegram_webapp(init_data, config.BOT_TOKEN)
        if not user_obj:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        user_id = user_obj["id"]

        user = await database.get_user(user_id)
        if not user or not user.get("phone"):
            return JSONResponse({"error": "User registration not completed."}, status_code=400)

        balance = float(user["balance"])
        if balance < parsed_amount:
            return JSONResponse({"error": "Insufficient balance."}, status_code=400)

        await database.update_balance(user_id, -parsed_amount)
        withdrawal = await database.create_withdrawal(user_id, parsed_amount, user["phone"])
        await database.add_transaction(
            user_id,
            "withdrawal_request",
            -parsed_amount,
            f"Pending withdrawal to {user['phone']} (Ref ID: {withdrawal['id']})",
        )

        if config.ADMIN_ID:
            from ..bot import application as bot_app

            admin_text = (
                "🔔 *New WebApp Withdrawal Request*\n\n"
                f"👤 *Ref ID:* `{withdrawal['id']}`\n"
                f"👤 *User ID:* `{user_id}`\n"
                f"👤 *Username:* @{user.get('username') or 'N/A'}\n"
                f"📱 *Phone:* {user['phone']}\n"
                f"💰 *Amount:* {parsed_amount:.2f} ETB\n\n"
                f"To approve, use: `/approve_withdraw {withdrawal['id']}`\n"
                f"To reject, use: `/reject_withdraw {withdrawal['id']}`"
            )
            try:
                await bot_app.bot.send_message(config.ADMIN_ID, admin_text, parse_mode="Markdown")
            except Exception:
                logger.exception("Error notifying admin of WebApp withdrawal")

        return {"success": True, "refId": withdrawal["id"], "newBalance": balance - parsed_amount}
    except Exception:
        logger.exception("Error in /api/request-withdrawal")
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@router.post("/api/request-deposit")
async def request_deposit(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    init_data = body.get("initData")
    amount = body.get("amount")
    platform = body.get("platform")
    reference_id = body.get("referenceId")
    if not init_data or amount is None or not platform or not reference_id:
        return JSONResponse({"error": "Missing parameters"}, status_code=400)

    try:
        parsed_amount = float(amount)
    except (TypeError, ValueError):
        parsed_amount = float("nan")
    if parsed_amount != parsed_amount or parsed_amount <= 0:
        return JSONResponse({"error": "Invalid deposit amount."}, status_code=400)

    try:
        user_obj = verify_telegram_webapp(init_data, config.BOT_TOKEN)
        if not user_obj:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        user_id = user_obj["id"]

        user = await database.get_user(user_id)
        if not user:
            return JSONResponse({"error": "User registration not completed."}, status_code=400)

        deposit = await database.create_deposit(user_id, parsed_amount, platform, reference_id)

        if config.ADMIN_ID:
            from ..bot import application as bot_app
            from ..bot.keyboards import deposit_review_keyboard

            admin_text = (
                f"🔔 *New Deposit Request (#{deposit['id']})*\n\n"
                f"👤 *User ID:* `{user_id}`\n"
                f"👤 *Username:* @{user.get('username') or 'N/A'}\n"
                f"📱 *Platform:* *{platform.upper()}*\n"
                f"💰 *Amount:* {parsed_amount:.2f} ETB\n"
                f"🧾 *Ref/TXID:* `{reference_id}`\n\n"
                "Please verify the transaction and choose an action:"
            )
            try:
                await bot_app.bot.send_message(
                    config.ADMIN_ID,
                    admin_text,
                    parse_mode="Markdown",
                    reply_markup=deposit_review_keyboard(deposit["id"]),
                )
            except Exception:
                logger.exception("Error notifying admin of deposit")

        return {"success": True, "refId": deposit["id"]}
    except Exception:
        logger.exception("Error in /api/request-deposit")
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@router.get("/status")
async def status():
    return {"status": "ok", "bot": "active"}
