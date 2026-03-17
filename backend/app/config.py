from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/parliwatch"
    redis_url: str = "redis://localhost:6379/0"
    groq_api_key: str = ""
    anthropic_api_key: str = ""
    monthly_groq_spend_cap: float = 50.0
    monthly_anthropic_spend_cap: float = 50.0
    secret_key: str = "change-me"
    cors_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
