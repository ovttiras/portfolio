"""HTTP API RAG-ассистента.

POST /api/chat         — ответ целиком (JSON)
POST /api/chat/stream  — потоковый ответ (Server-Sent Events)
GET  /api/health       — статус и информация об индексе

Запуск:  uvicorn app.main:app --reload --port 8000   (из папки rag/)
"""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .chain import RagAssistant
from .config import settings
from .ingest import load_index, meta_path
from .loaders import load_profile
from .providers import get_llm

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("rag")


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)


class RateLimiter:
    """Простое ограничение частоты запросов по IP (скользящее окно в 60 с)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        if self.per_minute <= 0:
            return
        now = time.monotonic()
        window = self.hits[key]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= self.per_minute:
            raise HTTPException(429, "Слишком много запросов, попробуйте через минуту")
        window.append(now)


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = load_index(settings)
    profile = load_profile(settings.site_html, settings.site_url)
    app.state.assistant = RagAssistant(store, get_llm(settings), settings, pinned_docs=profile)
    log.info("RAG-ассистент готов: LLM=%s/%s", settings.llm_provider, settings.llm_model)
    yield


app = FastAPI(title="Portfolio RAG assistant", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
limiter = RateLimiter(settings.rate_limit_per_minute)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _validate(request: Request, body: ChatRequest) -> tuple[str, list[dict]]:
    limiter.check(_client_ip(request))
    question = body.question.strip()
    if not question:
        raise HTTPException(422, "Пустой вопрос")
    if len(question) > settings.max_question_chars:
        raise HTTPException(422, f"Вопрос длиннее {settings.max_question_chars} символов")
    return question, [turn.model_dump() for turn in body.history]


@app.get("/api/health")
async def health():
    mp = meta_path(settings)
    index = json.loads(mp.read_text(encoding="utf-8")) if mp.is_file() else None
    return {
        "status": "ok",
        "llm": f"{settings.llm_provider}/{settings.llm_model}",
        "embeddings": f"{settings.embeddings_provider}/{settings.embeddings_model}",
        "index": index,
    }


@app.post("/api/chat")
async def chat(request: Request, body: ChatRequest):
    question, history = _validate(request, body)
    try:
        return await request.app.state.assistant.ainvoke(question, history)
    except Exception:
        log.exception("Ошибка генерации ответа")
        raise HTTPException(502, "Модель временно недоступна, попробуйте позже")


@app.post("/api/chat/stream")
async def chat_stream(request: Request, body: ChatRequest):
    question, history = _validate(request, body)
    assistant: RagAssistant = request.app.state.assistant

    async def events():
        try:
            async for event in assistant.astream(question, history):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception:
            log.exception("Ошибка генерации ответа")
            error = {"type": "error", "message": "Модель временно недоступна, попробуйте позже"}
            yield f"data: {json.dumps(error, ensure_ascii=False)}\n\n"
        yield 'data: {"type": "done"}\n\n'

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
