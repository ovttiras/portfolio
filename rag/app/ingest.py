"""Индексация: загрузка источников → нарезка на чанки → эмбеддинги → векторное хранилище на диске.

Запуск:  python -m app.ingest            (из папки rag/)
"""

from __future__ import annotations

import argparse
import json
import logging
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
    store.add_documents(chunks)

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
            t: sum(1 for d in docs if d.metadata["source_type"] == t) for t in ("blog", "site", "cv")
        },
    }
    meta_path(s).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Индекс сохранён: %s", s.index_path)
    return store


def load_index(s: Settings = settings) -> InMemoryVectorStore:
    """Загружает индекс с диска; если его нет — строит заново."""
    if not s.index_path.is_file():
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
