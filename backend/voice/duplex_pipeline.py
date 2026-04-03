"""
Full-duplex voice pipeline with interrupt support.

Key corrections from im5:
  1. faster-whisper is batch-only — buffer then transcribe
  2. edge-tts outputs MP3, not PCM — send MP3 chunks directly via send_bytes()
  3. Use websocket.send_bytes() for binary audio to client
  4. Interrupt via asyncio.Event, checked at every stage

State machine:
  IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
  Any SPEAKING + interrupt → LISTENING (immediate)

Audio contract:
  Client → Server: PCM16 mono 16kHz binary frames
  Server → Client: MP3 binary frames (from edge-tts)
  Server → Client: JSON control frames (transcript, state, tts_done)
"""

import asyncio
import os
import tempfile
import wave
import warnings

from faster_whisper import WhisperModel

from backend.api.websocket_hub import BroadcastMessage
from backend.logging import get_logger

log = get_logger(__name__)


class DuplexVoicePipeline:
    """Full-duplex voice pipeline with barge-in support."""

    MAX_AUDIO_SECONDS = 8.0
    SAMPLE_RATE = 16000
    CHANNELS = 1
    SAMPLE_WIDTH = 2  # 16-bit PCM

    def __init__(self, brain, hub, websocket):
        """
        Initialize pipeline.

        Args:
            brain: AIBrain instance for text generation
            hub: WebSocketHub for broadcasting
            websocket: The specific WebSocket connection for this client
        """
        self.websocket = websocket
        self.brain = brain
        self.hub = hub
        self._audio_buffer = bytearray()
        self._interrupt = asyncio.Event()
        self._current_task = None
        self._stt_model = None
        self.state = "idle"

    async def handle_audio_data(self, pcm_bytes: bytes):
        """
        Receive raw PCM16 chunk from client microphone.

        Args:
            pcm_bytes: Binary PCM16 audio data
        """
        self._audio_buffer.extend(pcm_bytes)
        duration = len(self._audio_buffer) / (self.SAMPLE_RATE * self.SAMPLE_WIDTH)

        # Auto-trigger if buffer reaches max duration
        if duration >= self.MAX_AUDIO_SECONDS:
            log.info("voice.buffer.max_reached", seconds=round(duration, 2))
            await self._process()

    async def handle_speech_end(self):
        """VAD endpoint — client says speech is done."""
        duration = len(self._audio_buffer) / (self.SAMPLE_RATE * self.SAMPLE_WIDTH)
        # Require minimum 300ms of audio
        if duration >= 0.3:
            log.info("voice.speech_end", seconds=round(duration, 2))
            await self._process()
        else:
            self._audio_buffer.clear()
            log.info("voice.speech_discarded_short", seconds=round(duration, 2))

    async def handle_interrupt(self):
        """
        Barge-in: cancel everything, return to listening.
        Client uses this when user speaks while JARVIS is speaking.
        """
        self._interrupt.set()
        if self._current_task and not self._current_task.done():
            try:
                self._current_task.cancel()
            except asyncio.CancelledError:
                pass
        self._audio_buffer.clear()
        self.state = "listening"
        self._interrupt = asyncio.Event()  # Reset for next turn
        log.info("voice.interrupt")

    async def _process(self):
        """Spawn pipeline task for buffered audio."""
        audio = bytes(self._audio_buffer)
        self._audio_buffer.clear()
        self._interrupt = asyncio.Event()
        self.state = "processing"
        self._current_task = asyncio.create_task(self._pipeline(audio))
        log.info("voice.pipeline.spawn", bytes=len(audio))

    async def _pipeline(self, audio: bytes):
        """
        STT → Brain → TTS with interrupt checks.

        Args:
            audio: PCM16 audio bytes
        """
        try:
            # 1. STT (batch — faster-whisper needs file)
            transcript = await self._stt(audio)
            if self._interrupt.is_set() or not transcript:
                log.info("voice.pipeline.transcript_empty_or_interrupted")
                return
            log.info("voice.pipeline.transcript_ready", chars=len(transcript))

            # Add to chat panel
            await self.hub.send_to(
                self.websocket,
                BroadcastMessage(
                    event="voice:transcript",
                    payload={"text": transcript},
                )
            )

            # 2. Brain (streaming via existing chat_stream)
            self.state = "processing"
            full = ""
            async for chunk in self.brain.chat_stream(
                message=transcript,
                hub=self.hub,
                websocket=self.websocket,
                prefer_cloud=False,
            ):
                if self._interrupt.is_set():
                    return
                full += chunk

            if self._interrupt.is_set() or not full:
                log.info("voice.pipeline.reply_empty_or_interrupted")
                return

            # 3. TTS (stream MP3 chunks as binary WS frames)
            self.state = "speaking"
            await self._tts_stream(full)

        except asyncio.CancelledError:
            log.info("voice.pipeline.cancelled")
            pass
        except Exception as e:
            self.state = "error"
            log.error("voice.pipeline.error", error=str(e))
            await self.hub.send_to(
                self.websocket,
                BroadcastMessage(
                    event="voice:error",
                    payload={"error": str(e)},
                )
            )
        finally:
            if not self._interrupt.is_set():
                self.state = "idle"

    async def _stt(self, audio: bytes) -> str:
        """
        Transcribe PCM16 audio using faster-whisper.

        Args:
            audio: PCM16 audio bytes

        Returns:
            Transcribed text
        """
        # Lazy load model
        if self._stt_model is None:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self._stt_model = WhisperModel(
                    "base", device="cpu", compute_type="int8"
                )
                log.info("voice.stt.model_loaded", model="base", device="cpu")

        # Convert PCM16 bytes → WAV file in temp storage
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            with wave.open(tmp, "wb") as wav_file:
                wav_file.setnchannels(self.CHANNELS)
                wav_file.setsampwidth(self.SAMPLE_WIDTH)
                wav_file.setframerate(self.SAMPLE_RATE)
                wav_file.writeframes(audio)
            tmp_path = tmp.name

        # Transcribe
        try:
            segments, _ = self._stt_model.transcribe(
                tmp_path, language="en", beam_size=1
            )
            text = " ".join(seg.text for seg in segments).strip()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        return text

    async def _tts_stream(self, text: str):
        """
        Stream edge-tts MP3 chunks as binary WebSocket frames.

        Args:
            text: Text to speak
        """
        try:
            # Import inside method to avoid hard dependency on edge-tts
            from edge_tts import Communicate

            communicate = Communicate(text=text, voice="en-US-AriaNeural")
            log.info("voice.tts.start", chars=len(text))

            async for chunk in communicate.stream():
                if self._interrupt.is_set():
                    log.info("voice.tts.interrupted")
                    return

                if chunk["type"] == "audio":
                    # Send raw MP3 bytes as binary frame
                    await self.websocket.send_bytes(chunk["data"])

            # Signal end of TTS
            await self.hub.send_to(
                self.websocket,
                BroadcastMessage(event="voice:tts_done", payload={})
            )

        except Exception as e:
            self.state = "error"
            log.error("voice.tts.error", error=str(e))
            await self.hub.send_to(
                self.websocket,
                BroadcastMessage(
                    event="voice:error",
                    payload={"error": f"TTS failed: {str(e)}"},
                )
            )
