"""Индексация: загрузка источников → нарезка на чанки → эмбеддинги → векторное хранилище на диске.

Запуск:  python -m app.ingest            (из папки rag/)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter

from .config import Settings, settings
from .loaders import load_all
from .providers import get_embeddings

log = logging.getLogger(__name__)


def split_documents(docs: list[Document], s: Settings) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=s.chunk_size,
        chunk_overlap=s.chunk_overlap,
        separators=["\n## ", "\n### ", "\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    for i, chunk in enumerate(chunks):
        # Заголовок в каждом чанке улучшает поиск по фрагментам из середины статьи
        title = chunk.metadata.get("title", "")
        if title and not chunk.page_content.startswith(title):
            chunk.page_content = f"{title}\n\n{chunk.page_content}"
        chunk.id = f"{chunk.metadata.get('source_type')}-{i}"
    return chunks


def _is_rate_limit(exc: Exception) -> bool:
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "rate limit" in text.lower()


def _retry_delay(exc: Exception, attempt: int) -> float:
    """Пауза перед повтором: подсказка API («retry in 5.4s») или растущая пауза, но не меньше 15 с."""
    hint = re.search(r"retry in ([\d.]+)s", str(exc), flags=re.I)
    suggested = float(hint.group(1)) if hint else 0.0
    return max(suggested + 1, 15.0 * (attempt + 1))


def add_in_batches(store: InMemoryVectorStore, chunks: list[Document], s: Settings, sleep=time.sleep) -> None:
    """Добавляет фрагменты в индекс порциями, переживая лимиты частоты запросов (HTTP 429)."""
    size = max(1, s.embed_batch_size)
    for start in range(0, len(chunks), size):
        batch = chunks[start : start + size]
        for attempt in range(s.embed_max_retries + 1):
            try:
                store.add_documents(batch)
                break
            except Exception as exc:
                if not _is_rate_limit(exc) or attempt == s.embed_max_retries:
                    raise
                delay = _retry_delay(exc, attempt)
                log.warning("Лимит запросов к API эмбеддингов, ждём %.0f с и повторяем…", delay)
                sleep(delay)
        log.info("Проиндексировано %d из %d фрагментов", min(start + size, len(chunks)), len(chunks))


def meta_path(s: Settings):
    return s.index_path.with_suffix(".meta.json")


def build_index(s: Settings = settings) -> InMemoryVectorStore:
    docs = load_all(s)
    if not docs:
        raise SystemExit(
            f"Нет данных для индексации: добавьте посты в {s.blog_dir} или задайте BLOG_FEED_URLS/BLOG_PAGE_URLS"
        )
    chunks = split_documents(docs, s)
    log.info("Документов: %d, чанков: %d", len(docs), len(chunks))

    store = InMemoryVectorStore(get_embeddings(s))
    add_in_batches(store, chunks, s)

    s.index_path.parent.mkdir(parents=True, exist_ok=True)
    store.dump(str(s.index_path))
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "embeddings_provider": s.embeddings_provider,
        "embeddings_model": s.embeddings_model,
        "embeddings_dim": s.embeddings_dim,
        "documents": len(docs),
        "chunks": len(chunks),
        "by_type": {
            t: sum(1 for d in docs if d.metadata["source_type"] == t) for t in ("blog", "site", "cv", "publication")
        },
    }
    meta_path(s).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Индекс сохранён: %s", s.index_path)
    return store


def load_index(s: Settings = settings) -> InMemoryVectorStore:
    """Загружает индекс с диска; если его нет — строит заново."""
    if not s.index_path.is_file():
        if os.getenv("VERCEL"):
            # файловая система serverless-функции только для чтения — индекс должен быть в репозитории
            raise RuntimeError(f"Нет индекса {s.index_path}: выполните python -m app.ingest и закоммитьте rag/data/index")
        log.info("Индекс не найден, строим: %s", s.index_path)
        return build_index(s)

    mp = meta_path(s)
    if mp.is_file():
        meta = json.loads(mp.read_text(encoding="utf-8"))
        if (meta.get("embeddings_provider"), meta.get("embeddings_model")) != (
            s.embeddings_provider,
            s.embeddings_model,
        ):
            log.warning(
                "Индекс построен моделью %s/%s, а сейчас настроена %s/%s — переиндексируйте (python -m app.ingest)",
                meta.get("embeddings_provider"),
                meta.get("embeddings_model"),
                s.embeddings_provider,
                s.embeddings_model,
            )
    return InMemoryVectorStore.load(str(s.index_path), get_embeddings(s))


def main() -> None:
    parser = argparse.ArgumentParser(description="Построить векторный индекс по блогу и сайту")
    parser.add_argument("--dry-run", action="store_true", help="только загрузить и нарезать, без эмбеддингов")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.dry_run:
        docs = load_all(settings)
        chunks = split_documents(docs, settings)
        for d in docs:
            m = d.metadata
            print(f"[{m['source_type']:4}] {m['title'][:70]:70} {len(d.page_content):6} симв. {m['url']}")
        print(f"\nИтого: документов {len(docs)}, чанков {len(chunks)}")
        return

    build_index(settings)


if __name__ == "__main__":
    main()
