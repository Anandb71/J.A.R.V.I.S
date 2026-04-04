from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Any


class ToolRisk(IntEnum):
    SAFE = 0
    VISUAL = 1
    KEYBOARD = 2
    DENY = 3


TOOL_RISK_TIERS: dict[str, ToolRisk] = {
    "system_info": ToolRisk.SAFE,
    "search_web": ToolRisk.SAFE,
    "fetch_webpage": ToolRisk.SAFE,
    "open_url": ToolRisk.SAFE,
    "set_reminder": ToolRisk.SAFE,
    "get_datetime": ToolRisk.SAFE,
    "get_weather": ToolRisk.SAFE,
    "open_application": ToolRisk.VISUAL,
    "control_volume": ToolRisk.VISUAL,
    "control_brightness": ToolRisk.VISUAL,
    "run_command": ToolRisk.KEYBOARD,
    "manage_files": ToolRisk.KEYBOARD,
    "ai_write_code": ToolRisk.KEYBOARD,
}

INTERNET_TOOLS = {"search_web", "fetch_webpage", "open_url", "get_weather"}


OLLAMA_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "system_info",
            "description": "Get current system status and usage information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "metric": {
                        "type": "string",
                        "description": "Optional metric scope (cpu, memory, disk, network).",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_application",
            "description": "Open an application by name on the local machine.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Application name, e.g. notepad, chrome, code.",
                    }
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for a user query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query.",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_webpage",
            "description": "Fetch and summarize text content from a webpage URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Page URL to fetch, e.g. https://example.com.",
                    }
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_url",
            "description": "Open a website URL in the user's default browser.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to open in browser.",
                    }
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_reminder",
            "description": "Set a reminder for the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "minutes": {"type": "integer", "minimum": 1},
                },
                "required": ["text", "minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "control_volume",
            "description": "Adjust system volume.",
            "parameters": {
                "type": "object",
                "properties": {
                    "level": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 100,
                    }
                },
                "required": ["level"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "control_brightness",
            "description": "Adjust display brightness (Windows primary monitor).",
            "parameters": {
                "type": "object",
                "properties": {
                    "level": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 100,
                    }
                },
                "required": ["level"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Execute a shell command (requires explicit user confirmation).",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_files",
            "description": "Create, move, or delete files (requires explicit user confirmation).",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string"},
                    "path": {"type": "string"},
                    "target": {
                        "type": "string",
                        "description": "Content for write operations.",
                    },
                },
                "required": ["operation", "path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ai_write_code",
            "description": "Generate code from a task description and write it to a file under src/.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "What code to create.",
                    },
                    "path": {
                        "type": "string",
                        "description": "Target file path inside src/, e.g. src/features/weather/widget.ts.",
                    },
                    "language": {
                        "type": "string",
                        "description": "Optional language hint (typescript, javascript, python, css, html, json).",
                    },
                },
                "required": ["task"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_datetime",
            "description": "Get current date, time, day of week, and timezone.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a city using Open-Meteo (free, no key needed).",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name, e.g. London, New York, Mumbai.",
                    }
                },
                "required": ["city"],
            },
        },
    },
]


@dataclass(frozen=True)
class ToolDecision:
    name: str
    allowed: bool
    requires_confirmation: bool = False
    reason: str = ""


def evaluate_tool_request(
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    auto_approve: bool = False,
    internet_enabled: bool = True,
) -> ToolDecision:
    _ = arguments or {}

    tier = TOOL_RISK_TIERS.get(tool_name)
    if tier is None:
        return ToolDecision(name=tool_name, allowed=False, reason="tool_not_registered")

    if tool_name in INTERNET_TOOLS and not internet_enabled:
        return ToolDecision(name=tool_name, allowed=False, reason="internet_disabled")

    if tier == ToolRisk.DENY:
        return ToolDecision(name=tool_name, allowed=False, reason="hardcoded_deny")

    if tier == ToolRisk.SAFE:
        return ToolDecision(name=tool_name, allowed=True, reason="tier_safe")

    if tier in {ToolRisk.VISUAL, ToolRisk.KEYBOARD}:
        if auto_approve:
            return ToolDecision(name=tool_name, allowed=True, reason="auto_approved")
        return ToolDecision(
            name=tool_name,
            allowed=False,
            requires_confirmation=True,
            reason=f"tier_{tier.name.lower()}_requires_confirmation",
        )

    return ToolDecision(
        name=tool_name,
        allowed=False,
        reason="unknown_tier",
    )


def get_ollama_tool_schemas() -> list[dict[str, Any]]:
    return OLLAMA_TOOL_SCHEMAS
