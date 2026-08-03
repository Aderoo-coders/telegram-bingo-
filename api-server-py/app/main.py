import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from telegram import Update

from . import config, database
from .routes.api import router as api_router
from .routes.websocket import router as websocket_router

# Bot message templates throughout this app are full of emoji (Telegram
# messages, not just logs), and on Windows, stdout/stderr default to the
# legacy cp1252 console code page rather than UTF-8 — so any log line that
# happens to include emoji or other non-cp1252 Unicode would otherwise crash
# the logging call with UnicodeEncodeError. Reconfigure both streams to UTF-8
# (Python 3.7+) so logging can never take the process down over encoding.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bingo")

# httpx (used internally by python-telegram-bot) logs full request URLs at
# INFO level, and Telegram's Bot API embeds the bot token directly in the
# URL path (https://api.telegram.org/bot<TOKEN>/...) — so leaving this at
# INFO would print the secret token to stdout/logs on every bot API call.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# Registering the webhook with Telegram is guarded behind this env var so
# that local/dev runs of this port never steal the live webhook from
# whichever backend is actually meant to be receiving it. Set to "true" only
# at real cutover time.
ENABLE_TELEGRAM_WEBHOOK = os.environ.get("ENABLE_TELEGRAM_WEBHOOK", "false").lower() == "true"

REPO_ROOT = Path(__file__).resolve().parents[2]
WEBAPP_PATH = REPO_ROOT / "webapp"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ─── Startup ──────────────────────────────────────────────────────────
    await database.create_pool()

    # Mirrors the Node original's pool 'error' handler: don't let a pool-level
    # error crash the whole process, just log it.
    def _pool_exception_handler(loop, context):
        logger.error("Postgres pool / asyncio error (connection kept): %s", context.get("message"), exc_info=context.get("exception"))

    asyncio.get_running_loop().set_exception_handler(_pool_exception_handler)

    try:
        await database.init_db()
    except Exception:
        logger.exception("Failed to start server (init_db)")

    from .bot import application as bot_app

    await bot_app.initialize()
    await bot_app.start()

    if ENABLE_TELEGRAM_WEBHOOK:
        webhook_url = f"{config.WEBAPP_URL}/telegram/webhook"
        try:
            await bot_app.bot.set_webhook(
                webhook_url, secret_token=config.WEBHOOK_SECRET, drop_pending_updates=True
            )
            logger.info("Telegram Bot webhook registered at %s", webhook_url)
        except Exception:
            logger.exception("Failed to register Telegram webhook")
    else:
        logger.info("ENABLE_TELEGRAM_WEBHOOK is off — skipping bot.set_webhook (dev/testing mode).")

    logger.info("Serving static webapp from: %s", WEBAPP_PATH)

    yield

    # ─── Shutdown ─────────────────────────────────────────────────────────
    await bot_app.stop()
    await bot_app.shutdown()
    await database.close_pool()


app = FastAPI(lifespan=lifespan)

# The frontend is now deployed separately (Cloudflare Pages, a different
# origin from this API), so cross-origin fetch()/WebSocket calls need CORS.
# The Node original never needed this since it served the frontend itself
# same-origin. Local dev (Vite proxy) doesn't hit CORS at all, but is
# allowed too in case the dev server is ever pointed at this API directly.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://([a-z0-9-]+\.)?telegram-bingo\.pages\.dev|http://localhost:\d+",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Mirrors the Node original's process-level uncaughtException/unhandled
    # Rejection guards: log and keep serving instead of taking the process
    # down over a single bad request.
    logger.exception("Unhandled exception while handling %s %s", request.method, request.url.path)
    return JSONResponse({"error": "Internal server error"}, status_code=500)


app.include_router(api_router)
app.include_router(websocket_router)

if WEBAPP_PATH.exists():
    app.mount("/webapp", StaticFiles(directory=str(WEBAPP_PATH), html=True), name="webapp")


@app.get("/")
async def root():
    return RedirectResponse("/webapp/index.html")


@app.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    secret_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if secret_header != config.WEBHOOK_SECRET:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    from .bot import application as bot_app

    data = await request.json()
    update = Update.de_json(data, bot_app.bot)
    await bot_app.process_update(update)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=config.PORT, reload=False)
