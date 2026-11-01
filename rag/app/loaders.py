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

# Смысловые блоки страницы: каждый индексируется отдельным документом, чтобы короткие факты
# не растворялись в длинных чанках со списком навыков.
SITE_BLOCKS = ".home-info, .about-text, .skills, .education, .experience, .portfolio-item"
# Подписи для блоков без собственного заголовка: (ru, en)
BLOCK_LABELS = {
    "home": ("Главная", "Home"),
    "home-info": ("Кратко об Олеге", "Summary"),
}


def _page_versions(html_path: Path) -> dict[str, BeautifulSoup]:
    """Две версии страницы — английская (как в HTML) и русская (тексты из data-ru), как это делает
    переключатель языка на сайте. Так русские вопросы находят русский текст и наоборот."""
    html = html_path.read_text(encoding="utf-8")
    versions = {"en": BeautifulSoup(html, "html.parser"), "ru": BeautifulSoup(html, "html.parser")}
    for el in versions["ru"].select("[data-ru][data-en]"):
        el.string = el["data-ru"]
    for soup in versions.values():
        for tag in soup(["script", "style", "iframe"]):
            tag.decompose()
        # Изображения сертификатов несут название в alt — сохраняем его как текст
        for img in soup.find_all("img"):
            img.replace_with(img.get("alt", ""))
    return versions


def _block_text(el) -> str:
    """Текст блока по строкам исходной разметки: «<span>Age</span> : <span>42</span>» → «Age : 42»."""
    lines = (re.sub(r"\s+", " ", line).strip() for line in el.get_text().splitlines())
    return "\n".join(line for line in lines if line)


def _block_title(section, block, lang: str) -> str:
    heading = section.find("h2")
    parts = [heading.get_text(" ", strip=True) if heading else BLOCK_LABELS["home"][lang == "en"]]
    if block is not section:
        key = next((c for c in block.get("class", []) if c in BLOCK_LABELS), None)
        sub = block.find(["h3", "h4"])
        if key:
            parts.append(BLOCK_LABELS[key][lang == "en"])
        elif sub:
            parts.append(sub.get_text(" ", strip=True))
    return " — ".join(parts)


def load_site_sections(html_path: Path, site_url: str) -> list[Document]:
    """Разделы index.html, разбитые на смысловые блоки, на русском и английском."""
    if not html_path.is_file():
        return []

    docs: list[Document] = []
    for lang, soup in _page_versions(html_path).items():
        for section in soup.select("section.section[id]"):
            blocks = section.select(SITE_BLOCKS) or [section]
            for i, block in enumerate(blocks):
                text = _block_text(block)
                if not text:
                    continue
                title = _block_title(section, block, lang)
                docs.append(
                    Document(
                        page_content=text if text.startswith(title) else f"{title}\n{text}",
                        metadata={
                            "source_type": "site",
                            "title": title,
                            "url": f"{site_url.rstrip('/')}/#{section['id']}",
                            "date": "",
                            "tags": "",
                            "lang": lang,
                            # общий id у русской и английской версии — в ответе это один источник
                            "doc_id": f"site:{section['id']}:{i}",
                            "source": html_path.name,
                        },
                    )
                )
    log.info("Блоки сайта: %d", len(docs))
    return docs


def load_profile(html_path: Path, site_url: str) -> list[Document]:
    """Короткая справка (кто, возраст, образование, текущая работа, контакты).

    Добавляется в контекст каждого запроса, поэтому базовые факты об Олеге доступны всегда,
    даже если поиск их не нашёл."""
    if not html_path.is_file():
        return []

    docs: list[Document] = []
    for lang, soup in _page_versions(html_path).items():
        parts = [
            soup.select_one(".home-info"),
            soup.select_one(".about-text"),
            soup.select_one(".about-meta"),
            soup.select_one(".experience .timeline-item"),
            *soup.select(".contact-info-item"),
        ]
        text = "\n".join(_block_text(p) for p in parts if p)
        if not text:
            continue
        title = "Олег Тиньков — краткая справка" if lang == "ru" else "Oleg Tinkov — profile summary"
        docs.append(
            Document(
                page_content=f"{title}\n{text}",
                metadata={
                    "source_type": "site",
                    "title": title,
                    "url": f"{site_url.rstrip('/')}/#about",
                    "date": "",
                    "tags": "",
                    "lang": lang,
                    "doc_id": "site:profile",
                    "source": html_path.name,
                },
            )
        )
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


