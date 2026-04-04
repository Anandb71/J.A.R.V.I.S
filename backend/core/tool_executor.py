"""Tool execution pipeline with policy checks and optional confirmation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import platform
import subprocess
import time
import uuid
from typing import Any

import httpx

from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.core.tools import TOOL_RISK_TIERS, evaluate_tool_request
from backend.logging import get_logger
from backend.security.audit import log_tool_invocation

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
log = get_logger(__name__)


@dataclass
class ToolExecutionResult:
    status: str
    tool_name: str
    output: dict[str, Any]
    requires_confirmation: bool = False
    request_id: str | None = None

    def render_for_model(self) -> str:
        return str(self.output)


class ToolExecutor:
    def __init__(self) -> None:
        self._pending_confirmations: dict[str, asyncio.Future[bool]] = {}
        self._aliases: dict[str, str] = {
            "get_screen_info": "system_info",
            "screen_info": "system_info",
            "get_system_info": "system_info",
            "set_brightness": "control_brightness",
            "brightness": "control_brightness",
            "lightingsystem": "control_brightness",
            "lighting_system": "control_brightness",
            "set_volume": "control_volume",
            "datetime": "get_datetime",
            "weather": "get_weather",
        }

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        hub: WebSocketHub | None = None,
    ) -> ToolExecutionResult:
        args = arguments or {}
        normalized_tool = self._normalize_tool_name(tool_name)
        decision = evaluate_tool_request(normalized_tool, args)
        log.info(
            "tools.execute.request",
            tool_name=normalized_tool,
            allowed=decision.allowed,
            requires_confirmation=decision.requires_confirmation,
        )

        if not decision.allowed and decision.requires_confirmation:
            request_id = uuid.uuid4().hex[:10]
            if hub is None:
                return ToolExecutionResult(
                    status="requires_confirmation",
                    tool_name=normalized_tool,
                    output={"reason": decision.reason, "message": "Confirmation required in HUD."},
                    requires_confirmation=True,
                    request_id=request_id,
                )

            loop = asyncio.get_running_loop()
            future: asyncio.Future[bool] = loop.create_future()
            self._pending_confirmations[request_id] = future

            await hub.broadcast(
                BroadcastMessage(
                    event="brain:confirm_request",
                    payload={
                        "request_id": request_id,
                        "tool_name": normalized_tool,
                        "arguments": args,
                        "reason": decision.reason,
                    },
                )
            )

            try:
                approved = await asyncio.wait_for(future, timeout=45.0)
            except asyncio.TimeoutError:
                approved = False
                log.warning("tools.confirmation.timeout", tool_name=normalized_tool)
            finally:
                self._pending_confirmations.pop(request_id, None)

            if not approved:
                log.info("tools.confirmation.denied", tool_name=normalized_tool)
                return ToolExecutionResult(
                    status="denied",
                    tool_name=normalized_tool,
                    output={"reason": "User denied tool execution."},
                    requires_confirmation=True,
                    request_id=request_id,
                )

            return await self._dispatch(normalized_tool, args)

        if not decision.allowed:
            return ToolExecutionResult(
                status="denied",
                tool_name=normalized_tool,
                output={"reason": decision.reason},
            )

        return await self._dispatch(normalized_tool, args)

    def _normalize_tool_name(self, tool_name: str) -> str:
        key = str(tool_name or "").strip().lower()
        return self._aliases.get(key, tool_name)

    def resolve_confirmation(self, request_id: str, approved: bool) -> bool:
        future = self._pending_confirmations.get(request_id)
        if not future or future.done():
            return False
        future.set_result(bool(approved))
        return True

    async def _dispatch(self, tool_name: str, args: dict[str, Any]) -> ToolExecutionResult:
        handler = {
            "system_info": self._system_info,
            "open_application": self._open_application,
            "search_web": self._search_web,
            "set_reminder": self._set_reminder,
            "control_volume": self._control_volume,
            "control_brightness": self._control_brightness,
            "run_command": self._run_command,
            "manage_files": self._manage_files,
            "get_datetime": self._get_datetime,
            "get_weather": self._get_weather,
        }.get(tool_name)

        if handler is None:
            log.error("tools.dispatch.missing_handler", tool_name=tool_name)
            return ToolExecutionResult(
                status="error",
                tool_name=tool_name,
                output={"error": "No handler registered for tool."},
            )

        started = time.perf_counter()
        result = await handler(args)
        duration_ms = (time.perf_counter() - started) * 1000
        tier = TOOL_RISK_TIERS.get(tool_name)
        tier_name = tier.name if tier is not None else "unknown"
        log_tool_invocation(
            tool_name=tool_name,
            arguments=args,
            status=result.status,
            tier=tier_name,
            duration_ms=duration_ms,
        )
        log.info("tools.dispatch.result", tool_name=tool_name, status=result.status)
        return result

    async def _system_info(self, _args: dict[str, Any]) -> ToolExecutionResult:
        info: dict[str, Any] = {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "processor": platform.processor(),
        }
        try:
            import psutil  # type: ignore

            info.update(
                {
                    "cpu_percent": psutil.cpu_percent(interval=0.1),
                    "memory_percent": psutil.virtual_memory().percent,
                }
            )
        except Exception:
            info["note"] = "psutil unavailable; returned basic system info only"

        return ToolExecutionResult(status="ok", tool_name="system_info", output=info)

    async def _open_application(self, args: dict[str, Any]) -> ToolExecutionResult:
        name = str(args.get("name", "")).strip()
        if not name:
            return ToolExecutionResult(
                status="error",
                tool_name="open_application",
                output={"error": "Missing app name"},
            )
        try:
            subprocess.Popen(["cmd", "/c", "start", "", name], shell=False)
            return ToolExecutionResult(
                status="ok",
                tool_name="open_application",
                output={"launched": name},
            )
        except Exception as exc:
            return ToolExecutionResult(
                status="error",
                tool_name="open_application",
                output={"error": str(exc)},
            )

    async def _search_web(self, args: dict[str, Any]) -> ToolExecutionResult:
        query = str(args.get("query", "")).strip()
        if not query:
            return ToolExecutionResult(status="error", tool_name="search_web", output={"error": "Missing query"})
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://api.duckduckgo.com/",
                    params={"q": query, "format": "json", "no_redirect": 1, "no_html": 1},
                )
                resp.raise_for_status()
                data = resp.json()

            # Extract best answer
            abstract = data.get("AbstractText", "")
            answer = data.get("Answer", "")
            definition = data.get("Definition", "")
            heading = data.get("Heading", "")
            url = data.get("AbstractURL", "")
            related = [t.get("Text", "") for t in (data.get("RelatedTopics", []) or [])[:3] if isinstance(t, dict) and t.get("Text")]

            result_text = abstract or answer or definition
            if not result_text and related:
                result_text = "; ".join(related)
            if not result_text:
                result_text = f"No instant answer found for '{query}'. Try asking me directly."

            return ToolExecutionResult(
                status="ok",
                tool_name="search_web",
                output={"query": query, "heading": heading, "answer": result_text, "url": url, "related": related},
            )
        except Exception as exc:
            return ToolExecutionResult(
                status="error",
                tool_name="search_web",
                output={"error": f"Search failed: {exc}", "query": query},
            )

    async def _set_reminder(self, args: dict[str, Any]) -> ToolExecutionResult:
        text = str(args.get("text", "")).strip()
        minutes = int(args.get("minutes", 0) or 0)
        if not text or minutes <= 0:
            return ToolExecutionResult(
                status="error",
                tool_name="set_reminder",
                output={"error": "text and minutes are required"},
            )
        return ToolExecutionResult(
            status="ok",
            tool_name="set_reminder",
            output={"scheduled": True, "text": text, "minutes": minutes},
        )

    async def _control_volume(self, args: dict[str, Any]) -> ToolExecutionResult:
        level = int(args.get("level", -1) or -1)
        if level < 0 or level > 100:
            return ToolExecutionResult(
                status="error",
                tool_name="control_volume",
                output={"error": "level must be between 0 and 100"},
            )
        return ToolExecutionResult(
            status="ok",
            tool_name="control_volume",
            output={"level": level, "note": "Volume handler placeholder."},
        )

    async def _control_brightness(self, args: dict[str, Any]) -> ToolExecutionResult:
        level = int(args.get("level", -1) or -1)
        if level < 0 or level > 100:
            return ToolExecutionResult(
                status="error",
                tool_name="control_brightness",
                output={"error": "level must be between 0 and 100"},
            )

        if platform.system().lower() != "windows":
            return ToolExecutionResult(
                status="error",
                tool_name="control_brightness",
                output={"error": "Brightness control is currently implemented for Windows only."},
            )

        # Use WMI methods exposed by Windows monitor driver stack.
        ps_script = (
            "$methods = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods; "
            f"if ($methods) {{ $methods | ForEach-Object {{ $_.WmiSetBrightness(1, {level}) | Out-Null }}; "
            "Write-Output 'OK' } else { Write-Output 'NO_MONITOR_API' }"
        )

        proc = await asyncio.create_subprocess_exec(
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            ps_script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        out = stdout.decode(errors="ignore").strip()
        err = stderr.decode(errors="ignore").strip()

        if proc.returncode == 0 and out == "OK":
            return ToolExecutionResult(
                status="ok",
                tool_name="control_brightness",
                output={"level": level},
            )

        if out == "NO_MONITOR_API":
            return ToolExecutionResult(
                status="error",
                tool_name="control_brightness",
                output={
                    "error": "Monitor brightness API unavailable (common on some external displays).",
                    "hint": "Try laptop internal display or GPU vendor control panel.",
                },
            )

        return ToolExecutionResult(
            status="error",
            tool_name="control_brightness",
            output={"error": err or out or "Brightness command failed."},
        )

    async def _run_command(self, args: dict[str, Any]) -> ToolExecutionResult:
        command = str(args.get("command", "")).strip()
        if not command:
            return ToolExecutionResult(status="error", tool_name="run_command", output={"error": "Missing command"})

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        except asyncio.TimeoutError:
            proc.kill()
            return ToolExecutionResult(
                status="error",
                tool_name="run_command",
                output={"error": "Command timed out after 30 seconds"},
            )
        return ToolExecutionResult(
            status="ok" if proc.returncode == 0 else "error",
            tool_name="run_command",
            output={
                "returncode": proc.returncode,
                "stdout": stdout.decode(errors="ignore")[:4000],
                "stderr": stderr.decode(errors="ignore")[:4000],
            },
        )

    async def _manage_files(self, args: dict[str, Any]) -> ToolExecutionResult:
        action = str(args.get("operation", args.get("action", ""))).strip().lower()
        path_value = str(args.get("path", "")).strip()
        content = str(args.get("target", args.get("content", "")))

        if not action:
            return ToolExecutionResult(
                status="error",
                tool_name="manage_files",
                output={"error": "Missing operation"},
            )

        if action in {"list", "read", "write", "delete", "mkdir"} and not path_value:
            return ToolExecutionResult(
                status="error",
                tool_name="manage_files",
                output={"error": "Missing path"},
            )

        def _resolve_safe_path(value: str) -> Path:
            candidate = Path(value)
            if not candidate.is_absolute():
                candidate = WORKSPACE_ROOT / candidate
            resolved = candidate.resolve()
            if WORKSPACE_ROOT not in resolved.parents and resolved != WORKSPACE_ROOT:
                raise ValueError("Path is outside workspace")
            return resolved

        try:
            if action == "list":
                target = _resolve_safe_path(path_value)
                if not target.exists() or not target.is_dir():
                    raise ValueError("Path is not a directory")
                items = [p.name + ("/" if p.is_dir() else "") for p in sorted(target.iterdir())]
                return ToolExecutionResult(
                    status="ok",
                    tool_name="manage_files",
                    output={"action": "list", "path": str(target), "items": items},
                )

            if action == "read":
                target = _resolve_safe_path(path_value)
                if not target.exists() or not target.is_file():
                    raise ValueError("Path is not a file")
                data = target.read_text(encoding="utf-8", errors="ignore")
                return ToolExecutionResult(
                    status="ok",
                    tool_name="manage_files",
                    output={"action": "read", "path": str(target), "content": data[:8000]},
                )

            if action == "write":
                target = _resolve_safe_path(path_value)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                return ToolExecutionResult(
                    status="ok",
                    tool_name="manage_files",
                    output={"action": "write", "path": str(target), "bytes": len(content.encode("utf-8"))},
                )

            if action == "delete":
                target = _resolve_safe_path(path_value)
                if target.is_dir():
                    import shutil

                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
                return ToolExecutionResult(
                    status="ok",
                    tool_name="manage_files",
                    output={"action": "delete", "path": str(target)},
                )

            if action == "mkdir":
                target = _resolve_safe_path(path_value)
                target.mkdir(parents=True, exist_ok=True)
                return ToolExecutionResult(
                    status="ok",
                    tool_name="manage_files",
                    output={"action": "mkdir", "path": str(target)},
                )

            return ToolExecutionResult(
                status="error",
                tool_name="manage_files",
                output={"error": f"Unsupported action: {action}"},
            )
        except Exception as exc:
            return ToolExecutionResult(
                status="error",
                tool_name="manage_files",
                output={"error": str(exc)},
            )

    async def _get_datetime(self, _args: dict[str, Any]) -> ToolExecutionResult:
        now = datetime.now()
        return ToolExecutionResult(
            status="ok",
            tool_name="get_datetime",
            output={
                "date": now.strftime("%Y-%m-%d"),
                "time": now.strftime("%H:%M:%S"),
                "day": now.strftime("%A"),
                "formatted": now.strftime("%I:%M %p, %A %B %d, %Y"),
                "iso": now.isoformat(),
                "timestamp": int(now.timestamp()),
            },
        )

    async def _get_weather(self, args: dict[str, Any]) -> ToolExecutionResult:
        city = str(args.get("city", "")).strip()
        if not city:
            return ToolExecutionResult(
                status="error",
                tool_name="get_weather",
                output={"error": "Missing city name"},
            )

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                # 1. Geocode city name → lat/lon
                geo_resp = await client.get(
                    "https://geocoding-api.open-meteo.com/v1/search",
                    params={"name": city, "count": 1, "language": "en"},
                )
                geo_resp.raise_for_status()
                geo_data = geo_resp.json()

                results = geo_data.get("results", [])
                if not results:
                    return ToolExecutionResult(
                        status="error",
                        tool_name="get_weather",
                        output={"error": f"City '{city}' not found."},
                    )

                loc = results[0]
                lat, lon = loc["latitude"], loc["longitude"]
                resolved_name = loc.get("name", city)
                country = loc.get("country", "")

                # 2. Get current weather
                wx_resp = await client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
                        "timezone": "auto",
                    },
                )
                wx_resp.raise_for_status()
                wx_data = wx_resp.json()

            current = wx_data.get("current", {})
            wmo_code = current.get("weather_code", 0)
            condition = self._wmo_to_text(wmo_code)

            return ToolExecutionResult(
                status="ok",
                tool_name="get_weather",
                output={
                    "city": resolved_name,
                    "country": country,
                    "temperature_c": current.get("temperature_2m"),
                    "feels_like_c": current.get("apparent_temperature"),
                    "humidity_percent": current.get("relative_humidity_2m"),
                    "wind_speed_kmh": current.get("wind_speed_10m"),
                    "condition": condition,
                    "weather_code": wmo_code,
                },
            )
        except Exception as exc:
            return ToolExecutionResult(
                status="error",
                tool_name="get_weather",
                output={"error": f"Weather lookup failed: {exc}"},
            )

    @staticmethod
    def _wmo_to_text(code: int) -> str:
        """Convert WMO weather code to human-readable description."""
        WMO = {
            0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
            45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
            55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
            71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
            80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
            85: "Slight snow showers", 86: "Heavy snow showers",
            95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
        }
        return WMO.get(code, f"Unknown ({code})")
