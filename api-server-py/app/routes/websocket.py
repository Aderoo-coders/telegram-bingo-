from fastapi import APIRouter, WebSocket

from .. import game_manager

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    # Only this exact path is ever routed here by FastAPI; any other path
    # is a 404 at the ASGI routing layer, same effect as the Node original's
    # manual `if (urlObj.pathname === '/ws') ... else socket.destroy()`.
    await websocket.accept()
    await game_manager.handle_connection(websocket)
