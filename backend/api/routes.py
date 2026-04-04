import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from backend.api.schemas import ChatRequest, ChatResponse
from backend.config import settings
from backend.core.tools import evaluate_tool_request
from backend.utils.timing import get_all_latency_stats

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/health")
async def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "privacy_mode": settings.privacy_mode,
    }


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    brain = request.app.state.brain
    reply = await brain.chat(
        message=payload.message,
        history=[item.model_dump() for item in payload.history],
        prefer_cloud=payload.prefer_cloud,
    )
    return ChatResponse(
        reply=reply.text,
        provider_used=reply.provider_used,
        latency_ms=reply.latency_ms,
        fallback_used=reply.fallback_used,
    )


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request) -> StreamingResponse:
    brain = request.app.state.brain
    hub = request.app.state.hub

    async def event_generator():
        async for chunk in brain.chat_stream(
            message=payload.message,
            hub=hub,
            prefer_cloud=payload.prefer_cloud,
        ):
            data = {"event": "brain:chunk", "payload": {"text": chunk, "done": False}}
            yield f"data: {json.dumps(data)}\n\n"

        yield f"data: {json.dumps({'event': 'brain:done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/tool-policy-check/{tool_name}")
async def tool_policy_check(tool_name: str) -> dict[str, str | bool]:
    decision = evaluate_tool_request(tool_name)
    return {
        "tool": decision.name,
        "allowed": decision.allowed,
        "requires_confirmation": decision.requires_confirmation,
        "reason": decision.reason,
    }


# Memory Management Endpoints

@router.get("/memory/stats")
async def memory_stats(request: Request) -> dict:
    """Get conversation memory statistics"""
    brain = request.app.state.brain
    return await brain.get_memory_stats()


@router.get("/memory/history")
async def memory_history(request: Request) -> dict:
    """Get full conversation history"""
    brain = request.app.state.brain
    messages = await brain.memory.get_messages()
    return {
        "session_id": brain.memory.session_id,
        "message_count": len(messages),
        "messages": messages,
    }


@router.post("/memory/clear")
async def memory_clear(request: Request) -> dict[str, str]:
    """Clear conversation history"""
    brain = request.app.state.brain
    await brain.clear_memory()
    return {"status": "cleared", "session_id": brain.memory.session_id}


# Router / Routing Intelligence Endpoints

@router.get("/router/stats")
async def router_stats(request: Request) -> dict:
    """Get current router configuration and intelligence stats"""
    brain = request.app.state.brain
    return brain.get_router_stats()


@router.post("/router/analyze")
async def router_analyze(request: Request) -> dict:
    """
    Analyze routing decision for a given message.
    
    Request body:
    {
        "message": "your message here",
        "prefer_cloud": false
    }
    """
    from pydantic import BaseModel
    
    class AnalyzeRequest(BaseModel):
        message: str
        prefer_cloud: bool = False
    
    payload = await request.json()
    analyze_req = AnalyzeRequest(**payload)

    brain = request.app.state.brain
    decision = await brain.router.route(message=analyze_req.message, prefer_cloud=analyze_req.prefer_cloud)

    return {
        "tier": decision.tier.value,
        "intent": decision.intent,
        "confidence": round(decision.confidence, 3),
        "reason": decision.reason,
    }


# Voice MVP Endpoints

@router.get("/voice/status")
async def voice_status(request: Request) -> dict:
    voice = request.app.state.voice
    return await voice.get_status()


@router.post("/voice/start")
async def voice_start(request: Request) -> dict:
    voice = request.app.state.voice
    await voice.start()
    return {"status": "started", "voice_enabled": True}


@router.post("/voice/stop")
async def voice_stop(request: Request) -> dict:
    voice = request.app.state.voice
    await voice.stop()
    return {"status": "stopped", "voice_enabled": False}


@router.post("/voice/simulate")
async def voice_simulate(request: Request) -> dict:
    payload = await request.json()
    transcript = str(payload.get("transcript", "")).strip()
    prefer_cloud = bool(payload.get("prefer_cloud", False))
    voice = request.app.state.voice
    return await voice.process_transcript(transcript, prefer_cloud=prefer_cloud)


# Vision / Screen Grounding Endpoints

@router.get("/vision/status")
async def vision_status(request: Request) -> dict:
    vision = request.app.state.vision
    return vision.get_status()


@router.post("/vision/inspect")
async def vision_inspect(request: Request) -> dict:
    payload = await request.json()
    max_depth = int(payload.get("max_depth", 3))
    max_nodes = int(payload.get("max_nodes", 64))
    vision = request.app.state.vision
    snapshot = vision.inspect_active_window(max_depth=max_depth, max_nodes=max_nodes)
    return {
        "status": snapshot.status,
        "window": snapshot.window,
        "capture": snapshot.capture,
    }


@router.post("/vision/capture")
async def vision_capture(request: Request) -> dict:
    payload = await request.json()
    region = payload.get("region")
    normalized_region = tuple(region) if isinstance(region, list) and len(region) == 4 else None
    vision = request.app.state.vision
    return vision.capture_screen(region=normalized_region)


@router.get("/debug/latency")
async def debug_latency() -> dict:
    return get_all_latency_stats()


@router.get("/gesture/status")
async def gesture_status(request: Request) -> dict:
    tracker = request.app.state.gesture_tracker
    return {
        "enabled": bool(tracker.is_running),
        "camera_index": tracker.camera_index,
    }
