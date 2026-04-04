from __future__ import annotations

import asyncio
import importlib
from pathlib import Path
import threading
import time
from typing import Any
import urllib.request

from backend.gestures.gesture_engine import GestureEngine
from backend.gestures.one_euro import OneEuroFilter
from backend.logging import get_logger

log = get_logger(__name__)


class HandTracker:
    """MediaPipe-based hand tracker with LIVE_STREAM callbacks and smoothing."""

    MODEL_URL = (
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
        "hand_landmarker/float16/1/hand_landmarker.task"
    )

    def __init__(self, camera_index: int = 0) -> None:
        self.camera_index = camera_index
        self.engine = GestureEngine()
        self._running = False
        self._result_queue: asyncio.Queue[list[dict[str, float]]] = asyncio.Queue(maxsize=8)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._capture_thread: threading.Thread | None = None
        self._capture_stop = threading.Event()
        self._landmarker: Any = None
        self._capture: Any = None
        self._filters: list[OneEuroFilter] = []
        self._last_filter_time = time.monotonic()

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def model_path(self) -> Path:
        return Path.home() / ".jarvis" / "models" / "hand_landmarker.task"

    def _ensure_model(self) -> Path:
        path = self.model_path
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return path
        log.info("gesture.model.download.start", url=self.MODEL_URL)
        urllib.request.urlretrieve(self.MODEL_URL, path)
        log.info("gesture.model.download.done", path=str(path))
        return path

    def _init_filters(self) -> None:
        now = time.monotonic()
        self._last_filter_time = now
        self._filters = [OneEuroFilter(t0=now, x0=0.0) for _ in range(21 * 3)]

    async def start(self) -> None:
        if self._running:
            return

        self._loop = asyncio.get_running_loop()
        model_path = await asyncio.to_thread(self._ensure_model)
        self._init_filters()

        try:
            cv2 = importlib.import_module("cv2")
            mediapipe = importlib.import_module("mediapipe")
            mp_python = importlib.import_module("mediapipe.tasks.python")
            vision = importlib.import_module("mediapipe.tasks.python.vision")
            Image = getattr(mediapipe, "Image")
            ImageFormat = getattr(mediapipe, "ImageFormat")
        except Exception as exc:
            log.error("gesture.tracker.deps_missing", error=str(exc))
            return

        base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.LIVE_STREAM,
            num_hands=1,
            min_hand_detection_confidence=0.7,
            min_tracking_confidence=0.5,
            result_callback=self._on_result,
        )

        self._landmarker = vision.HandLandmarker.create_from_options(options)
        self._capture = cv2.VideoCapture(self.camera_index)
        if not self._capture.isOpened():
            log.error("gesture.tracker.camera_unavailable", camera_index=self.camera_index)
            self._landmarker.close()
            self._landmarker = None
            self._capture = None
            return

        self._capture_stop.clear()
        self._running = True
        self._capture_thread = threading.Thread(
            target=self._capture_loop,
            args=(cv2, Image, ImageFormat),
            daemon=True,
            name="jarvis-gesture-capture",
        )
        self._capture_thread.start()
        log.info("gesture.tracker.started", camera_index=self.camera_index)

    async def stop(self) -> None:
        if not self._running:
            return

        self._running = False
        self._capture_stop.set()

        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=1.5)
        self._capture_thread = None

        if self._capture is not None:
            try:
                self._capture.release()
            except Exception:
                pass
            self._capture = None

        if self._landmarker is not None:
            try:
                self._landmarker.close()
            except Exception:
                pass
            self._landmarker = None

        log.info("gesture.tracker.stopped")

    def _capture_loop(self, cv2, Image, ImageFormat) -> None:  # type: ignore[no-untyped-def]
        assert self._capture is not None
        assert self._landmarker is not None

        while not self._capture_stop.is_set():
            ok, frame = self._capture.read()
            if not ok:
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = Image(image_format=ImageFormat.SRGB, data=rgb)
            timestamp_ms = time.monotonic_ns() // 1_000_000
            try:
                self._landmarker.detect_async(mp_image, timestamp_ms)
            except Exception as exc:
                log.warning("gesture.detect_async.failed", error=str(exc))

    def _enqueue_landmarks(self, landmarks: list[dict[str, float]]) -> None:
        try:
            self._result_queue.put_nowait(landmarks)
        except asyncio.QueueFull:
            pass

    def _on_result(self, result, _output_image, _timestamp_ms: int) -> None:  # type: ignore[no-untyped-def]
        if not getattr(result, "hand_landmarks", None):
            return
        hand = result.hand_landmarks[0]

        now = time.monotonic()
        if now <= self._last_filter_time:
            now = self._last_filter_time + 1e-3
        self._last_filter_time = now

        filtered: list[dict[str, float]] = []
        for idx, lm in enumerate(hand):
            fx = self._filters[idx * 3](now, float(lm.x))
            fy = self._filters[idx * 3 + 1](now, float(lm.y))
            fz = self._filters[idx * 3 + 2](now, float(lm.z))
            filtered.append({"x": round(fx, 4), "y": round(fy, 4), "z": round(fz, 4)})

        if not self._loop:
            return
        self._loop.call_soon_threadsafe(self._enqueue_landmarks, filtered)

    async def next_event(self, timeout: float = 0.5) -> dict[str, Any] | None:
        if not self._running:
            return None
        try:
            points = await asyncio.wait_for(self._result_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

        gesture = self.engine.classify(points)
        if not gesture:
            return None

        return {
            "name": gesture.name,
            "confidence": gesture.confidence,
            "timestamp": gesture.timestamp,
            "points": points,
        }
