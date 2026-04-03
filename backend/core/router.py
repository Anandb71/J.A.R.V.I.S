"""Semantic router for JARVIS using sentence embeddings."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer


class RoutingTier(Enum):
    LOCAL = "local"
    CLOUD = "cloud"


@dataclass
class SemanticRouterDecision:
    tier: RoutingTier
    intent: str
    confidence: float
    reason: str
    fallback_to_local: bool = True


class SemanticRouter:
    CLOUD_THRESHOLD = 0.45

    LOCAL_INTENTS: dict[str, list[str]] = {
        "simple_question": [
            "what time is it",
            "what is the weather today",
            "who invented the lightbulb",
            "explain this in simple words",
            "tell me a short summary",
        ],
        "quick_command": [
            "open chrome",
            "launch vscode",
            "set volume to 50 percent",
            "set a reminder for 10 minutes",
        ],
        "system_operation": [
            "what is my cpu usage",
            "check ram usage",
            "show my system info",
            "what apps are running",
        ],
        "creative_simple": [
            "write a haiku",
            "tell me a joke",
            "rewrite this politely",
            "make this paragraph friendly",
        ],
        "greeting": [
            "hello jarvis",
            "good morning",
            "hey",
            "are you online",
        ],
    }

    CLOUD_INTENTS: dict[str, list[str]] = {
        "deep_reasoning": [
            "analyze this memory dump for root cause",
            "reason about tradeoffs in distributed architecture",
            "diagnose this complex production issue",
            "build a step by step investigation plan",
        ],
        "complex_coding": [
            "write a balanced binary search tree implementation",
            "design a concurrent task scheduler in python",
            "refactor this codebase architecture",
            "optimize this algorithm with complexity analysis",
        ],
        "technical_analysis": [
            "compare kubernetes vs docker swarm for our use case",
            "evaluate system design bottlenecks",
            "analyze this compiler error chain deeply",
            "assess security implications of this architecture",
        ],
        "multi_step_planning": [
            "plan a migration from mongodb to postgres",
            "create a phased rollout plan with risks",
            "break down this project into milestones",
            "produce implementation strategy with validation checkpoints",
        ],
    }

    def __init__(self, model: SentenceTransformer | None = None, privacy_mode: bool = True) -> None:
        self.model = model or SentenceTransformer("all-MiniLM-L6-v2")
        self.privacy_mode = privacy_mode
        self._local_centroids = self._compute_centroids(self.LOCAL_INTENTS)
        self._cloud_centroids = self._compute_centroids(self.CLOUD_INTENTS)

    def _compute_centroids(self, intents: dict[str, list[str]]) -> dict[str, np.ndarray]:
        centroids: dict[str, np.ndarray] = {}
        for intent_name, utterances in intents.items():
            embeddings = self.model.encode(utterances)
            centroids[intent_name] = np.mean(np.asarray(embeddings), axis=0)
        return centroids

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        a_norm = np.linalg.norm(a)
        b_norm = np.linalg.norm(b)
        if a_norm == 0.0 or b_norm == 0.0:
            return 0.0
        return float(np.dot(a, b) / (a_norm * b_norm))

    async def route(self, message: str, prefer_cloud: bool = False) -> SemanticRouterDecision:
        query_vec = await asyncio.to_thread(self.model.encode, message)
        query_arr = np.asarray(query_vec)

        local_scores = {
            intent: self._cosine_similarity(query_arr, centroid)
            for intent, centroid in self._local_centroids.items()
        }
        cloud_scores = {
            intent: self._cosine_similarity(query_arr, centroid)
            for intent, centroid in self._cloud_centroids.items()
        }

        best_local_intent, best_local_score = max(local_scores.items(), key=lambda item: item[1])
        best_cloud_intent, best_cloud_score = max(cloud_scores.items(), key=lambda item: item[1])

        if prefer_cloud and not self.privacy_mode:
            return SemanticRouterDecision(
                tier=RoutingTier.CLOUD,
                intent=best_cloud_intent,
                confidence=max(best_cloud_score, self.CLOUD_THRESHOLD),
                reason="cloud_preferred_by_user",
            )

        if not self.privacy_mode and best_cloud_score >= self.CLOUD_THRESHOLD and best_cloud_score > best_local_score:
            return SemanticRouterDecision(
                tier=RoutingTier.CLOUD,
                intent=best_cloud_intent,
                confidence=best_cloud_score,
                reason=(
                    f"semantic_router: cloud intent '{best_cloud_intent}'"
                    f" scored {best_cloud_score:.3f} (local best {best_local_score:.3f})"
                ),
            )

        return SemanticRouterDecision(
            tier=RoutingTier.LOCAL,
            intent=best_local_intent,
            confidence=best_local_score,
            reason=(
                f"semantic_router: local intent '{best_local_intent}'"
                f" scored {best_local_score:.3f}; privacy_mode={self.privacy_mode}"
            ),
        )

    def get_router_stats(self) -> dict[str, Any]:
        return {
            "router": "semantic",
            "model": "all-MiniLM-L6-v2",
            "privacy_mode": self.privacy_mode,
            "cloud_threshold": self.CLOUD_THRESHOLD,
            "local_intents": list(self.LOCAL_INTENTS.keys()),
            "cloud_intents": list(self.CLOUD_INTENTS.keys()),
        }
