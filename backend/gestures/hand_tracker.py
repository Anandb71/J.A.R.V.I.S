from __future__ import annotations

import asyncio
import time
from typing import Any

from backend.gestures.gesture_engine import GestureEngine
from backend.logging import get_logger

log = get_logger(__name__)


class HandTracker:
    """Feature-gated hand tracker scaffold with optional MediaPipe runtime."""

    def __init__(self, camera_index: int = 0) -> None:
        self.camera_index = camera_index
        self.engine = GestureEngine()
        self._running = False
        self._task: asyncio.Task | None = None
        self._result_queue: asyncio.Queue[list[dict[str, float]]] = asyncio.Queue(maxsize=8)
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.create_task(self._pump())
        log.info("gesture.tracker.started", camera_index=self.camera_index)

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        log.info("gesture.tracker.stopped")

    async def _pump(self) -> None:
        # Placeholder loop until full MediaPipe Tasks API integration lands.
        while self._running:
            await asyncio.sleep(0.1)

    def _on_result(self, landmarks: list[dict[str, float]]) -> None:
        """Thread-safe enqueue with QueueFull protection."""
        if not self._loop:
            return
        try:
            self._loop.call_soon_threadsafe(self._result_queue.put_nowait, landmarks)
        except asyncio.QueueFull:
            pass

    async def next_event(self, timeout: float = 0.5) -> dict[str, Any] | None:
        if not self._running:
            return None
        try:
            points = await asyncio.wait_for(self._result_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

        gesture = self.engine.classify(points)
        if not gesture:
            return None

        return {
            "name": gesture.name,
            "confidence": gesture.confidence,
            "timestamp": gesture.timestamp,
            "points": points,
        }
