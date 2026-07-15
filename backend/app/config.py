
"""
Central configuration using pydantic-settings.

All values have safe local-dev defaults so `docker-compose up` works out of
the box; override via environment variables (or a .env file) for production.
Secrets are typed as SecretStr so they never accidentally show up in logs,
tracebacks, or repr() output.
"""
from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- App ---
    APP_NAME: str = "DocuMind"
    ENV: str = "development"
    SECRET_KEY: SecretStr = SecretStr("dev-secret-change-me")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # --- Postgres (Supabase free tier or local) ---
    DATABASE_URL: str = "postgresql://postgres:postgres@postgres:5432/ragdb"

    # --- Qdrant (vector DB - Qdrant Cloud free tier or local Docker) ---
    QDRANT_URL: str = "http://qdrant:6333"
    QDRANT_API_KEY: SecretStr = SecretStr("")
    QDRANT_COLLECTION: str = "documents"

    # --- Redis (Upstash free tier or local) ---
    REDIS_URL: str = "redis://redis:6379/0"

    # --- LLM (Groq free tier) ---
    GROQ_API_KEY: SecretStr = SecretStr("")
    GROQ_MODEL: str = "llama-3.1-70b-versatile"

    # --- Embeddings (local, free, no API needed) ---
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DIM: int = 384

    # --- Chunking ---
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 120
    TOP_K: int = 5

    # --- Rate limiting ---
    RATE_LIMIT_DEFAULT: str = "60/minute"
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_CHAT: str = "20/minute"

    # --- Observability (Langfuse free tier, optional) ---
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: str = ""
    LANGFUSE_HOST: str = "https://cloud.langfuse.com"

    # --- CORS ---
    ALLOWED_ORIGINS_RAW: str = Field(default="*", validation_alias="ALLOWED_ORIGINS")

    @property
    def ALLOWED_ORIGINS(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS_RAW.split(",")]

    # --- Email (Resend free tier - transactional email for verification/reset) ---
    RESEND_API_KEY: SecretStr = SecretStr("")
    # Resend's shared sandbox sender works without a verified domain, but
    # will only deliver to the email address on your Resend account until
    # you verify your own domain. Swap this once you've verified a domain.
    EMAIL_FROM: str = "DocuMind <onboarding@resend.dev>"
    # Public URL of the deployed frontend - verification/reset links point here.
    FRONTEND_URL: str = "http://localhost:5500"
    VERIFICATION_TOKEN_EXPIRE_HOURS: int = 24
    RESET_TOKEN_EXPIRE_MINUTES: int = 30

    @field_validator("ENV")
    @classmethod
    def validate_env(cls, v: str) -> str:
        allowed = {"development", "staging", "production"}
        if v not in allowed:
            raise ValueError(f"ENV must be one of {allowed}, got {v!r}")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