def load_publications(json_path: Path) -> list[Document]:
    """Научные публикации из data/publications.json — по документу на статью, источник — ссылка на DOI."""
    if not json_path.is_file():
        return []
    import json

    docs: list[Document] = []
    for pub in json.loads(json_path.read_text(encoding="utf-8")):
        venue = ", ".join(part for part in (pub["venue"], pub.get("details", "")) if part)
        if pub.get("authors"):
            authors = f"Авторы / Authors: {', '.join(pub['authors'])}"
        else:
            # порядок авторов неизвестен — только соавторы Олега
            authors = f"Авторы / Authors: Тиньков О.В. (Tinkov O.V.); соавторы: {', '.join(pub.get('coauthors', []))}"
        lines = [pub["title"], authors, f"Издание / Venue: {venue} ({pub['year']})"]
        if pub.get("type") == "textbook":
            lines.append("Тип: учебное пособие / Textbook")
        if pub.get("index"):
            lines.append(f"Индексация / Indexed in: {', '.join(pub['index'])}")
        if pub.get("doi"):
            lines.append(f"DOI: {pub['doi']}")
        if pub.get("app"):
            lines.append(f"Веб-приложение / Web app: {pub['app']['name']} — {pub['app']['url']}")
        if pub.get("abstract"):
            lines.append(f"Abstract: {pub['abstract']}")
        docs.append(
            Document(
                page_content="\n".join(lines),
                metadata={
                    "source_type": "publication",
                    "title": pub["title"],
                    "url": f"https://doi.org/{pub['doi']}" if pub.get("doi") else "",
                    "date": str(pub["year"]),
                    "tags": ", ".join(pub.get("topics", [])),
                    "doc_id": f"pub:{pub['id']}",
                    "source": json_path.name,
                },
            )
        )
    log.info("Публикации: %d", len(docs))
    return docs


def load_reviews(json_path: Path, site_url: str) -> list[Document]:
    """Рецензирование: один документ со списком журналов и числом рецензий."""
    if not json_path.is_file():
        return []
    import json

    data = json.loads(json_path.read_text(encoding="utf-8"))
    journals = sorted(data["journals"], key=lambda j: -j["count"])
    total = sum(j["count"] for j in journals)
    lines = [
        "Рецензирование в научных журналах / Peer review",
        f"Олег Тиньков рецензирует статьи с {data['since']} года: {total} подтверждённых рецензий "
        f"в {len(journals)} международных журналах (подтверждено в {data['source']['name']}).",
        f"Oleg Tinkov has been a peer reviewer since {data['since']}: {total} verified reviews "
        f"for {len(journals)} international journals.",
        "Журналы и число рецензий / Journals and number of reviews:",
        *(
            f"- {j['name']}: {j['count']}"
            + "".join(f", {k} {j[key]}" for k, key in (("Q", "quartile"), ("IF", "if")) if j.get(key) is not None)
            + (f" ({j['url']})" if j.get("url") else "")
            for j in journals
        ),
    ]
    return [
        Document(
            page_content="\n".join(lines),
            metadata={
                "source_type": "site",
                "title": "Научная работа — Рецензии",
                "url": f"{site_url.rstrip('/')}/#research",
                "date": "",
                "tags": "",
                "doc_id": "site:reviews",
                "source": json_path.name,
            },
        )
    ]


def load_talks(json_path: Path, site_url: str) -> list[Document]:
    """Доклады и тезисы на конференциях: документы по годам, чтобы длинный список не обрезался при нарезке."""
    if not json_path.is_file():
        return []
    import json

    def ru(value):
        return value.get("ru", "") if isinstance(value, dict) else (value or "")

    by_year: dict[int, list[str]] = {}
    for talk in json.loads(json_path.read_text(encoding="utf-8")):
        when = ", ".join(part for part in (ru(talk.get("place")), ru(talk.get("date"))) if part)
        title = f"«{talk['title']}» — " if talk.get("title") else ""
        line = f"- {title}{ru(talk['event'])}" + (f" ({when})" if when else "")
        if talk.get("coauthors"):
            line += f"; соавторы: {', '.join(talk['coauthors'])}"
        by_year.setdefault(talk["year"], []).append(line)

    docs = []
    for year in sorted(by_year, reverse=True):
        docs.append(
            Document(
                page_content=f"Доклады и тезисы Олега Тинькова на научных конференциях, {year} год "
                f"(conference talks and abstracts, {year}):\n" + "\n".join(by_year[year]),
                metadata={
                    "source_type": "site",
                    "title": f"Научная работа — Доклады, {year}",
                    "url": f"{site_url.rstrip('/')}/#research",
                    "date": str(year),
                    "tags": "",
                    "doc_id": "site:talks",
                    "source": json_path.name,
                },
            )
        )
    return docs


def load_all(s: Settings) -> list[Document]:
    return [
        *load_markdown_posts(s.blog_dir),
        *load_feed_posts(s.blog_feed_urls),
        *load_page_posts(s.blog_page_urls),
        *load_site_sections(s.site_html, s.site_url),
        *load_cv(s.cv_pdf, s.site_url),
        *load_publications(s.publications_json),
        *load_reviews(s.reviews_json, s.site_url),
        *load_talks(s.talks_json, s.site_url),
    ]
