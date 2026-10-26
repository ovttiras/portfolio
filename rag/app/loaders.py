"""Загрузка источников знаний: посты блога (Markdown, RSS, страницы), сайт-портфолио и резюме."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

import frontmatter
from bs4 import BeautifulSoup
from langchain_core.documents import Document

from .config import Settings

log = logging.getLogger(__name__)

BLOG_EXTENSIONS = {".md", ".markdown", ".txt", ".html"}
_JEKYLL_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)$")
_HTTP_HEADERS = {"User-Agent": "portfolio-rag-ingest/1.0"}


def html_to_text(html: str) -> str:
    """Превращает HTML статьи в чистый текст, сохраняя абзацы."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "iframe"]):
        tag.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup
    text = root.get_text("\n", strip=True)
    return re.sub(r"\n{3,}", "\n\n", text)


def _as_date(value) -> str:
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value)[:10]


# --------------------------------------------------------------------------- блог


def load_markdown_posts(blog_dir: Path) -> list[Document]:
    """Посты из папки: Markdown с YAML front matter (title, date, url, tags) или простой текст.

    Файлы, начинающиеся с «_» (шаблоны) и README, пропускаются.
    """
    if not blog_dir.is_dir():
        return []

    docs: list[Document] = []
    for path in sorted(blog_dir.rglob("*")):
        if (
            not path.is_file()
            or path.suffix.lower() not in BLOG_EXTENSIONS
            or path.name.startswith("_")
            or path.stem.upper() == "README"
        ):
            continue

        post = frontmatter.load(path)
        body = html_to_text(post.content) if path.suffix.lower() == ".html" else post.content
        if not body.strip():
            continue

        slug_match = _JEKYLL_NAME.match(path.stem)
        title = post.get("title") or (slug_match.group(2) if slug_match else path.stem).replace("-", " ")
        date = _as_date(post.get("date") or (slug_match.group(1) if slug_match else ""))
        tags = post.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",")]

        docs.append(
            Document(
                page_content=body.strip(),
                metadata={
                    "source_type": "blog",
                    "title": str(title),
                    "url": post.get("url") or post.get("link") or "",
                    "date": date,
                    "tags": ", ".join(map(str, tags)),
                    "source": str(path.relative_to(blog_dir)),
                },
            )
        )
    log.info("Markdown-посты: %d", len(docs))
    return docs


def fetch_page(url: str) -> Document | None:
    import httpx

    try:
        resp = httpx.get(url, headers=_HTTP_HEADERS, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Не удалось загрузить %s: %s", url, exc)
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    title = (soup.title.string or "").strip() if soup.title else url
    og_date = soup.find("meta", attrs={"property": "article:published_time"})
    text = html_to_text(resp.text)
    if not text:
        return None
    return Document(
        page_content=text,
        metadata={
            "source_type": "blog",
            "title": title,
            "url": url,
            "date": _as_date(og_date.get("content") if og_date else ""),
            "tags": "",
            "source": url,
        },
    )


def load_feed_posts(feed_urls: list[str]) -> list[Document]:
    """Посты из RSS/Atom. Если в ленте только анонс, подтягивается полная страница."""
    import feedparser

    docs: list[Document] = []
    for feed_url in feed_urls:
        feed = feedparser.parse(feed_url, request_headers=_HTTP_HEADERS)
        if feed.bozo and not feed.entries:
            log.warning("Лента %s не прочитана: %s", feed_url, feed.bozo_exception)
            continue
        for entry in feed.entries:
            html = entry.content[0].value if entry.get("content") else entry.get("summary", "")
            text = html_to_text(html)
            link = entry.get("link", "")
            if len(text) < 500 and link:
                page = fetch_page(link)
                if page and len(page.page_content) > len(text):
                    text = page.page_content
            if not text.strip():
                continue
            docs.append(
                Document(
                    page_content=text,
                    metadata={
                        "source_type": "blog",
                        "title": entry.get("title", link),
                        "url": link,
                        "date": _as_date(
                            datetime(*entry.published_parsed[:6]) if entry.get("published_parsed") else ""
                        ),
                        "tags": ", ".join(t.get("term", "") for t in entry.get("tags", [])),
                        "source": feed_url,
                    },
                )
            )
    log.info("Посты из RSS: %d", len(docs))
    return docs


def load_page_posts(urls: list[str]) -> list[Document]:
    docs = [doc for doc in (fetch_page(url) for url in urls) if doc]
    log.info("Отдельные страницы: %d", len(docs))
    return docs


# --------------------------------------------------------------------- портфолио


def load_site_sections(html_path: Path, site_url: str) -> list[Document]:
    """Разделы index.html (Главная, Обо мне, Сертификаты, Портфолио, Контакты) — по документу на раздел."""
    if not html_path.is_file():
        return []

    soup = BeautifulSoup(html_path.read_text(encoding="utf-8"), "html.parser")
    docs: list[Document] = []
    for section in soup.select("section.section[id]"):
        for tag in section(["script", "style", "iframe"]):
            tag.decompose()
        # Изображения сертификатов несут название в alt — сохраняем его как текст
        for img in section.find_all("img"):
            img.replace_with(img.get("alt", ""))
        heading = section.find("h2")
        title = heading.get_text(" ", strip=True) if heading else section["id"].title()
        text = re.sub(r"\n{2,}", "\n", section.get_text("\n", strip=True))
        if not text:
            continue
        docs.append(
            Document(
                page_content=text,
                metadata={
                    "source_type": "site",
                    "title": f"Портфолио — {title}",
                    "url": f"{site_url.rstrip('/')}/#{section['id']}",
                    "date": "",
                    "tags": "",
                    "source": html_path.name,
                },
            )
        )
    log.info("Разделы сайта: %d", len(docs))
    return docs


def load_cv(pdf_path: Path, site_url: str) -> list[Document]:
    if not pdf_path.is_file():
        return []
    from pypdf import PdfReader

    text = "\n".join(page.extract_text() or "" for page in PdfReader(pdf_path).pages).strip()
    if not text:
        return []
    return [
        Document(
            page_content=text,
            metadata={
                "source_type": "cv",
                "title": "Резюме (CV)",
                "url": f"{site_url.rstrip('/')}/doc/{pdf_path.name}",
                "date": "",
                "tags": "",
                "source": pdf_path.name,
            },
        )
    ]


def load_all(s: Settings) -> list[Document]:
    return [
        *load_markdown_posts(s.blog_dir),
        *load_feed_posts(s.blog_feed_urls),
        *load_page_posts(s.blog_page_urls),
        *load_site_sections(s.site_html, s.site_url),
        *load_cv(s.cv_pdf, s.site_url),
    ]
