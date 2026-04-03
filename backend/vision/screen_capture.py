from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CaptureFrame:
    provider: str
    frame: Any | None
    warning: str | None = None


class ScreenCapture:
    """Best-effort screen capture abstraction with optional providers."""

    def __init__(self, provider: str = "local") -> None:
        self.provider = provider
        self._bettercam = None
        self._image_grab = None
        self._load_providers()

    def _load_providers(self) -> None:
        try:
            import bettercam  # type: ignore

            self._bettercam = bettercam.create()
            self.provider = "bettercam"
            return
        except Exception:
            self._bettercam = None

        try:
            from PIL import ImageGrab  # type: ignore

            self._image_grab = ImageGrab
            self.provider = "pillow"
        except Exception:
            self._image_grab = None
            self.provider = "unavailable"

    def is_available(self) -> bool:
        return self.provider != "unavailable"

    def capture(self, region: tuple[int, int, int, int] | None = None) -> CaptureFrame:
        if self._bettercam is not None:
            try:
                frame = self._bettercam.grab(region=region)
                return CaptureFrame(provider="bettercam", frame=frame)
            except Exception as exc:
                return CaptureFrame(provider="bettercam", frame=None, warning=str(exc))

        if self._image_grab is not None:
            try:
                frame = self._image_grab.grab(bbox=region)
                return CaptureFrame(provider="pillow", frame=frame)
            except Exception as exc:
                return CaptureFrame(provider="pillow", frame=None, warning=str(exc))

        return CaptureFrame(provider="unavailable", frame=None, warning="No capture provider available")

    def get_status(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "available": self.is_available(),
        }
