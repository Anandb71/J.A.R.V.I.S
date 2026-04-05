from __future__ import annotations

import json
import asyncio
import multiprocessing
import sys
import hashlib
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
from sentence_transformers import SentenceTransformer
import numpy as np

from backend.api.routes import router as api_router
from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.config import settings
from backend.core.brain import AIBrain
from backend.core.memory import RAGMemory
from backend.core.router import SemanticRouter
from backend.gestures.hand_tracker import HandTracker
from backend.logging import configure_logging
from backend.system.monitor import SystemMonitor
from backend.utils.crash_reporter import install_crash_hooks
from backend.utils.watchdog import watchdog_loop
from backend.voice.duplex_pipeline import DuplexVoicePipeline
from backend.voice.audio_manager import VoiceManager
from backend.vision.manager import VisionManager

try:
    import structlog  # type: ignore

    log = structlog.get_logger(__name__)
except Exception:
    import logging

    log = logging.getLogger(__name__)

hub = WebSocketHub()


class FallbackEmbeddingModel:
    """Deterministic local embedding fallback when sentence-transformers cannot initialize."""

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim

    def _embed_one(self, text: str) -> np.ndarray:
        vec = np.zeros(self.dim, dtype=np.float32)
        clean = text.strip().lower() or "jarvis"
        for i in range(self.dim):
            digest = hashlib.sha256(f"{clean}:{i}".encode("utf-8")).digest()
            value = int.from_bytes(digest[:2], byteorder="big", signed=False)
            vec[i] = (value / 65535.0) * 2.0 - 1.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec

    def encode(self, texts):
        if isinstance(texts, str):
            return self._embed_one(texts)
        return np.asarray([self._embed_one(str(item)) for item in texts])


def load_embedding_model():
    try:
        return SentenceTransformer("all-MiniLM-L6-v2", local_files_only=True)
    except Exception as cached_exc:
        log.warning("embedding.load.cached_failed", error=str(cached_exc))
        try:
            return SentenceTransformer("all-MiniLM-L6-v2")
        except Exception as download_exc:
            log.error("embedding.load.fallback", error=str(download_exc))
            return FallbackEmbeddingModel()


async def heartbeat_task() -> None:
    while True:
        try:
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
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("heartbeat_task.error", error=str(exc))
            await asyncio.sleep(1)


