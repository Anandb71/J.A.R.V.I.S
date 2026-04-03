from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable


SENSITIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"password|passcode|pin|otp|2fa|verification code", re.IGNORECASE),
    re.compile(r"secret|token|api key|access key|private key|credential", re.IGNORECASE),
    re.compile(r"login|sign in|authenticate|auth", re.IGNORECASE),
    re.compile(r"bank|wallet|credit card|card number|cvv|ssn|social security", re.IGNORECASE),
)


@dataclass(frozen=True)
class PrivacyFinding:
    label: str
    reason: str


class PrivacyFilter:
    """Redacts sensitive UI content when privacy mode is enabled."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled

    def is_sensitive(self, *values: str | None) -> tuple[bool, str | None]:
        if not self.enabled:
            return False, None

        for value in values:
            if not value:
                continue
            for pattern in SENSITIVE_PATTERNS:
                if pattern.search(value):
                    return True, pattern.pattern
        return False, None

    def redact(self, value: str | None) -> str:
        if not self.enabled or not value:
            return value or ""

        sensitive, _ = self.is_sensitive(value)
        if sensitive:
            return "[REDACTED]"
        return value

    def redact_many(self, values: Iterable[str | None]) -> list[str]:
        return [self.redact(value) for value in values]

    def mask_control_payload(self, payload: dict[str, object]) -> dict[str, object]:
        if not self.enabled:
            return payload

        masked = dict(payload)
        for key in ("name", "automation_id", "class_name", "window_title"):
            value = masked.get(key)
            if isinstance(value, str):
                masked[key] = self.redact(value)

        if isinstance(masked.get("children"), list):
            masked["children"] = [self.mask_control_payload(child) for child in masked["children"] if isinstance(child, dict)]
        return masked
