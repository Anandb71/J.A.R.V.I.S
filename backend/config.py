from dataclasses import dataclass
import os

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("JARVIS_BACKEND_HOST", "127.0.0.1")
    port: int = int(os.getenv("JARVIS_BACKEND_PORT", "8765"))
    app_name: str = os.getenv("JARVIS_APP_NAME", "JARVIS Backend")
    app_version: str = os.getenv("JARVIS_APP_VERSION", "0.1.0")

    ai_provider: str = os.getenv("JARVIS_AI_PROVIDER", "local")
    local_model: str = os.getenv("JARVIS_LOCAL_MODEL", "qwen2.5:3b-instruct")
    local_ai_url: str = os.getenv("JARVIS_LOCAL_AI_URL", "http://127.0.0.1:11434")
    cloud_model: str = os.getenv("JARVIS_CLOUD_MODEL", "gpt-4o-mini")
    cloud_api_base_url: str = os.getenv("JARVIS_CLOUD_API_BASE_URL", "https://api.openai.com/v1")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")

    tts_provider: str = os.getenv("JARVIS_TTS_PROVIDER", "edge")
    stt_provider: str = os.getenv("JARVIS_STT_PROVIDER", "faster_whisper")
    wake_word_provider: str = os.getenv("JARVIS_WAKE_WORD_PROVIDER", "manual")
    wake_word_phrase: str = os.getenv("JARVIS_WAKE_WORD_PHRASE", "hey jarvis")
    voice_enabled: bool = os.getenv("JARVIS_VOICE_ENABLED", "true").lower() == "true"
    picovoice_access_key: str = os.getenv("PICOVOICE_ACCESS_KEY", "")
    vision_provider: str = os.getenv("JARVIS_VISION_PROVIDER", "local")
    privacy_mode: bool = os.getenv("JARVIS_PRIVACY_MODE", "true").lower() == "true"
    gesture_enabled: bool = os.getenv("JARVIS_GESTURE_ENABLED", "false").lower() == "true"
    gesture_camera_index: int = int(os.getenv("JARVIS_GESTURE_CAMERA_INDEX", "0"))
    system_metrics_interval: float = float(os.getenv("JARVIS_SYSTEM_METRICS_INTERVAL", "1.0"))


settings = Settings()
