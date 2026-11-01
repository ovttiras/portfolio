"""Заполняет абстракты в data/publications.json по DOI из открытых баз Crossref и OpenAlex.

Запуск из корня репозитория:
    python tools/fetch_abstracts.py           # только пустые абстракты
    python tools/fetch_abstracts.py --force   # перезаписать все

Нужен доступ к api.crossref.org и api.openalex.org. Зависимости — только стандартная библиотека.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "publications.json"
# Crossref и OpenAlex просят указывать контакт в User-Agent («polite pool»)
USER_AGENT = "portfolio-publications/1.0 (mailto:oleg.tinkov.chem@mail.ru)"


def get_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"  ! {url}: {exc}", file=sys.stderr)
        return None


def clean(text: str) -> str:
    """Убирает разметку JATS/HTML и служебный заголовок «Abstract»."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return re.sub(r"^(abstract|summary)[\s.:]*", "", text, flags=re.I)


def from_crossref(doi: str) -> str:
    data = get_json(f"https://api.crossref.org/works/{urllib.parse.quote(doi)}")
    abstract = (data or {}).get("message", {}).get("abstract", "")
    return clean(abstract) if abstract else ""


def from_openalex(doi: str) -> str:
    data = get_json(f"https://api.openalex.org/works/doi:{urllib.parse.quote(doi)}")
    index = (data or {}).get("abstract_inverted_index")
    if not index:
        return ""
    # OpenAlex хранит абстракт как «слово → позиции»; собираем текст обратно
    words = sorted((pos, word) for word, positions in index.items() for pos in positions)
    return clean(" ".join(word for _, word in words))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="перезаписать уже заполненные абстракты")
    args = parser.parse_args()

    pubs = json.loads(DATA.read_text(encoding="utf-8"))
    filled = 0
    for pub in pubs:
        if pub.get("abstract") and not args.force:
            continue
        print(f"{pub['doi']}: {pub['title'][:60]}…")
        abstract = from_crossref(pub["doi"]) or from_openalex(pub["doi"])
        if abstract:
            pub["abstract"] = abstract
            filled += 1
            print(f"  ✓ {len(abstract)} симв.")
        else:
            print("  — абстракт не найден, заполните вручную")
        time.sleep(0.3)

    DATA.write_text(json.dumps(pubs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    missing = sum(1 for p in pubs if not p.get("abstract"))
    print(f"\nЗаполнено: {filled}. Без абстракта: {missing}.")


if __name__ == "__main__":
    main()
