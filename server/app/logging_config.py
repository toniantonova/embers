# ─────────────────────────────────────────────────────────────────────────────
# Logging Configuration — structlog for Cloud Logging
# ─────────────────────────────────────────────────────────────────────────────


import logging
import sys

import structlog


def configure_logging(log_level: str = "INFO", json_output: bool = True) -> None:
    """Configure structlog for structured JSON logging.

    JSON output is Cloud Logging compatible — each log line is a parseable
    JSON object with timestamp, level, logger name, and structured fields.
    Console output is used for local development (human-readable).

    Note: structlog >=25.4 is required for Python 3.13.4+ compatibility
    (fixes a backwards-incompatible change in logging.Logger.isEnabledFor).
    """
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    renderer: structlog.types.Processor = (
        structlog.processors.JSONRenderer() if json_output else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
    )

    # ProcessorFormatter receives pre-processed events from structlog.
    # Only remove_processors_meta + renderer here — shared_processors already
    # ran in structlog.configure(). Adding them again would double-process
    # (e.g., duplicate timestamps, double log-level tags).
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, log_level.upper()))
