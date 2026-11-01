# Docker-образ RAG-ассистента для Hugging Face Spaces.
# Собирается из папки, которую готовит deploy/hf_space.py (rag/, index.html, doc/, data/).
FROM python:3.13-slim

# Spaces запускают контейнер от пользователя с UID 1000
RUN useradd -m -u 1000 user
WORKDIR /app/rag
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860

COPY --chown=user rag/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user index.html /app/index.html
COPY --chown=user doc/ /app/doc/
COPY --chown=user data/ /app/data/
COPY --chown=user rag/ /app/rag/

USER user
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
