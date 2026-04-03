"""Voice orchestrator that connects wake word, STT, brain, and TTS."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator

from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.core.brain import AIBrain
from backend.voice.listener import EchoSpeechToTextEngine, SpeechToTextEngine, TranscriptionResult
from backend.voice.speaker import SilentSpeaker, TextToSpeechEngine
from backend.voice.wake_word import ManualWakeWordDetector, WakeWordDetector, WakeWordEvent


class VoiceState(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    ERROR = "error"


@dataclass(slots=True)
class VoiceStatus:
    enabled: bool = True
    state: VoiceState = VoiceState.IDLE
    last_wake_word: str | None = None
    last_transcript: str | None = None
    last_reply: str | None = None
    last_error: str | None = None
    providers: dict[str, str] = field(default_factory=dict)


class VoiceManager:
    def __init__(
        self,
        brain: AIBrain,
        hub: WebSocketHub,
        wake_detector: WakeWordDetector | None = None,
        stt_engine: SpeechToTextEngine | None = None,
        tts_engine: TextToSpeechEngine | None = None,
    ) -> None:
        self.brain = brain
        self.hub = hub
        self.wake_detector = wake_detector or ManualWakeWordDetector()
        self.stt_engine = stt_engine or EchoSpeechToTextEngine()
        self.tts_engine = tts_engine or SilentSpeaker()
        self.status = VoiceStatus(
            providers={
                "wake": type(self.wake_detector).__name__,
                "stt": type(self.stt_engine).__name__,
                "tts": type(self.tts_engine).__name__,
            }
        )
        self._running = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self.wake_detector.start(self._on_wake_word)
        await self._broadcast_state()

    async def stop(self) -> None:
        self._running = False
        await self.wake_detector.stop()
        self.status.state = VoiceState.IDLE
        await self._broadcast_state()

    async def _on_wake_word(self, event: WakeWordEvent) -> None:
        self.status.last_wake_word = event.keyword
        await self.set_state(VoiceState.LISTENING)
        await self.hub.broadcast(
            BroadcastMessage(
                event="voice:wake_word",
                payload={"keyword": event.keyword, "confidence": event.confidence, "source": event.source},
            )
        )

    async def process_transcript(self, transcript: str, prefer_cloud: bool = False) -> dict[str, Any]:
        transcript = transcript.strip()
        if not transcript:
            return {"error": "empty transcript"}

        self.status.last_transcript = transcript
        await self.set_state(VoiceState.THINKING)
        await self.hub.broadcast(BroadcastMessage(event="voice:transcript", payload={"text": transcript}))

        reply = await self.brain.chat(message=transcript, prefer_cloud=prefer_cloud)
        self.status.last_reply = reply.text
        await self.set_state(VoiceState.SPEAKING)

        await self.hub.broadcast(
            BroadcastMessage(
                event="voice:reply",
                payload={
                    "text": reply.text,
                    "provider": reply.provider_used,
                    "latency_ms": reply.latency_ms,
                },
            )
        )

        audio_chunks = []
        async for chunk in self.tts_engine.speak(reply.text):
            audio_chunks.append(len(chunk.data))
            await self.hub.broadcast(
                BroadcastMessage(
                    event="voice:audio_chunk",
                    payload={"provider": chunk.provider, "bytes": len(chunk.data)},
                )
            )

        await self.set_state(VoiceState.IDLE)
        await self.hub.broadcast(
            BroadcastMessage(
                event="voice:done",
                payload={"reply": reply.text, "audio_chunks": audio_chunks, "provider": reply.provider_used},
            )
        )

        return {
            "transcript": transcript,
            "reply": reply.text,
            "provider": reply.provider_used,
            "latency_ms": reply.latency_ms,
            "audio_chunks": audio_chunks,
        }

    async def simulate_wake_word(self, keyword: str = "hey jarvis", confidence: float = 1.0) -> None:
        if isinstance(self.wake_detector, ManualWakeWordDetector):
            await self.wake_detector.trigger(keyword=keyword, confidence=confidence)

    async def set_state(self, state: VoiceState) -> None:
        async with self._lock:
            self.status.state = state
        await self._broadcast_state()

    async def _broadcast_state(self) -> None:
        await self.hub.broadcast(
            BroadcastMessage(
                event="voice:state",
                payload={
                    "enabled": self.status.enabled,
                    "state": self.status.state.value,
                    "last_wake_word": self.status.last_wake_word,
                    "last_transcript": self.status.last_transcript,
                    "last_reply": self.status.last_reply,
                    "providers": self.status.providers,
                },
            )
        )

    async def get_status(self) -> dict[str, Any]:
        async with self._lock:
            return {
                "enabled": self.status.enabled,
                "state": self.status.state.value,
                "last_wake_word": self.status.last_wake_word,
                "last_transcript": self.status.last_transcript,
                "last_reply": self.status.last_reply,
                "last_error": self.status.last_error,
                "providers": self.status.providers,
            }
