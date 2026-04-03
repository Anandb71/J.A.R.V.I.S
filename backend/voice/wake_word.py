"""Wake word abstraction for JARVIS."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional


@dataclass(slots=True)
class WakeWordEvent:
    keyword: str
    confidence: float = 1.0
    source: str = "manual"


WakeWordCallback = Callable[[WakeWordEvent], Awaitable[None] | None]


class WakeWordDetector:
    """Base wake word detector contract."""

    async def start(self, callback: WakeWordCallback) -> None:
        raise NotImplementedError

    async def stop(self) -> None:
        raise NotImplementedError


class ManualWakeWordDetector(WakeWordDetector):
    """Simple testable detector that can be triggered programmatically."""

    def __init__(self, keyword: str = "hey jarvis") -> None:
        self.keyword = keyword
        self._callback: Optional[WakeWordCallback] = None
        self._active = False

    async def start(self, callback: WakeWordCallback) -> None:
        self._callback = callback
        self._active = True

    async def stop(self) -> None:
        self._active = False
        self._callback = None

    async def trigger(self, keyword: str | None = None, confidence: float = 1.0) -> None:
        if not self._active or self._callback is None:
            return
        event = WakeWordEvent(keyword=keyword or self.keyword, confidence=confidence, source="manual")
        result = self._callback(event)
        if asyncio.iscoroutine(result):
            await result


class PorcupineWakeWordDetector(WakeWordDetector):
    """Optional Porcupine adapter; raises if dependency is unavailable."""

    def __init__(self, access_key: str, keyword_paths: list[str] | None = None) -> None:
        self.access_key = access_key
        self.keyword_paths = keyword_paths or []
        self._porcupine = None
        self._callback: Optional[WakeWordCallback] = None

    async def start(self, callback: WakeWordCallback) -> None:
        self._callback = callback
        try:
            import pvporcupine  # type: ignore
            from pvrecorder import PvRecorder  # type: ignore
        except Exception as exc:  # pragma: no cover - optional dependency path
            raise RuntimeError("Porcupine dependencies unavailable") from exc

        self._porcupine = pvporcupine.create(
            access_key=self.access_key,
            keyword_paths=self.keyword_paths or None,
        )
        self._recorder = PvRecorder(device_index=-1, frame_length=self._porcupine.frame_length)
        self._recorder.start()

        async def _poll() -> None:
            while self._porcupine is not None:
                pcm = self._recorder.read()
                keyword_index = self._porcupine.process(pcm)
                if keyword_index >= 0 and self._callback:
                    result = self._callback(WakeWordEvent(keyword="hey jarvis", confidence=1.0, source="porcupine"))
                    if asyncio.iscoroutine(result):
                        await result
                await asyncio.sleep(0)

        asyncio.create_task(_poll())

    async def stop(self) -> None:
        if self._porcupine is not None:
            try:
                self._recorder.stop()
                self._recorder.delete()
                self._porcupine.delete()
            finally:
                self._porcupine = None
                self._callback = None
