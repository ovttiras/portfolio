"""Фабрики LLM и модели эмбеддингов. Провайдер выбирается переменными окружения."""

from __future__ import annotations

from langchain_core.embeddings import Embeddings
from langchain_core.language_models.chat_models import BaseChatModel

from .config import Settings


def get_embeddings(s: Settings) -> Embeddings:
    provider = s.embeddings_provider.lower()

    if provider == "google":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        if not s.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY не задан (ключ из https://aistudio.google.com/apikey)")
        # embed_documents/embed_query сами выставляют task_type RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY
        return GoogleGenerativeAIEmbeddings(
            model=s.embeddings_model,
            google_api_key=s.google_api_key,
            output_dimensionality=s.embeddings_dim or None,
        )

    if provider == "huggingface":
        # pip install langchain-huggingface sentence-transformers
        from langchain_huggingface import HuggingFaceEmbeddings

        return HuggingFaceEmbeddings(
            model_name=s.embeddings_model,
            encode_kwargs={"normalize_embeddings": True},
        )

    raise ValueError(f"Неизвестный EMBEDDINGS_PROVIDER: {s.embeddings_provider}")


def get_llm(s: Settings) -> BaseChatModel:
    provider = s.llm_provider.lower()

    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        if not s.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY не задан (ключ из https://aistudio.google.com/apikey)")
        return ChatGoogleGenerativeAI(
            model=s.llm_model,
            google_api_key=s.google_api_key,
            temperature=s.llm_temperature,
            max_output_tokens=s.llm_max_tokens,
            max_retries=2,
        )

    if provider == "openai":
        # pip install langchain-openai
        # Groq:        OPENAI_BASE_URL=https://api.groq.com/openai/v1
        # OpenRouter:  OPENAI_BASE_URL=https://openrouter.ai/api/v1
        # Ollama:      OPENAI_BASE_URL=http://localhost:11434/v1
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=s.llm_model,
            api_key=s.openai_api_key or "not-needed",
            base_url=s.openai_base_url or None,
            temperature=s.llm_temperature,
            max_tokens=s.llm_max_tokens,
            max_retries=2,
        )

    raise ValueError(f"Неизвестный LLM_PROVIDER: {s.llm_provider}")
