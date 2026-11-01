"""Тесты без обращения к внешним API: фейковые эмбеддинги и LLM из langchain_core."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import DeterministicFakeEmbedding
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app import ingest, main
from app.chain import RagAssistant, detect_language, format_context
from app.config import settings
from app.loaders import load_cv, load_markdown_posts, load_profile, load_publications, load_reviews, load_site_sections, load_talks

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
    # ассистент кешируется в app.state — каждый тест начинает с чистого состояния
    monkeypatch.delattr(main.app.state, "assistant", raising=False)


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
    about = [d for d in sections if "LLM" in d.page_content and "OCR" in d.page_content]
    assert {d.metadata["lang"] for d in about} >= {"en", "ru"}
    # отдельный блок, а не хвост большого чанка со списком навыков
    assert all(len(d.page_content) < 1200 for d in about)


async def test_profile_is_always_in_context(test_settings, fake_providers):
    store = ingest.build_index(test_settings)
    profile = load_profile(settings.site_html, settings.site_url)
    assert all("oleg.tinkov.chem@mail.ru" in d.page_content for d in profile)
    assert all("42" in d.page_content for d in profile)
    assistant = RagAssistant(store, FakeListChatModel(responses=["Email [1]"]), test_settings, pinned_docs=profile)
    events = [e async for e in assistant.astream("Как связаться с Олегом?")]
    sources = events[0]["sources"]
    # обе языковые версии справки — один источник, и он первый
    assert sources[0]["title"] == profile[0].metadata["title"]
    assert sum(s["title"] == profile[1].metadata["title"] for s in sources) == 0


def test_publications_become_separate_sources():
    docs = load_publications(settings.publications_json)
    assert len(docs) == len({d.metadata["doc_id"] for d in docs}) > 10
    krasava = next(d for d in docs if "KRASAVA" in d.page_content)
    assert krasava.metadata["url"] == "https://doi.org/10.3390/ijms27010120"
    assert "Tinkov O.V." in krasava.page_content
    textbook = next(d for d in docs if "Общая токсикологическая химия" in d.page_content)
    assert textbook.metadata["url"] == "" and "соавторы: Люленова В.В." in textbook.page_content


def test_reviews_summary():
    [doc] = load_reviews(settings.reviews_json, settings.site_url)
    assert "48" in doc.page_content and "Scientific Reports: 5" in doc.page_content


def test_talks_summary():
    docs = load_talks(settings.talks_json, settings.site_url)
    text = "\n".join(d.page_content for d in docs)
    assert len(docs) > 5 and "Курск" in text and "ToxAI".lower() in text.lower()


def test_embeddings_retry_on_rate_limit(test_settings):
    from langchain_core.vectorstores import InMemoryVectorStore

    from langchain_core.embeddings import Embeddings

    class FlakyEmbeddings(Embeddings):
        """Второй вызов отвечает как API при превышении лимита."""

        def __init__(self):
            self.inner = DeterministicFakeEmbedding(size=8)
            self.calls = 0

        def embed_documents(self, texts):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("429 RESOURCE_EXHAUSTED. Please retry in 5.4s.")
            return self.inner.embed_documents(texts)

        def embed_query(self, text):
            return self.inner.embed_query(text)

    docs = load_markdown_posts(test_settings.blog_dir) * 5
    store = InMemoryVectorStore(FlakyEmbeddings())
    pauses = []
    ingest.add_in_batches(store, ingest.split_documents(docs, test_settings), replace(test_settings, embed_batch_size=3), sleep=pauses.append)
    assert pauses == [15.0] and len(store.store) == len(ingest.split_documents(docs, test_settings))


def test_api_without_lifespan(test_settings, fake_providers, monkeypatch):
    """На Vercel lifespan может не вызываться — ассистент создаётся при первом запросе."""
    monkeypatch.setattr(main, "settings", test_settings)
    monkeypatch.setattr(main, "limiter", main.RateLimiter(0))
    ingest.build_index(test_settings)
    client = TestClient(main.app)  # без with — lifespan не запускается
    resp = client.post("/api/chat", json={"question": "Что за RAG?"})
    assert resp.status_code == 200 and resp.json()["answer"]


def test_detect_language():
    assert detect_language("How long does he work in bank?") == "en"
    assert detect_language("Сколько лет Олегу?") == "ru"
    assert detect_language("Какой опыт с RAG и LLM?") == "ru"  # кириллицы больше
    assert detect_language("RAG?") == "en"
    assert detect_language("2025?", fallback="ru") == "ru"  # по тексту не понять — язык интерфейса


async def test_answer_language_follows_question(test_settings, fake_providers):
    from langchain_core.messages import AIMessage
    from langchain_core.runnables import RunnableLambda

    store = ingest.build_index(test_settings)
    prompts = []

    def llm(prompt_value):
        prompts.append(prompt_value.to_messages())
        return AIMessage("ok")

    assistant = RagAssistant(store, RunnableLambda(llm), test_settings)
    # английский вопрос при русском интерфейсе — ответ всё равно по-английски
    await assistant.ainvoke("How long does he work in bank?", lang="ru")
    system, human = prompts[-1][0].content, prompts[-1][-1].content
    assert "Write the ENTIRE answer in English" in system and "(Answer in English.)" in human

    await assistant.ainvoke("Где работает Олег?", lang="en")
    assert "Пиши ВЕСЬ ответ на русском" in prompts[-1][0].content


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
