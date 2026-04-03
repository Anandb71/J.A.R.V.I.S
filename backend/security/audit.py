from __future__ import annotations

import atexit
import json
import logging
import logging.handlers
import queue
import time
from pathlib import Path

_AUDIT_DIR = Path.home() / ".jarvis" / "audit"
_AUDIT_FILE = _AUDIT_DIR / "tool_audit.jsonl"
_MAX_BYTES = 5 * 1024 * 1024
_BACKUP_COUNT = 5

_listener: logging.handlers.QueueListener | None = None
_audit_logger: logging.Logger | None = None


class _JsonlFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return record.getMessage()


def _ensure_started() -> logging.Logger:
    global _listener, _audit_logger
    if _audit_logger is not None:
        return _audit_logger

    _AUDIT_DIR.mkdir(parents=True, exist_ok=True)

    file_handler = logging.handlers.RotatingFileHandler(
        _AUDIT_FILE,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(_JsonlFormatter())

    log_queue: queue.Queue = queue.Queue(-1)
    _listener = logging.handlers.QueueListener(log_queue, file_handler, respect_handler_level=True)
    _listener.start()

    _audit_logger = logging.getLogger("jarvis.audit")
    _audit_logger.setLevel(logging.INFO)
    _audit_logger.addHandler(logging.handlers.QueueHandler(log_queue))
    _audit_logger.propagate = False

    def _shutdown_listener() -> None:
        if _listener is not None:
            _listener.stop()

    atexit.register(_shutdown_listener)
    return _audit_logger


def log_tool_invocation(
    tool_name: str,
    arguments: dict,
    status: str,
    tier: str = "unknown",
    duration_ms: float | None = None,
) -> None:
    logger = _ensure_started()
    record = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "tool": tool_name,
        "args": arguments,
        "status": status,
        "tier": tier,
    }
    if duration_ms is not None:
        record["duration_ms"] = round(duration_ms, 1)
    logger.info(json.dumps(record, default=str))
