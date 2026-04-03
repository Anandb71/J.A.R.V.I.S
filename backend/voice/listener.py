"""Speech-to-text adapters for JARVIS."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class TranscriptionResult:
    text: str
    language: str | None = None
    confidence: float | None = None
    provider: str = "echo"


class SpeechToTextEngine:
    async def transcribe(self, audio: bytes | Path | str) -> TranscriptionResult:
        raise NotImplementedError


class EchoSpeechToTextEngine(SpeechToTextEngine):
    """Deterministic fallback that treats text input as transcription output."""

    async def transcribe(self, audio: bytes | Path | str) -> TranscriptionResult:
        if isinstance(audio, bytes):
            text = audio.decode("utf-8", errors="ignore")
        elif isinstance(audio, Path):
            text = audio.read_text(encoding="utf-8", errors="ignore")
        else:
            text = str(audio)
        return TranscriptionResult(text=text.strip(), provider="echo")


class FasterWhisperEngine(SpeechToTextEngine):
    """Optional faster-whisper adapter."""

    def __init__(self, model_size: str = "base", device: str = "cpu", compute_type: str = "int8") -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self._model = None

    def _load(self) -> None:
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:  # pragma: no cover - optional dependency path
            raise RuntimeError("faster-whisper is unavailable") from exc
        self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)

    async def transcribe(self, audio: bytes | Path | str) -> TranscriptionResult:
        self._load()
        if self._model is None:
            return TranscriptionResult(text="", provider="faster_whisper")

        if isinstance(audio, (bytes, str)):
            raise RuntimeError("faster-whisper adapter expects an audio file path")

        segments, info = self._model.transcribe(str(audio), vad_filter=True)
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        return TranscriptionResult(text=text.strip(), language=getattr(info, "language", None), provider="faster_whisper")
