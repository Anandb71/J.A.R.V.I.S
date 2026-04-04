"""Tool execution pipeline with policy checks and optional confirmation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import platform
import subprocess
import uuid
from typing import Any

from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.core.tools import evaluate_tool_request


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

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        hub: WebSocketHub | None = None,
    ) -> ToolExecutionResult:
        args = arguments or {}
        decision = evaluate_tool_request(tool_name, args)

        if not decision.allowed and decision.requires_confirmation:
            request_id = uuid.uuid4().hex[:10]
            if hub is None:
                return ToolExecutionResult(
                    status="requires_confirmation",
                    tool_name=tool_name,
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
                        "tool_name": tool_name,
                        "arguments": args,
                        "reason": decision.reason,
                    },
                )
            )

            try:
                approved = await asyncio.wait_for(future, timeout=45.0)
            except asyncio.TimeoutError:
                approved = False
            finally:
                self._pending_confirmations.pop(request_id, None)

            if not approved:
                return ToolExecutionResult(
                    status="denied",
                    tool_name=tool_name,
                    output={"reason": "User denied tool execution."},
                    requires_confirmation=True,
                    request_id=request_id,
                )

            return await self._dispatch(tool_name, args)

        if not decision.allowed:
            return ToolExecutionResult(
                status="denied",
                tool_name=tool_name,
                output={"reason": decision.reason},
            )

        return await self._dispatch(tool_name, args)

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
            "run_command": self._run_command,
            "manage_files": self._manage_files,
        }.get(tool_name)

        if handler is None:
            return ToolExecutionResult(
                status="error",
                tool_name=tool_name,
                output={"error": "No handler registered for tool."},
            )

        return await handler(args)

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
        return ToolExecutionResult(
            status="ok",
            tool_name="search_web",
            output={"query": query, "note": "Web tool placeholder; integrate external search provider."},
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

    async def _run_command(self, args: dict[str, Any]) -> ToolExecutionResult:
        command = str(args.get("command", "")).strip()
        if not command:
            return ToolExecutionResult(status="error", tool_name="run_command", output={"error": "Missing command"})

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
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
        return ToolExecutionResult(
            status="error",
            tool_name="manage_files",
            output={"error": "manage_files handler not yet implemented"},
        )
