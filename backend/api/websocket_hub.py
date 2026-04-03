from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket


@dataclass
class BroadcastMessage:
    event: str
    payload: dict[str, Any]


class WebSocketHub:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: BroadcastMessage) -> None:
        stale: list[WebSocket] = []
        async with self._lock:
            targets = list(self._connections)

        for ws in targets:
            try:
                await ws.send_json({"event": message.event, "payload": message.payload})
            except Exception:
                stale.append(ws)

        if stale:
            async with self._lock:
                for ws in stale:
                    self._connections.discard(ws)

    @property
    def connection_count(self) -> int:
        return len(self._connections)
