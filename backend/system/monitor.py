from __future__ import annotations

import asyncio
import os
import time
import warnings
from dataclasses import dataclass
from typing import Any

import psutil

from backend.api.websocket_hub import BroadcastMessage, WebSocketHub
from backend.logging import get_logger

log = get_logger(__name__)


@dataclass
class _NetSample:
    sent: float
    recv: float
    timestamp: float


class SystemMonitor:
    """Collects host metrics and broadcasts them once per interval."""

    def __init__(self, hub: WebSocketHub, interval: float = 1.0) -> None:
        self.hub = hub
        self.interval = interval
        self._prev_net: _NetSample | None = None
        self._gpu_available = False
        self._pynvml = None
        self._nvml_handle = None
        self._nvml_name = None
        self._init_gpu()

    def _init_gpu(self) -> None:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", FutureWarning)
                import pynvml  # type: ignore

            pynvml.nvmlInit()
            self._pynvml = pynvml
            self._gpu_available = True
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self._nvml_handle = handle
            raw_name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(raw_name, bytes):
                self._nvml_name = raw_name.decode("utf-8", errors="replace")
            else:
                self._nvml_name = str(raw_name)
            log.info("monitor.gpu.initialized", gpu_name=self._nvml_name)
        except Exception:
            self._gpu_available = False
            self._pynvml = None
            self._nvml_handle = None
            self._nvml_name = None
            log.info("monitor.gpu.unavailable")

    async def run(self) -> None:
        log.info("monitor.started", interval=self.interval)
        while True:
            try:
                metrics = await asyncio.to_thread(self._collect_all)
                await self.hub.broadcast(BroadcastMessage(event="system:metrics", payload=metrics))
                await asyncio.sleep(self.interval)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("monitor.loop.error", error=str(exc))
                await asyncio.sleep(self.interval)

    def _collect_all(self) -> dict[str, Any]:
        cpu = self._collect_cpu_ram()
        gpu = self._collect_gpu()
        net = self._collect_network_delta()
        battery = self._collect_battery()
        disk = psutil.disk_usage(os.getcwd())

        payload = {
            **cpu,
            **gpu,
            **net,
            **battery,
            "disk_percent": round(float(disk.percent), 1),
        }
        return payload

    def _collect_cpu_ram(self) -> dict[str, Any]:
        vm = psutil.virtual_memory()
        return {
            "cpu_percent": round(float(psutil.cpu_percent(interval=None)), 1),
            "ram_percent": round(float(vm.percent), 1),
            "ram_used_gb": round(float(vm.used) / (1024**3), 2),
            "ram_total_gb": round(float(vm.total) / (1024**3), 2),
        }

    def _collect_gpu(self) -> dict[str, Any]:
        if not self._gpu_available or self._pynvml is None or self._nvml_handle is None:
            return {"gpu_percent": None, "gpu_temp_c": None, "gpu_name": None}

        try:
            util = self._pynvml.nvmlDeviceGetUtilizationRates(self._nvml_handle)
            temp = self._pynvml.nvmlDeviceGetTemperature(self._nvml_handle, self._pynvml.NVML_TEMPERATURE_GPU)
            return {
                "gpu_percent": int(util.gpu),
                "gpu_temp_c": int(temp),
                "gpu_name": self._nvml_name,
            }
        except Exception:
            return {"gpu_percent": None, "gpu_temp_c": None, "gpu_name": self._nvml_name}

    def _collect_network_delta(self) -> dict[str, Any]:
        counters = psutil.net_io_counters()
        now = time.monotonic()
        current = _NetSample(sent=float(counters.bytes_sent), recv=float(counters.bytes_recv), timestamp=now)

        if self._prev_net is None:
            self._prev_net = current
            return {"net_sent_kbps": 0.0, "net_recv_kbps": 0.0}

        elapsed = max(current.timestamp - self._prev_net.timestamp, 0.001)
        sent_kbps = (current.sent - self._prev_net.sent) / 1024.0 / elapsed
        recv_kbps = (current.recv - self._prev_net.recv) / 1024.0 / elapsed
        self._prev_net = current
        return {
            "net_sent_kbps": round(max(sent_kbps, 0.0), 1),
            "net_recv_kbps": round(max(recv_kbps, 0.0), 1),
        }

    def _collect_battery(self) -> dict[str, Any]:
        battery = psutil.sensors_battery()
        if battery is None:
            return {"battery_percent": None, "battery_charging": None}
        return {
            "battery_percent": round(float(battery.percent), 1),
            "battery_charging": bool(battery.power_plugged),
        }
