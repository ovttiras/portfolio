# Сборка из корня репозитория:  docker build -f rag/Dockerfile -t portfolio-rag .
FROM python:3.13-slim

WORKDIR /app/rag
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000

COPY rag/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Сайт и резюме тоже индексируются
COPY index.html /app/index.html
COPY doc/ /app/doc/
COPY rag/ /app/rag/

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
