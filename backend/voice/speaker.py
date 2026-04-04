"""Text-to-speech adapters for JARVIS."""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator


@dataclass(slots=True)
class SpeechChunk:
    data: bytes
    text: str
    provider: str = "silent"


class TextToSpeechEngine:
    async def speak(self, text: str) -> AsyncIterator[SpeechChunk]:
        raise NotImplementedError


class SilentSpeaker(TextToSpeechEngine):
    async def speak(self, text: str) -> AsyncIterator[SpeechChunk]:
        yield SpeechChunk(data=text.encode("utf-8"), text=text, provider="silent")


class EdgeTTSpeaker(TextToSpeechEngine):
    def __init__(self, voice: str = "en-GB-RyanNeural") -> None:
        self.voice = voice

    async def speak(self, text: str) -> AsyncIterator[SpeechChunk]:
        try:
            import edge_tts  # type: ignore
        except Exception as exc:  # pragma: no cover - optional dependency path
            raise RuntimeError("edge-tts is unavailable") from exc

        communicate = edge_tts.Communicate(text=text, voice=self.voice)
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                yield SpeechChunk(data=chunk["data"], text=text, provider="edge_tts")
