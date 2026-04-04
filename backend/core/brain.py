from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any

import httpx

from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.config import Settings
from backend.core.memory import RAGMemory
from backend.core.router import RoutingTier, SemanticRouter
from backend.core.schemas import JarvisResponse
from backend.core.tool_executor import ToolExecutor
from backend.core.tools import get_ollama_tool_schemas
from backend.vision.manager import VisionManager


@dataclass
class BrainReply:
    text: str
    provider_used: str
    latency_ms: int
    fallback_used: bool = False


class AIBrain:
    TOOL_ELIGIBLE_INTENTS = {"system_operation", "quick_command"}

    def __init__(
        self,
        settings: Settings,
        session_id: str | None = None,
        router: SemanticRouter | None = None,
        memory: RAGMemory | None = None,
        tool_executor: ToolExecutor | None = None,
        vision: VisionManager | None = None,
    ) -> None:
        self.settings = settings
        self.router = router or SemanticRouter(privacy_mode=settings.privacy_mode)
        self.memory = memory or RAGMemory(embedding_model=self.router.model, session_id=session_id)
        self.tool_executor = tool_executor or ToolExecutor()
        self.vision = vision
        self._system_prompt = {
            "role": "system",
            "content": (
                "You are JARVIS, a concise and safety-aware desktop assistant. "
                "For normal replies, use action='direct_response'. "
                "For actions needing tools, use action='tool_call' with tool_name and arguments."
            ),
        }

    async def chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        prefer_cloud: bool = False,
    ) -> BrainReply:
        """Non-streaming chat endpoint used by REST API."""
        start = time.perf_counter()
        route = await self.router.route(message=message, prefer_cloud=prefer_cloud)
        messages = await self.memory.build_context(message, self._system_prompt)
        messages = await self._attach_vision_context(messages, message)
        await self.memory.add_message("user", message)

        reply_text = ""
        provider_used = "local"
        fallback_used = False

        if route.intent in self.TOOL_ELIGIBLE_INTENTS:
            try:
                reply_text = await self._chat_local_structured(messages)
            except Exception as exc:
                reply_text = f"Tool pipeline failed. Falling back to direct reply. Details: {exc}"
                fallback_used = True
        else:
            if route.tier == RoutingTier.CLOUD and self.settings.openai_api_key:
                try:
                    reply_text = await self._chat_cloud(messages)
                    provider_used = "cloud"
                except Exception:
                    reply_text = await self._chat_local_text(messages)
                    provider_used = "local"
                    fallback_used = True
            else:
                try:
                    reply_text = await self._chat_local_text(messages)
                    provider_used = "local"
                except Exception as exc:
                    reply_text = (
                        "Local model path failed. "
                        "Please confirm Ollama is running and the configured model is pulled. "
                        f"Details: {exc}"
                    )
                    fallback_used = True

        await self.memory.add_message("assistant", reply_text)

        return BrainReply(
            text=reply_text,
            provider_used=provider_used,
            latency_ms=self._latency_ms(start),
            fallback_used=fallback_used,
        )

    async def chat_stream(
        self,
        message: str,
        hub: WebSocketHub,
        prefer_cloud: bool = False,
    ):
        """Streaming chat with realtime websocket events and chunk yields."""
        start = time.perf_counter()
        await hub.broadcast(BroadcastMessage(event="brain:routing", payload={"message": message}))

        route = await self.router.route(message=message, prefer_cloud=prefer_cloud)
        await hub.broadcast(
            BroadcastMessage(
                event="brain:routed",
                payload={"tier": route.tier.value, "intent": route.intent, "confidence": round(route.confidence, 3)},
            )
        )

        messages = await self.memory.build_context(message, self._system_prompt)
        messages = await self._attach_vision_context(messages, message)
        await self.memory.add_message("user", message)
        await hub.broadcast(BroadcastMessage(event="brain:thinking", payload={}))

        full_response = ""
        provider = "local"

        if route.intent in self.TOOL_ELIGIBLE_INTENTS:
            response = await self._chat_local_structured(messages, hub=hub)
            full_response = response
            await hub.broadcast(BroadcastMessage(event="brain:chunk", payload={"text": response, "done": False}))
            yield response
        elif route.tier == RoutingTier.CLOUD and self.settings.openai_api_key:
            provider = "cloud"
            response = await self._chat_cloud(messages)
            full_response = response
            await hub.broadcast(BroadcastMessage(event="brain:chunk", payload={"text": response, "done": False}))
            yield response
        else:
            async for chunk in self._stream_local(messages):
                if chunk["type"] == "text":
                    text = chunk["data"]
                    if text:
                        full_response += text
                        await hub.broadcast(BroadcastMessage(event="brain:chunk", payload={"text": text, "done": False}))
                        yield text
                elif chunk["type"] == "tool_call":
                    await hub.broadcast(BroadcastMessage(event="brain:tool_call", payload={"tools": chunk["data"]}))

        latency_ms = self._latency_ms(start)
        await self.memory.add_message("assistant", full_response)
        await hub.broadcast(
            BroadcastMessage(
                event="brain:done",
                payload={"full_text": full_response, "latency_ms": latency_ms, "provider": provider},
            )
        )

    async def _chat_local_text(self, messages: list[dict[str, Any]]) -> str:
        payload: dict[str, Any] = {
            "model": self.settings.local_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.3,
            },
        }

        url = f"{self.settings.local_ai_url.rstrip('/')}/api/chat"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

        return (
            data.get("message", {}).get("content")
            or "I am online, but I returned an empty response from local model."
        )

    async def _chat_local_structured(self, messages: list[dict[str, Any]], hub: WebSocketHub | None = None) -> str:
        payload: dict[str, Any] = {
            "model": self.settings.local_model,
            "messages": messages,
            "stream": False,
            "format": JarvisResponse.model_json_schema(),
            "tools": get_ollama_tool_schemas(),
            "options": {
                "temperature": 0,
            },
        }

        url = f"{self.settings.local_ai_url.rstrip('/')}/api/chat"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

        raw_content = data.get("message", {}).get("content", "")
        parsed = JarvisResponse.model_validate_json(raw_content)

        if parsed.action == "direct_response":
            return parsed.response or ""

        tool_name = parsed.tool_name or ""
        arguments = parsed.arguments or {}
        if hub is not None:
            await hub.broadcast(
                BroadcastMessage(
                    event="brain:tool_call",
                    payload={"tool_name": tool_name, "arguments": arguments, "reasoning": parsed.reasoning},
                )
            )

        result = await self.tool_executor.execute(tool_name, arguments, hub=hub)

        if hub is not None:
            await hub.broadcast(
                BroadcastMessage(
                    event="brain:tool_result",
                    payload={"tool_name": tool_name, "result": result.output, "status": result.status},
                )
            )

        if result.status in {"denied", "error", "requires_confirmation"}:
            return f"Tool '{tool_name}' could not run: {result.output}"

        followup_messages = list(messages)
        followup_messages.append(
            {
                "role": "tool",
                "tool_name": tool_name,
                "content": result.render_for_model(),
            }
        )
        followup_messages.append(
            {
                "role": "user",
                "content": "Use the tool result and reply to the user in 1-3 sentences.",
            }
        )
        return await self._chat_local_text(followup_messages)

    async def _chat_cloud(self, messages: list[dict[str, str]]) -> str:
        if not self.settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not configured for cloud mode")

        url = f"{self.settings.cloud_api_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": self.settings.cloud_model,
            "messages": messages,
            "temperature": 0.3,
        }
        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices", [])
        if not choices:
            return "Cloud provider returned no choices."
        return choices[0].get("message", {}).get("content", "")

    async def _stream_local(self, messages: list[dict[str, Any]]):
        payload: dict[str, Any] = {
            "model": self.settings.local_model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.3,
            },
        }

        url = f"{self.settings.local_ai_url.rstrip('/')}/api/chat"
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    message = chunk.get("message", {})
                    text = message.get("content")
                    if text:
                        yield {"type": "text", "data": text}

                    tool_calls = message.get("tool_calls")
                    if tool_calls:
                        yield {"type": "tool_call", "data": tool_calls}

                    if chunk.get("done"):
                        break

    async def _attach_vision_context(self, messages: list[dict[str, Any]], message: str) -> list[dict[str, Any]]:
        if not self.vision or not self._should_attach_vision_context(message):
            return messages

        snapshot = self.vision.inspect_active_window(max_depth=2, max_nodes=24)
        if not snapshot.window:
            return messages

        enriched = list(messages)
        enriched.append(
            {
                "role": "system",
                "content": (
                    "Use this structured screen context if it is relevant to the user's question:\n"
                    f"{json.dumps(snapshot.window, indent=2, ensure_ascii=False)}"
                ),
            }
        )
        return enriched

    @staticmethod
    def _should_attach_vision_context(message: str) -> bool:
        lowered = message.lower()
        keywords = ("screen", "window", "app", "application", "what's on my screen", "what am i looking at", "ui")
        return any(keyword in lowered for keyword in keywords)

    @staticmethod
    def _latency_ms(start: float) -> int:
        return int((time.perf_counter() - start) * 1000)
    
    async def get_memory_stats(self) -> dict[str, Any]:
        """Get current conversation memory statistics"""
        return await self.memory.get_stats()
    
    async def clear_memory(self) -> None:
        """Clear conversation history"""
        await self.memory.clear_session()
    
    def get_router_stats(self) -> dict[str, Any]:
        """Get current router configuration and thresholds"""
        return self.router.get_router_stats()
