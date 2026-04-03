from __future__ import annotations

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(default="user")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(
        default_factory=list,
        description="Deprecated: History is now automatically managed by ConversationMemory"
    )
    prefer_cloud: bool = False


class ChatResponse(BaseModel):
    reply: str
    provider_used: str
    latency_ms: int
    fallback_used: bool
