"""Тесты без обращения к внешним API: фейковые эмбеддинги и LLM из langchain_core."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import DeterministicFakeEmbedding
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app import ingest, main
from app.chain import RagAssistant, format_context
from app.config import settings
from app.loaders import load_cv, load_markdown_posts, load_profile, load_site_sections

POST = """---
title: Как я построил RAG для банка
date: 2026-03-01
url: https://example.com/rag-bank
tags: [RAG, LLM]
---
## Задача
Чат-бот по корпоративной базе знаний в закрытом контуре.

## Решение
Локальная LLM, векторный поиск и переранжирование.
"""


@pytest.fixture
def test_settings(tmp_path):
    blog = tmp_path / "blog"
    blog.mkdir()
    (blog / "2026-03-01-rag-bank.md").write_text(POST, encoding="utf-8")
    (blog / "_template.md").write_text("---\ntitle: шаблон\n---\nне индексировать", encoding="utf-8")
    return replace(
        settings,
        blog_dir=blog,
        blog_feed_urls=[],
        blog_page_urls=[],
        index_path=tmp_path / "index" / "vectorstore.json",
        rate_limit_per_minute=3,
    )


@pytest.fixture
def fake_providers(monkeypatch):
    monkeypatch.setattr(ingest, "get_embeddings", lambda s: DeterministicFakeEmbedding(size=64))
    llm = FakeListChatModel(responses=["Олег строил RAG-бота для банка [1]."])
    monkeypatch.setattr(main, "get_llm", lambda s: llm)


def test_markdown_posts(test_settings):
    docs = load_markdown_posts(test_settings.blog_dir)
    assert len(docs) == 1
    meta = docs[0].metadata
    assert meta["title"] == "Как я построил RAG для банка"
    assert meta["date"] == "2026-03-01"
    assert meta["url"] == "https://example.com/rag-bank"
    assert meta["tags"] == "RAG, LLM"


def test_site_and_cv():
    sections = load_site_sections(settings.site_html, settings.site_url)
    ids = {d.metadata["url"].rsplit("#", 1)[1] for d in sections}
    assert {"home", "about", "portfolio", "contact"} <= ids
    assert any("Agroprombank" in d.page_content for d in sections)
    assert any("Агропромбанк" in d.page_content for d in sections)
    assert load_cv(settings.cv_pdf, settings.site_url)[0].page_content


def test_about_text_gets_its_own_block_in_both_languages():
    sections = load_site_sections(settings.site_html, settings.site_url)
    about = [d for d in sections if "Agroprombank" in d.page_content or "Агропромбанке" in d.page_content]
    about = [d for d in about if "LLM" in d.page_content and "OCR" in d.page_content]
    assert {d.metadata["lang"] for d in about} >= {"en", "ru"}
    # отдельный блок, а не хвост большого чанка со списком навыков
    assert all(len(d.page_content) < 1200 for d in about)


async def test_profile_is_always_in_context(test_settings, fake_providers):
    store = ingest.build_index(test_settings)
    profile = load_profile(settings.site_html, settings.site_url)
    assert all("oleg.tinkov.chem@mail.ru" in d.page_content for d in profile)
    assistant = RagAssistant(store, FakeListChatModel(responses=["Email [1]"]), test_settings, pinned_docs=profile)
    events = [e async for e in assistant.astream("Как связаться с Олегом?")]
    sources = events[0]["sources"]
    # обе языковые версии справки — один источник, и он первый
    assert sources[0]["title"] == profile[0].metadata["title"]
    assert sum(s["title"] == profile[1].metadata["title"] for s in sources) == 0


def test_build_and_reload_index(test_settings, fake_providers):
    ingest.build_index(test_settings)
    meta = json.loads(ingest.meta_path(test_settings).read_text(encoding="utf-8"))
    assert meta["by_type"]["blog"] == 1 and meta["chunks"] > 3
    store = ingest.load_index(test_settings)
    assert store.similarity_search("RAG", k=2)


def test_format_context_groups_chunks_by_document(test_settings):
    docs = load_markdown_posts(test_settings.blog_dir) * 2
    context, sources = format_context(docs)
    assert len(sources) == 1 and context.count("[1]") == 2


async def test_chain_with_history(test_settings, fake_providers):
    store = ingest.build_index(test_settings)
    llm = FakeListChatModel(responses=["Что Олег делал в банке?", "Строил RAG [1]."])
    assistant = RagAssistant(store, llm, test_settings)
    result = await assistant.ainvoke(
        "А что там?", [{"role": "user", "content": "Расскажи про банк"}, {"role": "assistant", "content": "…"}]
    )
    assert result["answer"] == "Строил RAG [1]."
    assert result["sources"] and result["sources"][0]["n"] == 1


def test_api(test_settings, fake_providers, monkeypatch):
    monkeypatch.setattr(main, "settings", test_settings)
    monkeypatch.setattr(main, "limiter", main.RateLimiter(test_settings.rate_limit_per_minute))
    with TestClient(main.app) as client:
        assert client.get("/api/health").json()["index"]["by_type"]["blog"] == 1

        resp = client.post("/api/chat/stream", json={"question": "Что за RAG?"})
        events = [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]
        assert [e["type"] for e in events][0] == "sources"
        assert events[-1]["type"] == "done"
        assert "".join(e.get("content", "") for e in events if e["type"] == "token").startswith("Олег")

        assert client.post("/api/chat", json={"question": "   "}).status_code == 422
        assert client.post("/api/chat", json={"question": "x"}).status_code == 200
        # лимит 3 запроса в минуту исчерпан
        assert client.post("/api/chat", json={"question": "x"}).status_code == 429
