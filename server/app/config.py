from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    server_host: str = "127.0.0.1"
    server_port: int = Field(default=8000, ge=1, le=65535)
    model_path: str = "./models/qwen3-vl-4b-instruct-q4_k_m.gguf"
    model_context_size: int = Field(default=8192, ge=1024)
    model_backend: str = "mock"
    llama_server_url: str = "http://127.0.0.1:8080"
    llama_model_name: str = "qwen3-vl-4b-instruct"
    model_timeout_seconds: float = Field(default=120.0, gt=0, le=600)
    database_path: str = "./data/contextshield.sqlite3"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost"
    cors_origin_regex: str = r"^(chrome-extension|moz-extension)://[a-z0-9-]+$"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
