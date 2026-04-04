from __future__ import annotations

import logging


def configure_logging(dev_mode: bool = True) -> None:
    """Configure structured logging if structlog is available, otherwise fall back to stdlib."""
    if dev_mode:
        level = logging.DEBUG
    else:
        level = logging.INFO

    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    try:
        import structlog  # type: ignore

        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                structlog.processors.add_log_level,
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.StackInfoRenderer(),
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(level),
            cache_logger_on_first_use=True,
        )
    except Exception:
        pass


def get_logger(name: str):
    """Return a structlog logger when available, else stdlib logger."""
    try:
        import structlog  # type: ignore

        return structlog.get_logger(name)
    except Exception:
        return logging.getLogger(name)
