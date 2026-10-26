# AI-ассистент портфолио (RAG на LangChain)

Чат-виджет на сайте отвечает посетителям на вопросы по статьям блога, проектам, опыту и навыкам,
опираясь только на ваши материалы, и показывает ссылки на источники `[1]`, `[2]`.

```
GitHub Pages (index.html + js/chat-widget.js)
        │  POST /api/chat/stream (SSE)
        ▼
FastAPI (rag/app/main.py)
        │
        ▼
LangChain-цепочка (rag/app/chain.py)
  1. переформулировка вопроса с учётом истории  ── LLM
  2. MMR-поиск по векторному индексу            ── эмбеддинги
  3. ответ со ссылками на источники (стриминг)  ── LLM
        ▲
Индекс (rag/data/index/vectorstore.json) ← rag/app/ingest.py ← блог (Markdown / RSS / URL),
                                                              index.html, doc/CV_Tinkov.pdf
```

## Модели

| Роль | По умолчанию (Google AI Studio) | Альтернативы |
|---|---|---|
| LLM | `gemini-3.1-flash-lite` (стабильная, есть бесплатный лимит) | любая модель Gemini через `LLM_MODEL`; Groq / OpenRouter / Mistral / локальная Ollama через `LLM_PROVIDER=openai` |
| Эмбеддинги | `gemini-embedding-001`, 768 измерений, понимает русский и английский | `gemini-embedding-2`; локальная `intfloat/multilingual-e5-small` через `EMBEDDINGS_PROVIDER=huggingface` (без API и лимитов, но образ на ~1 ГБ больше) |
| Векторное хранилище | `InMemoryVectorStore` из `langchain-core`, сохраняется в JSON | для сотен статей этого достаточно; при росте легко заменить на Chroma / Qdrant / pgvector |

Ключ API: <https://aistudio.google.com/apikey>. Перед деплоем проверьте актуальные ID моделей на
<https://ai.google.dev/gemini-api/docs/models>: Google регулярно выводит модели из эксплуатации,
а ID меняется одной переменной окружения.

## Как добавить статьи блога

Выберите любой способ (их можно совмещать):

1. **Markdown-файлы** в `rag/data/blog/`: скопируйте `_template.md`, укажите `title`, `date`, `url`
   (ссылку на оригинал, которую ассистент покажет как источник) и вставьте текст.
2. **RSS/Atom-лента** (Medium, Habr, Substack, Telegra.ph, feed.xml от Jekyll):
   `BLOG_FEED_URLS=https://medium.com/feed/@username`. Если в ленте только анонс,
   полный текст статьи подгружается со страницы.
3. **Отдельные страницы**: `BLOG_PAGE_URLS=https://…/post-1,https://…/post-2`.

Кроме блога всегда индексируются разделы `index.html` и резюме `doc/CV_Tinkov.pdf`.

## Локальный запуск

```bash
cd rag
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # впишите GOOGLE_API_KEY и источники блога

python -m app.ingest --dry-run  # проверить, что загрузилось, без вызова API
python -m app.ingest            # построить индекс → data/index/vectorstore.json
uvicorn app.main:app --reload --port 8000
```

Сайт откройте через любой статический сервер (`python -m http.server 5500` в корне репозитория),
виджет по умолчанию обращается к `http://localhost:8000`.

Проверка API:

```bash
curl -N -X POST localhost:8000/api/chat/stream \
     -H 'Content-Type: application/json' \
     -d '{"question": "Какой у Олега опыт с RAG?"}'
```

Тесты (без обращения к API, на фейковых моделях): `pip install -r requirements-dev.txt && pytest`.

## Деплой

GitHub Pages отдаёт только статику, поэтому бэкенд нужно развернуть отдельно. Индекс лучше
построить локально и закоммитить `rag/data/index/`: тогда сервер стартует без пересчёта
эмбеддингов (если файла нет, индекс строится при запуске).

**Render** (бесплатный план, засыпает без трафика):
New → Web Service → репозиторий `ovttiras/portfolio` → Runtime *Docker*,
Dockerfile Path `rag/Dockerfile`, Docker Build Context `.` → переменные `GOOGLE_API_KEY`,
`ALLOWED_ORIGINS=https://ovttiras.github.io`.

**Google Cloud Run** (удобно, если ключ уже в Google Cloud):

```bash
docker build -f rag/Dockerfile -t REGION-docker.pkg.dev/PROJECT/repo/portfolio-rag .
docker push REGION-docker.pkg.dev/PROJECT/repo/portfolio-rag
gcloud run deploy portfolio-rag --image REGION-docker.pkg.dev/PROJECT/repo/portfolio-rag \
  --allow-unauthenticated --set-env-vars GOOGLE_API_KEY=…,ALLOWED_ORIGINS=https://ovttiras.github.io
```

Подойдут и Hugging Face Spaces (Docker), Railway, Fly.io или любой VPS.

После деплоя укажите адрес сервиса в `index.html`:

```html
<script src="js/chat-widget.js?v=1" data-api-url="https://portfolio-rag.onrender.com"></script>
```

## Безопасность и расходы

- Ключ API хранится только на сервере (`rag/.env` в `.gitignore`), браузер его не видит.
- CORS разрешён только для доменов из `ALLOWED_ORIGINS`.
- Лимит `RATE_LIMIT_PER_MINUTE` запросов в минуту с одного IP, вопрос не длиннее `MAX_QUESTION_CHARS`,
  в модель уходит не больше `MAX_HISTORY_TURNS` последних реплик.
- Системный промпт запрещает отвечать вне контекста и выполнять инструкции из текста статей.

## Переменные окружения

Полный список с комментариями: `rag/.env.example`; значения по умолчанию: `rag/app/config.py`.
