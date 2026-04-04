from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.config import Settings
from backend.vision.screen_analyzer import ScreenAnalyzer, WindowSnapshot
from backend.vision.screen_capture import ScreenCapture


@dataclass(frozen=True)
class VisionSnapshot:
    status: dict[str, object]
    window: dict[str, Any] | None
    capture: dict[str, object]


class VisionManager:
    """Coordinates screen capture, UI tree inspection, and privacy rules."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.analyzer = ScreenAnalyzer(privacy_mode=settings.privacy_mode)
        self.capture = ScreenCapture(provider=settings.vision_provider)

    @classmethod
    def from_settings(cls, settings: Settings) -> "VisionManager":
        return cls(settings)

    def get_status(self) -> dict[str, object]:
        return {
            "enabled": True,
            "privacy_mode": self.settings.privacy_mode,
            "vision_provider": self.settings.vision_provider,
            "capture": self.capture.get_status(),
            "analysis": self.analyzer.get_status(),
        }

    def inspect_active_window(self, max_depth: int = 3, max_nodes: int = 64) -> VisionSnapshot:
        snapshot = self.analyzer.capture_active_window(max_depth=max_depth, max_nodes=max_nodes)
        return VisionSnapshot(
            status=self.get_status(),
            window=self.analyzer.summarize(snapshot),
            capture={"provider": self.capture.provider, "available": self.capture.is_available()},
        )

    def capture_screen(self, region: tuple[int, int, int, int] | None = None) -> dict[str, object]:
        frame = self.capture.capture(region=region)
        return {
            "provider": frame.provider,
            "available": frame.provider != "unavailable",
            "warning": frame.warning,
            "has_frame": frame.frame is not None,
        }
