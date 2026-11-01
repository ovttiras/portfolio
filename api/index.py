"""Точка входа serverless-функции Vercel: отдаёт FastAPI-приложение RAG-ассистента из папки rag/.

Все запросы /api/* перенаправляются сюда правилом rewrites в vercel.json.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "rag"))

from app.main import app  # noqa: E402,F401  (Vercel ищет ASGI-приложение в переменной app)
