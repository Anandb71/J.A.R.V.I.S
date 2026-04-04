from __future__ import annotations

import time
from collections import deque
from contextlib import asynccontextmanager, contextmanager
from statistics import quantiles

_windows: dict[str, deque[float]] = {}


@contextmanager
def latency(stage: str):
    """Measure latency (ms) for a synchronous block."""
    start = time.perf_counter()
    try:
        yield
    finally:
        ms = (time.perf_counter() - start) * 1000
        window = _windows.setdefault(stage, deque(maxlen=200))
        window.append(ms)


@asynccontextmanager
async def alatency(stage: str):
    """Measure latency (ms) for an async block."""
    start = time.perf_counter()
    try:
        yield
    finally:
        ms = (time.perf_counter() - start) * 1000
        window = _windows.setdefault(stage, deque(maxlen=200))
        window.append(ms)


def get_latency_stats(stage: str) -> dict[str, float]:
    """Return p50/p95/p99 latency stats for the stage."""
    values = list(_windows.get(stage, []))
    if not values:
        return {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0}

    sorted_values = sorted(values)
    p50 = sorted_values[len(sorted_values) // 2]

    if len(sorted_values) == 1:
        p95 = sorted_values[0]
        p99 = sorted_values[0]
    else:
        q = quantiles(sorted_values, n=100)
        p95 = q[94]
        p99 = q[98]

    return {
        "count": float(len(sorted_values)),
        "p50": round(p50, 2),
        "p95": round(p95, 2),
        "p99": round(p99, 2),
    }
