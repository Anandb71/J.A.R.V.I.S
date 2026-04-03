from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any


@dataclass
class GestureEvent:
    name: str
    confidence: float
    timestamp: float


class GestureEngine:
    """Simple gesture state engine from normalized hand landmarks."""

    def __init__(self) -> None:
        self._last_emit: dict[str, float] = {}
        self.cooldown_seconds = 0.5

    def classify(self, landmarks: list[dict[str, float]]) -> GestureEvent | None:
        if len(landmarks) < 21:
            return None

        extended = self._finger_state(landmarks)
        now = time.time()

        # Static gesture examples
        if all(extended.values()):
            return self._emit("open_palm", 0.9, now)
        if not any(extended.values()):
            return self._emit("fist", 0.9, now)
        if extended["index"] and not extended["middle"] and not extended["ring"] and not extended["pinky"]:
            return self._emit("point", 0.85, now)

        return None

    def _emit(self, name: str, confidence: float, now: float) -> GestureEvent | None:
        last = self._last_emit.get(name, 0.0)
        if now - last < self.cooldown_seconds:
            return None
        self._last_emit[name] = now
        return GestureEvent(name=name, confidence=confidence, timestamp=now)

    def _finger_state(self, lm: list[dict[str, float]]) -> dict[str, bool]:
        # TIP/PIP indices for non-thumb fingers
        index_ext = lm[8]["y"] < lm[6]["y"]
        middle_ext = lm[12]["y"] < lm[10]["y"]
        ring_ext = lm[16]["y"] < lm[14]["y"]
        pinky_ext = lm[20]["y"] < lm[18]["y"]

        # Thumb extension is lateral; compare distance from wrist on X-axis.
        thumb_ext = abs(lm[4]["x"] - lm[0]["x"]) > abs(lm[3]["x"] - lm[0]["x"])

        return {
            "thumb": thumb_ext,
            "index": index_ext,
            "middle": middle_ext,
            "ring": ring_ext,
            "pinky": pinky_ext,
        }
