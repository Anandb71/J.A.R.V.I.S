"""RAG-enhanced memory with sliding window + ChromaDB retrieval."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
import sqlite3
from typing import Any
import uuid

import chromadb
from sentence_transformers import SentenceTransformer


class RAGMemory:
    SLIDING_WINDOW_SIZE = 10
    RETRIEVAL_TOP_K = 3
    DB_PATH = Path(".jarvis/memory/conversations.db")
    CHROMA_PATH = Path(".jarvis/memory/chroma")

    def __init__(self, embedding_model: SentenceTransformer, session_id: str | None = None) -> None:
        self.session_id = session_id or uuid.uuid4().hex
        self._model = embedding_model
        self._sliding_window: list[dict[str, str]] = []
        self._lock = asyncio.Lock()
        self._chroma_semaphore = asyncio.Semaphore(1)

        self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.CHROMA_PATH.mkdir(parents=True, exist_ok=True)
        self._init_sqlite()

        self._chroma = chromadb.PersistentClient(path=str(self.CHROMA_PATH))
        self._collection = self._chroma.get_or_create_collection(
            name="jarvis_conversations",
            metadata={"hnsw:space": "cosine"},
        )

        self._load_recent_window()

    async def add_message(self, role: str, content: str) -> None:
        content = content.strip()
        if not content:
            return

        async with self._lock:
            self._sliding_window.append({"role": role, "content": content})
            if len(self._sliding_window) > self.SLIDING_WINDOW_SIZE:
                self._sliding_window = self._sliding_window[-self.SLIDING_WINDOW_SIZE :]

        await asyncio.to_thread(self._save_sqlite_message, role, content)
        asyncio.create_task(self._embed_and_store(role, content))

    async def build_context(self, user_message: str, system_prompt: dict[str, str]) -> list[dict[str, str]]:
        retrieved = await self.get_relevant_context(user_message)

        async with self._lock:
            window_copy = list(self._sliding_window)

        messages: list[dict[str, str]] = [system_prompt]
        if retrieved:
            messages.append(
                {
                    "role": "system",
                    "content": "Relevant previous context:\n" + self._format_retrieved(retrieved),
                }
            )

        messages.extend(window_copy)
        messages.append({"role": "user", "content": user_message})
        return messages

    async def get_relevant_context(self, query: str) -> list[dict[str, str]]:
        if not query.strip():
            return []

        query_embedding = await asyncio.to_thread(self._model.encode, query)
        query_vector = query_embedding.tolist()

        results = await asyncio.to_thread(
            self._collection.query,
            query_embeddings=[query_vector],
            n_results=self.RETRIEVAL_TOP_K,
            where={"session_id": self.session_id},
        )

        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]

        async with self._lock:
            window_contents = {m["content"] for m in self._sliding_window}

        deduped: list[dict[str, str]] = []
        for document, metadata in zip(documents, metadatas):
            if not document or document in window_contents:
                continue
            role = (metadata or {}).get("role", "assistant")
            deduped.append({"role": role, "content": document})

        return deduped

    async def get_messages(self) -> list[dict[str, str]]:
        async with self._lock:
            return list(self._sliding_window)

    async def get_context_for_brain(self) -> list[dict[str, str]]:
        return await self.get_messages()

    async def clear_session(self) -> None:
        async with self._lock:
            self._sliding_window.clear()

        await asyncio.to_thread(self._delete_sqlite_session)
        await asyncio.to_thread(self._collection.delete, where={"session_id": self.session_id})

    async def get_stats(self) -> dict[str, Any]:
        async with self._lock:
            window_size = len(self._sliding_window)
        return {
            "session_id": self.session_id,
            "window_size": window_size,
            "window_limit": self.SLIDING_WINDOW_SIZE,
            "retrieval_top_k": self.RETRIEVAL_TOP_K,
            "rag_enabled": True,
        }

    async def _embed_and_store(self, role: str, content: str) -> None:
        async with self._chroma_semaphore:
            try:
                embedding = await asyncio.to_thread(self._model.encode, content)
                await asyncio.to_thread(
                    self._collection.add,
                    ids=[f"{self.session_id}_{uuid.uuid4().hex[:8]}"],
                    embeddings=[embedding.tolist()],
                    documents=[content],
                    metadatas=[
                        {
                            "role": role,
                            "session_id": self.session_id,
                            "created_at": datetime.utcnow().isoformat(),
                        }
                    ],
                )
            except Exception:
                # Non-blocking background storage path: ignore failures.
                return

    def _format_retrieved(self, retrieved: list[dict[str, str]]) -> str:
        lines = []
        for item in retrieved:
            role = item.get("role", "assistant")
            content = item.get("content", "")
            lines.append(f"- [{role}] {content}")
        return "\n".join(lines)

    def _init_sqlite(self) -> None:
        conn = sqlite3.connect(self.DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)")
        conn.commit()
        conn.close()

    def _save_sqlite_message(self, role: str, content: str) -> None:
        conn = sqlite3.connect(self.DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (self.session_id, role, content, datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()

    def _load_recent_window(self) -> None:
        conn = sqlite3.connect(self.DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT role, content
            FROM messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (self.session_id, self.SLIDING_WINDOW_SIZE),
        )
        rows = cursor.fetchall()
        conn.close()

        self._sliding_window = [
            {"role": row["role"], "content": row["content"]}
            for row in reversed(rows)
        ]

    def _delete_sqlite_session(self) -> None:
        conn = sqlite3.connect(self.DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages WHERE session_id = ?", (self.session_id,))
        conn.commit()
        conn.close()
