"""Настройки сервиса. Все значения читаются из переменных окружения (или файла .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

RAG_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = RAG_DIR.parent


def _load_dotenv(path: Path) -> None:
    """Минимальный разбор .env, чтобы не тянуть лишнюю зависимость."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(RAG_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in _env(name, default).split(",") if item.strip()]


def _env_path(name: str, default: Path) -> Path:
    value = _env(name)
    if not value:
        return default
    path = Path(value)
    return path if path.is_absolute() else (RAG_DIR / path).resolve()


@dataclass(frozen=True)
class Settings:
    # --- Провайдеры моделей -------------------------------------------------
    # google  — Gemini API через Google AI Studio (GOOGLE_API_KEY)
    # openai  — любой OpenAI-совместимый API: Groq, OpenRouter, Mistral, Ollama…
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "google"))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "gemini-3.1-flash-lite"))
    llm_temperature: float = field(default_factory=lambda: float(_env("LLM_TEMPERATURE", "0.3")))
    llm_max_tokens: int = field(default_factory=lambda: int(_env("LLM_MAX_TOKENS", "1024")))

    # google      — gemini-embedding-001 (AI Studio, мультиязычная, есть бесплатный лимит)
    # huggingface — локальная модель, например intfloat/multilingual-e5-small (без API)
    embeddings_provider: str = field(default_factory=lambda: _env("EMBEDDINGS_PROVIDER", "google"))
    embeddings_model: str = field(
        default_factory=lambda: _env("EMBEDDINGS_MODEL", "gemini-embedding-001")
    )
    embeddings_dim: int = field(default_factory=lambda: int(_env("EMBEDDINGS_DIM", "768")))

    google_api_key: str = field(
        default_factory=lambda: _env("GOOGLE_API_KEY") or _env("GEMINI_API_KEY")
    )
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    openai_base_url: str = field(default_factory=lambda: _env("OPENAI_BASE_URL"))

    # --- Источники знаний ---------------------------------------------------
    blog_dir: Path = field(default_factory=lambda: _env_path("BLOG_DIR", RAG_DIR / "data" / "blog"))
    # RSS/Atom-ленты блога (Medium, Habr, Telegra.ph, Substack, Jekyll feed.xml…)
    blog_feed_urls: list[str] = field(default_factory=lambda: _env_list("BLOG_FEED_URLS"))
    # Отдельные страницы, которые нужно проиндексировать
    blog_page_urls: list[str] = field(default_factory=lambda: _env_list("BLOG_PAGE_URLS"))
    # Страница сайта и резюме — чтобы ассистент знал опыт, навыки и проекты
    site_html: Path = field(default_factory=lambda: _env_path("SITE_HTML", REPO_ROOT / "index.html"))
    cv_pdf: Path = field(default_factory=lambda: _env_path("CV_PDF", REPO_ROOT / "doc" / "CV_Tinkov.pdf"))
    site_url: str = field(default_factory=lambda: _env("SITE_URL", "https://ovttiras.github.io/portfolio/"))

    # --- Индекс и поиск -----------------------------------------------------
    index_path: Path = field(
        default_factory=lambda: _env_path("INDEX_PATH", RAG_DIR / "data" / "index" / "vectorstore.json")
    )
    chunk_size: int = field(default_factory=lambda: int(_env("CHUNK_SIZE", "1000")))
    chunk_overlap: int = field(default_factory=lambda: int(_env("CHUNK_OVERLAP", "150")))
    retriever_k: int = field(default_factory=lambda: int(_env("RETRIEVER_K", "6")))
    retriever_fetch_k: int = field(default_factory=lambda: int(_env("RETRIEVER_FETCH_K", "25")))

    # --- HTTP API -----------------------------------------------------------
    allowed_origins: list[str] = field(
        default_factory=lambda: _env_list(
            "ALLOWED_ORIGINS",
            "https://ovttiras.github.io,http://localhost:8000,http://127.0.0.1:5500,http://localhost:5500",
        )
    )
    rate_limit_per_minute: int = field(default_factory=lambda: int(_env("RATE_LIMIT_PER_MINUTE", "10")))
    max_question_chars: int = field(default_factory=lambda: int(_env("MAX_QUESTION_CHARS", "1000")))
    max_history_turns: int = field(default_factory=lambda: int(_env("MAX_HISTORY_TURNS", "6")))


settings = Settings()
