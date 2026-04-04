from __future__ import annotations

import asyncio
import time

from backend.logging import get_logger

log = get_logger(__name__)


async def watchdog_loop(interval: float = 1.0, warning_ms: float = 250.0) -> None:
    """Monitor event loop drift and log when scheduler lag exceeds threshold."""
    expected_next = time.perf_counter() + interval
    while True:
        await asyncio.sleep(interval)
        now = time.perf_counter()
        drift_ms = max(0.0, (now - expected_next) * 1000)
        expected_next = now + interval
        if drift_ms > warning_ms:
            log.warning("watchdog.loop_drift", drift_ms=round(drift_ms, 2), warning_ms=warning_ms)
