from __future__ import annotations

from dataclasses import dataclass
import ast
import json
import re
import time
from typing import Any

import httpx
from fastapi import WebSocket

from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.config import Settings
from backend.core.memory import RAGMemory
from backend.core.router import RoutingTier, SemanticRouter
from backend.core.schemas import JarvisResponse
from backend.core.tool_executor import ToolExecutor
from backend.core.tools import get_ollama_tool_schemas
from backend.logging import get_logger
from backend.utils.timing import alatency
from backend.vision.manager import VisionManager

log = get_logger(__name__)


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
            "content": self._build_system_prompt(),
        }

    @staticmethod
    def _build_system_prompt() -> str:
        from datetime import datetime
        now = datetime.now()
        time_str = now.strftime("%I:%M %p")
        date_str = now.strftime("%A, %B %d, %Y")
        greeting = (
            "Good morning" if now.hour < 12
            else "Good afternoon" if now.hour < 17
            else "Good evening"
        )

        return (
            "You are JARVIS (Just A Rather Very Intelligent System), "
            "a hyper-capable AI desktop assistant built by your creator. "
            "You speak with the elegant precision of a British butler — "
            "witty, articulate, concise, and quietly confident. "
            "You never use filler words or unnecessary apologies. "
            "When you don't know something, you say so clearly.\n\n"
            f"Current time: {time_str} on {date_str}. "
            f"Appropriate greeting: \"{greeting}.\"\n\n"
            "RESPONSE FORMAT for structured mode:\n"
            "- For normal replies: action='direct_response' with response=<your reply>\n"
            "- For tool actions: action='tool_call' with tool_name=<name> and arguments=<args>\n\n"
            "PERSONALITY GUIDELINES:\n"
            "- Be concise — 1-3 sentences for simple queries\n"
            "- Be technically precise but explain simply when asked\n"
            "- Use dry British wit sparingly — never forced humor\n"
            "- If the user addressed you by name, acknowledge it naturally\n"
            "- For greetings, be warm and contextual (reference the time of day)\n"
            "- Never say 'As an AI' or 'I'm just a language model'\n"
            "- You are JARVIS. Own it."
        )

    async def chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        prefer_cloud: bool = False,
    ) -> BrainReply:
        """Non-streaming chat endpoint used by REST API."""
        start = time.perf_counter()
        route = await self.router.route(message=message, prefer_cloud=prefer_cloud)
        log.info("brain.chat.route", tier=route.tier.value, intent=route.intent, confidence=round(route.confidence, 3))
        messages = await self.memory.build_context(message, self._system_prompt)
        messages = await self._attach_vision_context(messages, message)
        await self.memory.add_message("user", message)

        reply_text = ""
        provider_used = "local"
        fallback_used = False
        force_tool_mode = self._looks_like_tool_request(message)

        if force_tool_mode or route.intent in self.TOOL_ELIGIBLE_INTENTS:
            try:
                rule_reply = await self._rule_based_tool_reply(message, hub=None, websocket=None)
                if rule_reply is not None:
                    reply_text = rule_reply
                else:
                    reply_text = await self._chat_local_structured(messages)
                log.info("brain.chat.structured_reply")
            except Exception as exc:
                reply_text = await self._chat_local_text(messages)
                fallback_used = True
                log.warning("brain.chat.structured_failed", error=str(exc))
        else:
            if route.tier == RoutingTier.CLOUD and self.settings.openai_api_key:
                try:
                    reply_text = await self._chat_cloud(messages)
                    provider_used = "cloud"
                    log.info("brain.chat.provider", provider=provider_used)
                except Exception:
                    reply_text = await self._chat_local_text(messages)
                    provider_used = "local"
                    fallback_used = True
                    log.warning("brain.chat.cloud_fallback_local")
            else:
                try:
                    reply_text = await self._chat_local_text(messages)
                    provider_used = "local"
                    log.info("brain.chat.provider", provider=provider_used)
                except Exception as exc:
                    reply_text = (
                        "Local model path failed. "
                        "Please confirm Ollama is running and the configured model is pulled. "
                        f"Details: {exc}"
                    )
                    fallback_used = True
                    log.error("brain.chat.local_failed", error=str(exc))

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
        hub: WebSocketHub | None,
        websocket: WebSocket | None = None,
        prefer_cloud: bool = False,
    ):
        """Streaming chat with realtime websocket events and chunk yields."""
        start = time.perf_counter()

        async with alatency("brain.chat_stream"):
            async def emit(event: str, payload: dict[str, Any]) -> None:
                if hub is None:
                    return
                msg = BroadcastMessage(event=event, payload=payload)
                if websocket is not None:
                    await hub.send_to(websocket, msg)
                else:
                    await hub.broadcast(msg)

            await emit("brain:routing", {"message": message})
            log.info("brain.stream.start", voice_session=websocket is not None)

            route = await self.router.route(message=message, prefer_cloud=prefer_cloud)
            await emit(
                "brain:routed",
                {"tier": route.tier.value, "intent": route.intent, "confidence": round(route.confidence, 3)},
            )

            messages = await self.memory.build_context(message, self._system_prompt)
            messages = await self._attach_vision_context(messages, message)
            await self.memory.add_message("user", message)
            await emit("brain:thinking", {})

            full_response = ""
            provider = "local"
            force_tool_mode = self._looks_like_tool_request(message)

            if force_tool_mode or route.intent in self.TOOL_ELIGIBLE_INTENTS:
                rule_reply = await self._rule_based_tool_reply(message, hub=hub, websocket=websocket)
                if rule_reply is not None:
                    response = rule_reply
                else:
                    response = await self._chat_local_structured(messages, hub=hub, websocket=websocket)
                full_response = response
                await emit("brain:chunk", {"text": response, "done": False})
                yield response
            elif route.tier == RoutingTier.CLOUD and self.settings.openai_api_key:
                provider = "cloud"
                response = await self._chat_cloud(messages)
                full_response = response
                await emit("brain:chunk", {"text": response, "done": False})
                yield response
            else:
                async for chunk in self._stream_local(messages):
                    if chunk["type"] == "text":
                        text = chunk["data"]
                        if text:
                            full_response += text
                            await emit("brain:chunk", {"text": text, "done": False})
                            yield text
                    elif chunk["type"] == "tool_call":
                        await emit("brain:tool_call", {"tools": chunk["data"]})

            latency_ms = self._latency_ms(start)
            await self.memory.add_message("assistant", full_response)
            await emit("brain:done", {"full_text": full_response, "latency_ms": latency_ms, "provider": provider})
            log.info("brain.stream.done", provider=provider, latency_ms=latency_ms)

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

        async with alatency("brain.chat_local_text"):
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()

        content = (
            data.get("message", {}).get("content")
            or "I am online, but I returned an empty response from local model."
        )
        return self._normalize_plain_response(content)

    async def _chat_local_structured(
        self,
        messages: list[dict[str, Any]],
        hub: WebSocketHub | None = None,
        websocket: WebSocket | None = None,
    ) -> str:
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

        async with alatency("brain.chat_local_structured"):
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()

        raw_content = data.get("message", {}).get("content", "")
        parsed = self._parse_structured_response(raw_content)

        if parsed.action == "direct_response":
            return parsed.response or ""

        tool_name = parsed.tool_name or ""
        arguments = parsed.arguments or {}
        if hub is not None:
            message = BroadcastMessage(
                event="brain:tool_call",
                payload={"tool_name": tool_name, "arguments": arguments, "reasoning": parsed.reasoning},
            )
            if websocket is not None:
                await hub.send_to(websocket, message)
            else:
                await hub.broadcast(message)

        result = await self.tool_executor.execute(tool_name, arguments, hub=hub)

        if hub is not None:
            message = BroadcastMessage(
                event="brain:tool_result",
                payload={"tool_name": tool_name, "result": result.output, "status": result.status},
            )
            if websocket is not None:
                await hub.send_to(websocket, message)
            else:
                await hub.broadcast(message)

        if result.status in {"denied", "error", "requires_confirmation"}:
            # Graceful fallback to natural response instead of noisy internal error text.
            fallback = await self._chat_local_text(messages)
            return fallback

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

    def _parse_structured_response(self, raw_content: str) -> JarvisResponse:
        """Parse structured model responses with tolerant fallbacks for quasi-JSON outputs."""
        try:
            return JarvisResponse.model_validate_json(raw_content)
        except Exception:
            pass

        cleaned = raw_content.strip()

        # Handle leaked plain format:
        # action='direct_response' response="..."
        direct_match = re.search(
            r"action\s*=\s*['\"]?direct_response['\"]?\s+response\s*=\s*(?P<resp>[\s\S]+)$",
            cleaned,
            flags=re.IGNORECASE,
        )
        if direct_match:
            resp = direct_match.group("resp").strip()
            if len(resp) >= 2 and resp[0] in {'"', "'"} and resp[-1] == resp[0]:
                resp = resp[1:-1]
            return JarvisResponse(action="direct_response", response=resp)

        # Handle leaked tool format:
        # action='tool_call' response="tool_name=... arguments={...}"
        if re.search(r"action\s*=\s*['\"]?tool_call['\"]?", cleaned, flags=re.IGNORECASE):
            tool_name = ""
            args_dict: dict[str, Any] = {}

            tn = re.search(r"tool_name\s*=\s*['\"]?(?P<name>[A-Za-z0-9_:-]+)['\"]?", cleaned)
            if tn:
                tool_name = tn.group("name")

            am = re.search(r"arguments\s*=\s*(?P<args>\{[\s\S]*\})", cleaned)
            if am:
                args_raw = am.group("args")
                try:
                    args_dict = json.loads(args_raw.replace("'", '"'))
                except Exception:
                    try:
                        parsed_args = ast.literal_eval(args_raw)
                        if isinstance(parsed_args, dict):
                            args_dict = parsed_args
                    except Exception:
                        args_dict = {}

            if tool_name:
                return JarvisResponse(action="tool_call", tool_name=tool_name, arguments=args_dict)

        # Final fallback to direct response
        return JarvisResponse(action="direct_response", response=self._normalize_plain_response(cleaned))

    @staticmethod
    def _looks_like_tool_request(message: str) -> bool:
        text = message.lower()
        triggers = (
            "open ", "launch ", "set ", "turn ", "increase ", "decrease ", "dim ",
            "brightness", "volume", "remind", "create file", "delete file", "run ",
            "what's my cpu", "what is my cpu", "weather in", "time in", "get weather",
        )
        return any(t in text for t in triggers)

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

        async with alatency("brain.chat_cloud"):
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()

        choices = data.get("choices", [])
        if not choices:
            return "Cloud provider returned no choices."
        content = choices[0].get("message", {}).get("content", "")
        return self._normalize_plain_response(content)

    @staticmethod
    def _normalize_plain_response(text: str) -> str:
        """Strip accidental structured wrappers from plain chat responses."""
        if not text:
            return text

        cleaned = text.strip()

        # Common model leak examples:
        # action='direct_response' response="..."
        # action="direct_response" response='...'
        # action=direct_response response=...
        pattern = re.compile(
            r"action\s*=\s*['\"]?[a-z_]+['\"]?\s+response\s*=\s*(?P<resp>.+)$",
            flags=re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(cleaned)
        if match:
            response_part = match.group("resp").strip()
            if len(response_part) >= 2 and response_part[0] in {'"', "'"} and response_part[-1] == response_part[0]:
                response_part = response_part[1:-1]
            return response_part.strip()

        return cleaned

    async def _rule_based_tool_reply(
        self,
        user_message: str,
        hub: WebSocketHub | None = None,
        websocket: WebSocket | None = None,
    ) -> str | None:
        """Execute common tool intents deterministically without relying on model JSON formatting."""
        user_message = str(user_message or "").strip()
        if not user_message:
            return None

        lower = user_message.lower()
        tool_name: str | None = None
        args: dict[str, Any] = {}

        # Weather: "weather in <city>"
        weather_match = re.search(r"weather\s+in\s+([a-zA-Z\s\-]+)$", lower)
        if weather_match:
            tool_name = "get_weather"
            args = {"city": weather_match.group(1).strip().title()}
        elif "weather" in lower and " in " not in lower:
            tool_name = "get_weather"
            args = {"city": "Bengaluru"}
        elif "what time" in lower or "date" in lower or "day" in lower:
            tool_name = "get_datetime"
            args = {}
        elif "cpu" in lower or "ram" in lower or "memory" in lower or "system info" in lower:
            tool_name = "system_info"
            args = {}
        elif "search" in lower and "web" in lower:
            tool_name = "search_web"
            q = re.sub(r".*search\s+web\s+(for\s+)?", "", user_message, flags=re.IGNORECASE).strip()
            args = {"query": q or user_message}
        elif "open " in lower or "launch " in lower:
            tool_name = "open_application"
            app_match = re.search(r"(?:open|launch)\s+(.+)$", user_message, flags=re.IGNORECASE)
            args = {"name": (app_match.group(1).strip() if app_match else "notepad")}
        elif "brightness" in lower or "dim" in lower:
            tool_name = "control_brightness"
            num = re.search(r"(\d{1,3})", lower)
            args = {"level": max(0, min(100, int(num.group(1)))) if num else (0 if "dim" in lower else 50)}
        elif "volume" in lower:
            tool_name = "control_volume"
            num = re.search(r"(\d{1,3})", lower)
            args = {"level": max(0, min(100, int(num.group(1)))) if num else 50}

        if not tool_name:
            return None

        if hub is not None:
            msg = BroadcastMessage(
                event="brain:tool_call",
                payload={"tool_name": tool_name, "arguments": args, "reasoning": "rule_based"},
            )
            if websocket is not None:
                await hub.send_to(websocket, msg)
            else:
                await hub.broadcast(msg)

        result = await self.tool_executor.execute(tool_name, args, hub=hub)

        if hub is not None:
            msg = BroadcastMessage(
                event="brain:tool_result",
                payload={"tool_name": tool_name, "result": result.output, "status": result.status},
            )
            if websocket is not None:
                await hub.send_to(websocket, msg)
            else:
                await hub.broadcast(msg)

        if result.status == "ok":
            if tool_name == "get_weather":
                c = result.output.get("city", "")
                t = result.output.get("temperature_c")
                fl = result.output.get("feels_like_c")
                cond = result.output.get("condition", "")
                return f"Current weather in {c}: {t}°C, feels like {fl}°C, {cond}."
            if tool_name == "get_datetime":
                return f"It is {result.output.get('formatted', '')}."
            if tool_name == "system_info":
                return (
                    f"CPU {result.output.get('cpu_percent', 'N/A')}%, "
                    f"Memory {result.output.get('memory_percent', 'N/A')}%."
                )
            return f"Done. {tool_name} executed successfully."

        if result.status == "requires_confirmation":
            return "This action needs your confirmation in the HUD popup before I can execute it."

        return f"I couldn't execute {tool_name} right now: {result.output}."

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
