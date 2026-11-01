---
title: Oleg Tinkov — Portfolio RAG
emoji: 🤖
colorFrom: indigo
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

API AI-ассистента сайта-портфолио Олега Тинькова (LangChain + Gemini).
Исходный код: https://github.com/ovttiras/portfolio (папка `rag/`).

- `GET /api/health` — статус и информация об индексе
- `POST /api/chat/stream` — потоковый ответ (SSE)
