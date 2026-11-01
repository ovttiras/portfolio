"""Деплой RAG-бэкенда на Hugging Face Spaces (бесплатный CPU-тариф) одной командой.

Из корня репозитория:
    pip install huggingface_hub
    huggingface-cli login                      # токен с правом write: https://huggingface.co/settings/tokens
    python deploy/hf_space.py --space <ваш_логин>/portfolio-rag

Скрипт создаёт Space (Docker), загружает rag/, index.html, doc/, data/ и готовый индекс
rag/data/index/, а также передаёт GOOGLE_API_KEY (секрет) и ALLOWED_ORIGINS из rag/.env.
Повторный запуск обновляет Space.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPACE_FILES = Path(__file__).resolve().parent / "hf-space"
# Не уносим в Space локальное окружение, секреты и тесты
IGNORE = shutil.ignore_patterns(".venv", "venv", ".env", "__pycache__", ".pytest_cache", "tests", "*.pyc")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.is_file():
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def stage(target: Path) -> None:
    shutil.copytree(SPACE_FILES, target, dirs_exist_ok=True)
    shutil.copytree(ROOT / "rag", target / "rag", ignore=IGNORE)
    shutil.copytree(ROOT / "doc", target / "doc")
    shutil.copytree(ROOT / "data", target / "data")
    shutil.copy2(ROOT / "index.html", target / "index.html")


def main() -> None:
    parser = argparse.ArgumentParser(description="Деплой RAG-бэкенда на Hugging Face Spaces")
    parser.add_argument("--space", required=True, help="логин/имя Space, например ovttiras/portfolio-rag")
    parser.add_argument("--origins", default="https://ovttiras.github.io", help="ALLOWED_ORIGINS для CORS")
    args = parser.parse_args()

    from huggingface_hub import HfApi

    if not (ROOT / "rag" / "data" / "index" / "vectorstore.json").is_file():
        sys.exit("Нет индекса rag/data/index/vectorstore.json — сначала выполните: cd rag && python -m app.ingest")

    env = read_env(ROOT / "rag" / ".env")
    api = HfApi()
    api.create_repo(args.space, repo_type="space", space_sdk="docker", exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        stage(Path(tmp))
        api.upload_folder(
            repo_id=args.space,
            repo_type="space",
            folder_path=tmp,
            commit_message="Deploy portfolio RAG",
            delete_patterns=["rag/**", "data/**", "doc/**"],  # убрать файлы, удалённые в репозитории
        )

    key = env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY")
    if key:
        api.add_space_secret(args.space, "GOOGLE_API_KEY", key)
    else:
        print("! GOOGLE_API_KEY не найден в rag/.env — добавьте секрет вручную в настройках Space")
    api.add_space_variable(args.space, "ALLOWED_ORIGINS", args.origins)
    for name in ("LLM_MODEL", "EMBEDDINGS_MODEL", "EMBEDDINGS_DIM", "LLM_PROVIDER", "EMBEDDINGS_PROVIDER"):
        if env.get(name):
            api.add_space_variable(args.space, name, env[name])

    owner, name = args.space.split("/")
    print(f"\nГотово. Space: https://huggingface.co/spaces/{args.space}")
    print(f"Адрес API (через 2–5 минут, после сборки): https://{owner}-{name}.hf.space".lower().replace("_", "-"))
    print('Впишите его в index.html: <script src="js/chat.js?..." data-api-url="ЭТОТ_АДРЕС">')


if __name__ == "__main__":
    main()
