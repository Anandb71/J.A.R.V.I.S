from __future__ import annotations

import asyncio
import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from backend.logging import get_logger

log = get_logger(__name__)

_CRASH_DIR = Path.home() / ".jarvis" / "crash"
_MAX_FILES = 10


def _write_crash_file(payload: dict[str, Any]) -> None:
    _CRASH_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    target = _CRASH_DIR / f"crash-{ts}.json"
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    crash_files = sorted(_CRASH_DIR.glob("crash-*.json"))
    for old in crash_files[:-_MAX_FILES]:
        try:
            old.unlink()
        except OSError:
            pass


def install_crash_hooks(app_version: str) -> None:
    """Install global exception hooks for sync and asyncio crashes."""

    def _sync_hook(exc_type, exc_value, exc_tb) -> None:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "kind": "sync",
            "app_version": app_version,
            "exc_type": getattr(exc_type, "__name__", str(exc_type)),
            "error": str(exc_value),
            "traceback": "".join(traceback.format_exception(exc_type, exc_value, exc_tb)),
        }
        _write_crash_file(payload)
        log.error("crash.sync", error=payload["error"])
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    def _async_hook(loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        exc = context.get("exception")
        if isinstance(exc, asyncio.CancelledError):
            return

        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "kind": "async",
            "app_version": app_version,
            "message": context.get("message", "Unhandled event loop exception"),
            "error": str(exc) if exc else "",
            "traceback": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)) if exc else "",
        }
        _write_crash_file(payload)
        log.error("crash.async", message=payload["message"], error=payload["error"])
        loop.default_exception_handler(context)

    sys.excepthook = _sync_hook
    try:
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(_async_hook)
    except RuntimeError:
        pass
