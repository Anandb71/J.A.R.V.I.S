"""Structured response schemas for constrained local decoding."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class JarvisResponse(BaseModel):
    action: Literal["tool_call", "direct_response"]
    tool_name: str | None = None
    arguments: dict = Field(default_factory=dict)
    reasoning: str | None = None
    response: str | None = None

    @model_validator(mode="after")
    def validate_fields(self) -> "JarvisResponse":
        if self.action == "tool_call" and not self.tool_name:
            raise ValueError("tool_name is required when action=tool_call")
        if self.action == "direct_response" and not self.response:
            raise ValueError("response is required when action=direct_response")
        return self
