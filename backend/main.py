from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
from sentence_transformers import SentenceTransformer

from backend.api.routes import router as api_router
from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.config import settings
from backend.core.brain import AIBrain
from backend.core.memory import RAGMemory
from backend.core.router import SemanticRouter
from backend.voice.audio_manager import VoiceManager

hub = WebSocketHub()


async def heartbeat_task() -> None:
    while True:
        await hub.broadcast(
            BroadcastMessage(
                event="heartbeat",
                payload={
                    "service": settings.app_name,
                    "connections": hub.connection_count,
                },
            )
        )
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    semantic_router = SemanticRouter(model=embedding_model, privacy_mode=settings.privacy_mode)
    rag_memory = RAGMemory(embedding_model=embedding_model)
    _app.state.brain = AIBrain(settings, router=semantic_router, memory=rag_memory)
    _app.state.voice = VoiceManager.from_settings(brain=_app.state.brain, hub=hub, settings=settings)
    _app.state.hub = hub
    task = asyncio.create_task(heartbeat_task())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.include_router(api_router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await hub.connect(websocket)
    await hub.broadcast(BroadcastMessage(event="status", payload={"message": "client_connected"}))
    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get("payload", {})

            if event == "chat":
                message = str(payload.get("message", "")).strip()
                if not message:
                    await hub.broadcast(
                        BroadcastMessage(
                            event="brain:error",
                            payload={"error": "Message is required", "recoverable": True},
                        )
                    )
                    continue

                prefer_cloud = bool(payload.get("prefer_cloud", False))
                async for _ in app.state.brain.chat_stream(message=message, hub=hub, prefer_cloud=prefer_cloud):
                    pass

            elif event == "confirm_tool":
                request_id = str(payload.get("request_id", ""))
                approved = bool(payload.get("approved", False))
                resolved = app.state.brain.tool_executor.resolve_confirmation(request_id, approved)
                await hub.broadcast(
                    BroadcastMessage(
                        event="brain:confirm_response",
                        payload={"request_id": request_id, "approved": approved, "resolved": resolved},
                    )
                )
            elif event == "voice:transcript":
                transcript = str(payload.get("text", "")).strip()
                prefer_cloud = bool(payload.get("prefer_cloud", False))
                if transcript:
                    await app.state.voice.process_transcript(transcript, prefer_cloud=prefer_cloud)
            elif event == "voice:wake":
                keyword = str(payload.get("keyword", "hey jarvis"))
                confidence = float(payload.get("confidence", 1.0))
                await app.state.voice.simulate_wake_word(keyword=keyword, confidence=confidence)
            else:
                await hub.broadcast(BroadcastMessage(event="echo", payload={"received": data}))
    except WebSocketDisconnect:
        await hub.disconnect(websocket)
        await hub.broadcast(BroadcastMessage(event="status", payload={"message": "client_disconnected"}))


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host=settings.host, port=settings.port, reload=False)