async def gesture_events_task(_app: FastAPI) -> None:
    while True:
        try:
            tracker = getattr(_app.state, "gesture_tracker", None)
            if tracker is None or not tracker.is_running:
                await asyncio.sleep(0.25)
                continue

            event = await tracker.next_event(timeout=0.5)
            if event:
                await hub.broadcast(BroadcastMessage(event="gesture:event", payload=event))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("gesture_events_task.error", error=str(exc))
            await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    is_packaged = bool(getattr(sys, "frozen", False))
    configure_logging(dev_mode=not is_packaged, log_to_file=is_packaged)
    install_crash_hooks(app_version=settings.app_version)
    log.info("app.starting", app=settings.app_name, version=settings.app_version)
    embedding_model = load_embedding_model()
    semantic_router = SemanticRouter(model=embedding_model, privacy_mode=settings.privacy_mode)
    rag_memory = RAGMemory(embedding_model=embedding_model)
    _app.state.vision = VisionManager.from_settings(settings)
    _app.state.brain = AIBrain(settings, router=semantic_router, memory=rag_memory, vision=_app.state.vision)
    _app.state.voice = VoiceManager.from_settings(brain=_app.state.brain, hub=hub, settings=settings)
    _app.state.system_monitor = SystemMonitor(hub=hub, interval=settings.system_metrics_interval)
    _app.state.gesture_tracker = HandTracker(camera_index=settings.gesture_camera_index)
    _app.state.hub = hub
    _app.state.duplex_pipelines = {}  # Per-client voice pipelines (created in Step 3)
    task = asyncio.create_task(heartbeat_task())
    metrics_task = asyncio.create_task(_app.state.system_monitor.run())
    gesture_task = asyncio.create_task(gesture_events_task(_app))
    watchdog_task = asyncio.create_task(watchdog_loop())

    if settings.gesture_enabled:
        await _app.state.gesture_tracker.start()
    try:
        yield
    finally:
        log.info("app.shutting_down")
        task.cancel()
        metrics_task.cancel()
        gesture_task.cancel()
        watchdog_task.cancel()

        if getattr(_app.state, "gesture_tracker", None) is not None:
            await _app.state.gesture_tracker.stop()

        with suppress(asyncio.CancelledError):
            await task
        with suppress(asyncio.CancelledError):
            await metrics_task
        with suppress(asyncio.CancelledError):
            await gesture_task
        with suppress(asyncio.CancelledError):
            await watchdog_task


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.include_router(api_router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await hub.connect(websocket)
    log.info("ws.connected", connection_count=hub.connection_count)
    await hub.broadcast(BroadcastMessage(event="status", payload={"message": "client_connected"}))
    try:
        while True:
            raw = await websocket.receive()

            if raw.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect

            # Binary frame: audio data from client microphone
            if raw.get("bytes"):
                audio_bytes = raw["bytes"]
                if len(audio_bytes) > 64 * 1024:
                    log.warning("ws.audio_frame.too_large", size=len(audio_bytes))
                    continue
                if hasattr(app.state, "duplex_pipelines"):
                    pipeline = app.state.duplex_pipelines.get(id(websocket))
                    if not pipeline:
                        pipeline = DuplexVoicePipeline(
                            brain=app.state.brain,
                            hub=hub,
                            websocket=websocket,
                            tts_voice=settings.tts_voice,
                        )
                        app.state.duplex_pipelines[id(websocket)] = pipeline
                    await pipeline.handle_audio_data(audio_bytes)
                continue

            # Text frame: JSON event
            text = raw.get("text", "")
            if not text:
                continue

            data = json.loads(text)
            event = data.get("event")
            payload = data.get("payload", {})
            log.info("ws.event", ws_event=event)

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

            elif event in ("confirm_tool", "tool_confirm"):
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
            elif event == "voice:speech_end":
                if hasattr(app.state, 'duplex_pipelines'):
                    pipeline = app.state.duplex_pipelines.get(id(websocket))
                    if pipeline:
                        await pipeline.handle_speech_end()
            elif event == "voice:interrupt":
                if hasattr(app.state, 'duplex_pipelines'):
                    pipeline = app.state.duplex_pipelines.get(id(websocket))
                    if pipeline:
                        await pipeline.handle_interrupt()
            elif event == "vision:inspect":
                max_depth = int(payload.get("max_depth", 3))
                max_nodes = int(payload.get("max_nodes", 64))
                snapshot = app.state.vision.inspect_active_window(max_depth=max_depth, max_nodes=max_nodes)
                await hub.broadcast(
                    BroadcastMessage(
                        event="vision:inspection",
                        payload={
                            "status": snapshot.status,
                            "window": snapshot.window,
                            "capture": snapshot.capture,
                        },
                    )
                )
            elif event == "vision:capture":
                region = payload.get("region")
                normalized_region = tuple(region) if isinstance(region, list) and len(region) == 4 else None
                capture = app.state.vision.capture_screen(region=normalized_region)
                await hub.broadcast(BroadcastMessage(event="vision:capture", payload=capture))
            elif event == "gesture:enable":
                await app.state.gesture_tracker.start()
                await hub.broadcast(
                    BroadcastMessage(
                        event="gesture:status",
                        payload={"enabled": bool(app.state.gesture_tracker.is_running)},
                    )
                )
            elif event == "gesture:disable":
                await app.state.gesture_tracker.stop()
                await hub.broadcast(
                    BroadcastMessage(
                        event="gesture:status",
                        payload={"enabled": bool(app.state.gesture_tracker.is_running)},
                    )
                )
            elif event == "gesture:status":
                await hub.broadcast(
                    BroadcastMessage(
                        event="gesture:status",
                        payload={"enabled": bool(app.state.gesture_tracker.is_running)},
                    )
                )
            else:
                await hub.broadcast(BroadcastMessage(event="echo", payload={"received": data}))
    except WebSocketDisconnect:
        await hub.disconnect(websocket)
        if hasattr(app.state, "duplex_pipelines"):
            app.state.duplex_pipelines.pop(id(websocket), None)
        log.info("ws.disconnected", connection_count=hub.connection_count)
        await hub.broadcast(BroadcastMessage(event="status", payload={"message": "client_disconnected"}))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if getattr(sys, "frozen", False):
        uvicorn.run(app, host=settings.host, port=settings.port, reload=False)
    else:
        uvicorn.run("backend.main:app", host=settings.host, port=settings.port, reload=False)
