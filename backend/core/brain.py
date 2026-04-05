from __future__ import annotations

from dataclasses import dataclass
import ast
import json
import re
import time
from urllib.parse import quote_plus
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
            "- Whenever you execute a system tool, reply with a brief, natural conversational confirmation in the voice of a polite British butler\n"
            "- Never reply with single-word confirmations like 'Done.'\n"
            "- You may only call tools that are explicitly registered in the tool schema; never invent tool names\n"
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
            "brightness", "volume", "mute", "unmute", "remind", "create file", "delete file", "create directory", "mkdir ",
            "list files", "read file", "copy file", "move file", "append to file", "run ", "execute command", "powershell",
            "what's my cpu", "what is my cpu", "cpu usage", "memory usage", "disk usage",
            "what do u see", "what do you see", "on my screen", "in my screen", "show me image", "show images",
            "weather in", "time in", "get weather",
            "search web", "search for", "write code", "generate code", "create tool", "make a tool", "close app", "kill app", "close ",
            "open website", "visit website", "open url", "fetch webpage", "summarize this page",
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

        # Handle single-line wrappers such as:
        # action='joke' tool_name='x' arguments='{"text":"..."}'
        single_action = re.search(r"^action\s*=\s*['\"]?(?P<action>[a-z_]+)['\"]?\s*(?P<rest>[\s\S]*)$", cleaned, flags=re.IGNORECASE)
        if single_action:
            action = (single_action.group("action") or "").lower()
            rest = (single_action.group("rest") or "").strip()

            # Try extracting useful payload from inline arguments.
            arg_match = re.search(r"arguments\s*=\s*(?P<args>'\{[\s\S]*\}'|\{[\s\S]*\})", rest)
            if arg_match:
                raw_args = arg_match.group("args").strip()
                if raw_args.startswith("'") and raw_args.endswith("'"):
                    raw_args = raw_args[1:-1]
                args_dict: dict[str, Any] = {}
                try:
                    args_dict = json.loads(raw_args)
                except Exception:
                    try:
                        parsed = ast.literal_eval(raw_args)
                        if isinstance(parsed, dict):
                            args_dict = parsed
                    except Exception:
                        args_dict = {}

                for key in ("text", "tip", "note", "comparison", "message", "status", "answer"):
                    value = args_dict.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()

            # If remaining text exists after stripping known kv pairs, return it.
            rest = re.sub(r"tool_name\s*=\s*['\"]?[^'\"\s]+['\"]?", "", rest, flags=re.IGNORECASE)
            rest = re.sub(r"arguments\s*=\s*(?:'\{[\s\S]*\}'|\{[\s\S]*\})", "", rest, flags=re.IGNORECASE)
            rest = re.sub(r"\s+", " ", rest).strip(" -:\t\n")
            if rest:
                return rest

            if action in {"status", "state", "system_status"}:
                return "I am online and operational."
            if action in {"data_query", "show_current_date", "show_date", "show_time", "current_time"}:
                from datetime import datetime
                return f"It is {datetime.now().strftime('%I:%M %p, %A %B %d, %Y')}."
            return "I completed that step."

        # Handle multiline leaks such as:
        # action='direct_response'\nHello there.
        lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
        if lines and re.match(r"^action\s*=", lines[0], flags=re.IGNORECASE):
            action_match = re.search(r"action\s*=\s*['\"]?(?P<action>[a-z_]+)['\"]?", lines[0], flags=re.IGNORECASE)
            action = (action_match.group("action").lower() if action_match else "")

            if action == "direct_response":
                body = "\n".join(lines[1:]).strip()
                if body:
                    return body

            if action in {"show_current_date", "show_date", "show_time", "current_time"}:
                body = "\n".join(lines[1:]).strip()
                return body or "I can provide the current date and time whenever you ask."

            if action in {"status", "state"}:
                status_match = re.search(r"status\s*=\s*['\"]?(?P<status>[^'\"\n]+)", cleaned, flags=re.IGNORECASE)
                status = status_match.group("status").strip() if status_match else "online"
                return f"I am {status}."

            if action in {"create_file", "delete_file", "mkdir", "ls", "cat_file", "read_file"}:
                arg_path = re.search(r"path\s*[:=]\s*['\"]?(?P<path>[^'\"\}\n]+)", cleaned, flags=re.IGNORECASE)
                path = arg_path.group("path").strip() if arg_path else "the requested path"
                if action == "create_file":
                    return f"Created file at {path}."
                if action == "delete_file":
                    return f"Deleted {path}."
                if action == "mkdir":
                    return f"Created directory {path}."
                if action == "ls":
                    return f"Listed files in {path}."
                return f"Read file {path}."

            # Generic wrappers like:
            # action='joke'\n joke="..."
            for line in lines[1:]:
                kv = re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*(.+)$", line)
                if not kv:
                    continue
                value = kv.group(1).strip()
                if len(value) >= 2 and value[0] in {'"', "'"} and value[-1] == value[0]:
                    value = value[1:-1]
                if value:
                    return value

            body = " ".join(lines[1:]).strip()
            if body:
                return body

            if action == "tool_call":
                tool_match = re.search(r"tool_name\s*=\s*['\"]?(?P<tool>[A-Za-z0-9_:-]+)", cleaned)
                tool_name = (tool_match.group("tool").lower() if tool_match else "")
                if tool_name in {"system_info", "get_system_info", "screen_info", "get_screen_info"}:
                    return "I can check system status, weather, time, and help with desktop actions like launching apps or adjusting controls."
                return "I can help with tool actions—tell me exactly what you'd like me to do."

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

        if re.search(r"\bwhat\s+can\s+you\s+do\b", lower):
            return (
                "I can check system status, weather, and time; search the web; and perform desktop actions "
                "like launching apps or adjusting brightness and volume (with confirmation for sensitive actions)."
            )

        if any(p in lower for p in ("what do u see in my screen", "what do you see in my screen", "what do you see on my screen", "what's on my screen", "what is on my screen")):
            if not self.vision:
                return "I don't have screen inspection enabled in this session."
            snap = self.vision.inspect_active_window(max_depth=2, max_nodes=48)
            window = snap.window or {}
            if window.get("redacted"):
                return "I can see the active window, but privacy mode redacted sensitive details."
            title = window.get("window_title") or "an active window"
            cls = window.get("class_name") or "unknown class"
            return f"I can see {title} (class {cls}). If you want, I can inspect more UI details."

        if re.search(r"\b(what\s+is\s+your\s+status|status)\b", lower) and "weather" not in lower:
            return "I am online and ready."

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
        elif re.search(r"search\s+for\s+.+\s+in\s+chrome", lower):
            tool_name = "run_command"
            m = re.search(r"search\s+for\s+(.+)\s+in\s+chrome", user_message, flags=re.IGNORECASE)
            query = (m.group(1).strip() if m else user_message)
            query_url = f"https://www.google.com/search?q={quote_plus(query)}"
            args = {"command": f"start chrome \"{query_url}\""}
        elif "search for" in lower or ("search" in lower and "web" in lower):
            tool_name = "search_web"
            q = re.sub(r".*search\s+(?:web\s+)?(?:for\s+)?", "", user_message, flags=re.IGNORECASE).strip()
            args = {"query": q or user_message}
        elif any(x in lower for x in ("open website", "visit website", "open url", "go to ")):
            tool_name = "open_url"
            url = self._extract_url_from_text(user_message)
            if not url:
                url = re.sub(r".*(?:open\s+website|visit\s+website|open\s+url|go\s+to)\s+", "", user_message, flags=re.IGNORECASE).strip()
            args = {"url": url}
        elif any(x in lower for x in ("fetch webpage", "summarize this page", "read this page")):
            tool_name = "fetch_webpage"
            url = self._extract_url_from_text(user_message)
            if not url:
                url = re.sub(r".*(?:fetch\s+webpage|summarize\s+this\s+page|read\s+this\s+page)\s+", "", user_message, flags=re.IGNORECASE).strip()
            args = {"url": url}
        elif any(x in lower for x in ("show me images", "show me image", "display image", "show image")):
            url = self._extract_url_from_text(user_message)
            if not url:
                return "I can show images if you give me a direct image URL, and I can open it for you."
            tool_name = "display_image"
            args = {"url": url}
        elif re.search(r"\bremind\s+me\s+to\b", lower):
            tool_name = "set_reminder"
            minutes_match = re.search(r"\bin\s+(\d{1,4})\s*(minute|minutes|min)\b", lower)
            minutes = int(minutes_match.group(1)) if minutes_match else 10
            reminder_text = re.sub(r"^.*?remind\s+me\s+to\s+", "", user_message, flags=re.IGNORECASE)
            reminder_text = re.sub(r"\s+in\s+\d{1,4}\s*(?:minute|minutes|min)\b", "", reminder_text, flags=re.IGNORECASE).strip(" .")
            args = {"text": reminder_text or "Reminder", "minutes": max(1, min(1440, minutes))}
        elif "create file" in lower:
            tool_name = "manage_files"
            pm = re.search(r"create\s+file\s+(?P<path>\S+)(?:\s+with\s+(?P<content>[\s\S]+))?", user_message, flags=re.IGNORECASE)
            args = {
                "operation": "write",
                "path": (pm.group("path").strip() if pm else "src/new_file.txt"),
                "target": (pm.group("content").strip() if pm and pm.group("content") else ""),
            }
        elif "delete file" in lower:
            tool_name = "manage_files"
            pm = re.search(r"delete\s+file\s+(?P<path>\S+)", user_message, flags=re.IGNORECASE)
            args = {"operation": "delete", "path": (pm.group("path").strip() if pm else "")}
        elif "create directory" in lower or "mkdir " in lower:
            tool_name = "manage_files"
            pm = re.search(r"(?:create\s+directory|mkdir)\s+(?P<path>\S+)", user_message, flags=re.IGNORECASE)
            args = {"operation": "mkdir", "path": (pm.group("path").strip() if pm else "")}
        elif "list files" in lower:
            tool_name = "manage_files"
            pm = re.search(r"list\s+files\s+(?:in\s+)?(?P<path>\S+)", user_message, flags=re.IGNORECASE)
            args = {"operation": "list", "path": (pm.group("path").strip() if pm else ".")}
        elif "read file" in lower:
            tool_name = "manage_files"
            pm = re.search(r"read\s+file\s+(?P<path>\S+)", user_message, flags=re.IGNORECASE)
            args = {"operation": "read", "path": (pm.group("path").strip() if pm else "")}
        elif "copy file" in lower:
            tool_name = "manage_files"
            pm = re.search(r"copy\s+file\s+(?P<src>\S+)\s+(?:to|into)\s+(?P<dst>\S+)", user_message, flags=re.IGNORECASE)
            args = {
                "operation": "copy",
                "path": (pm.group("src").strip() if pm else ""),
                "destination": (pm.group("dst").strip() if pm else ""),
            }
        elif "move file" in lower:
            tool_name = "manage_files"
            pm = re.search(r"move\s+file\s+(?P<src>\S+)\s+(?:to|into)\s+(?P<dst>\S+)", user_message, flags=re.IGNORECASE)
            args = {
                "operation": "move",
                "path": (pm.group("src").strip() if pm else ""),
                "destination": (pm.group("dst").strip() if pm else ""),
            }
        elif "append to file" in lower:
            tool_name = "manage_files"
            pm = re.search(r"append\s+to\s+file\s+(?P<path>\S+)(?:\s+with\s+)?(?P<content>[\s\S]+)$", user_message, flags=re.IGNORECASE)
            args = {
                "operation": "append",
                "path": (pm.group("path").strip() if pm else ""),
                "target": (pm.group("content").strip() if pm and pm.group("content") else ""),
            }
        elif re.search(r"\b(run|execute)\s+command\b", lower) or lower.startswith("powershell "):
            tool_name = "run_command"
            cmd = re.sub(r"^\s*(?:run|execute)\s+command\s+", "", user_message, flags=re.IGNORECASE).strip()
            if lower.startswith("powershell "):
                cmd = user_message
            args = {"command": cmd}
        elif "close everything" in lower:
            return "I can close specific applications for you, but I won't mass-close everything blindly. Tell me exactly which apps to close."
        elif "close app" in lower or "kill app" in lower:
            tool_name = "run_command"
            pm = re.search(r"(?:close|kill)\s+app\s+(?P<name>[a-zA-Z0-9_.\-]+)", user_message, flags=re.IGNORECASE)
            app = (pm.group("name").strip() if pm else "")
            app = app if app.lower().endswith(".exe") else (f"{app}.exe" if app else "")
            args = {"command": f"taskkill /IM {app} /F" if app else ""}
        elif lower.startswith("close ") and len(lower.split()) >= 2:
            tool_name = "run_command"
            app = re.sub(r"^close\s+", "", lower).strip().split()[0]
            app = app if app.endswith(".exe") else f"{app}.exe"
            args = {"command": f"taskkill /IM {app} /F"}
        elif "open " in lower or "launch " in lower:
            tool_name = "open_application"
            app_match = re.search(r"(?:open|launch)\s+(.+)$", user_message, flags=re.IGNORECASE)
            args = {"name": (app_match.group(1).strip() if app_match else "notepad")}
        elif "disk" in lower:
            tool_name = "system_info"
            args = {}
        elif "write code" in lower or "generate code" in lower or "create tool" in lower or "make a tool" in lower:
            tool_name = "ai_write_code"
            path_match = re.search(r"(?:in|to|at)\s+(src[\\/][^\s]+)", user_message, flags=re.IGNORECASE)
            args = {
                "task": user_message,
                "path": (path_match.group(1) if path_match else "src/ai_generated/generated_tool.ts"),
            }
        elif "brightness" in lower or "dim" in lower:
            tool_name = "control_brightness"
            num = re.search(r"(\d{1,3})", lower)
            args = {"level": max(0, min(100, int(num.group(1)))) if num else (0 if "dim" in lower else 50)}
        elif "mute" in lower and "unmute" not in lower:
            tool_name = "control_volume"
            args = {"action": "mute"}
        elif "unmute" in lower:
            tool_name = "control_volume"
            args = {"action": "unmute"}
        elif "volume" in lower:
            tool_name = "control_volume"
            num = re.search(r"(\d{1,3})", lower)
            if "up" in lower or "increase" in lower or "raise" in lower:
                args = {"action": "up", "delta": max(1, min(50, int(num.group(1)))) if num else 10}
            elif "down" in lower or "decrease" in lower or "lower" in lower:
                args = {"action": "down", "delta": max(1, min(50, int(num.group(1)))) if num else 10}
            else:
                args = {"action": "set", "level": max(0, min(100, int(num.group(1)))) if num else 50}

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
            if tool_name == "fetch_webpage":
                title = result.output.get("title", "")
                content = str(result.output.get("content", ""))
                snippet = (content[:280] + "...") if len(content) > 280 else content
                return f"Fetched page {result.output.get('url', '')}. {('Title: ' + title + '. ') if title else ''}{snippet}"
            if tool_name == "search_web":
                return f"Search results for '{result.output.get('query', '')}': {result.output.get('answer', '')}"
            if tool_name == "open_url":
                return f"Opened {result.output.get('opened', '')} in your browser."
            if tool_name == "display_image":
                return f"Opened image: {result.output.get('opened', '')}."
            if tool_name == "voice_modification":
                return "Certainly. I have noted your voice preference. For a permanent backend voice change, set JARVIS_TTS_VOICE in .env and restart."
            if tool_name == "screen_capture":
                window = result.output.get("window", {})
                title = (window or {}).get("window_title") if isinstance(window, dict) else None
                return f"I inspected the active screen. Current window: {title or 'unknown'}"
            if tool_name == "ai_write_code":
                return f"Code created at {result.output.get('path', 'src/')}"
            if tool_name == "set_reminder":
                return f"Certainly. Reminder set for {result.output.get('minutes')} minutes: {result.output.get('text')}"
            if tool_name == "open_application":
                return f"Opened {result.output.get('launched', 'the requested application')}."
            if tool_name == "control_volume":
                action = result.output.get("action", "set")
                return f"Volume action completed: {action}."
            if tool_name == "control_brightness":
                return f"Brightness set to {result.output.get('level', 'requested level')}%."
            if tool_name == "run_command":
                rc = result.output.get("returncode")
                return f"Command executed with return code {rc}."
            if tool_name == "manage_files":
                op = str(result.output.get("action", "operation")).lower()
                path = result.output.get("path", "")
                dest = result.output.get("destination", "")
                if op == "write":
                    return f"Created file at {path}."
                if op == "append":
                    return f"Appended content to {path}."
                if op == "delete":
                    return f"Deleted {path}."
                if op == "mkdir":
                    return f"Created directory {path}."
                if op == "copy":
                    return f"Copied {path} to {dest}."
                if op == "move":
                    return f"Moved {path} to {dest}."
                if op == "list":
                    items = result.output.get("items", [])
                    preview = ", ".join(items[:8]) if isinstance(items, list) else ""
                    return f"Files in {path}: {preview}" if preview else f"Listed files in {path}."
                if op == "read":
                    content = str(result.output.get("content", "")).strip()
                    snippet = (content[:280] + "...") if len(content) > 280 else content
                    return f"Read {path}: {snippet}"
            return f"Done. {tool_name} executed successfully."

        if result.status == "requires_confirmation":
            return "This action needs your confirmation in the HUD popup before I can execute it."

        if result.status == "denied" and str(result.output.get("reason", "")) == "tool_not_registered":
            return "That specific tool is not available yet in this build. I can use registered tools such as system info, web search, open URL, app launch, command execution, file management, and screen inspection."

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

    @staticmethod
    def _extract_url_from_text(text: str) -> str:
        m = re.search(r"(https?://[^\s]+)", text or "", flags=re.IGNORECASE)
        return m.group(1).strip() if m else ""
    
    async def get_memory_stats(self) -> dict[str, Any]:
        """Get current conversation memory statistics"""
        return await self.memory.get_stats()
    
    async def clear_memory(self) -> None:
        """Clear conversation history"""
        await self.memory.clear_session()
    
    def get_router_stats(self) -> dict[str, Any]:
        """Get current router configuration and thresholds"""
        return self.router.get_router_stats()
