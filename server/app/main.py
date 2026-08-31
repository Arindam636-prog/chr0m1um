from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent import AgentOrchestrator
from app.api.routes import router
from app.config import Settings, get_settings
from app.model import MockPlanner, QwenLlamaPlanner
from app.storage import TraceRepository


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()
    repository = TraceRepository(resolved.database_path)
    if resolved.model_backend == "mock":
        planner = MockPlanner()
    elif resolved.model_backend == "llama":
        planner = QwenLlamaPlanner(
            resolved.llama_server_url,
            resolved.llama_model_name,
            resolved.model_timeout_seconds,
        )
    else:
        raise ValueError("MODEL_BACKEND must be 'mock' or 'llama'")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        repository.initialize()
        app.state.settings = resolved
        app.state.orchestrator = AgentOrchestrator(planner, repository)
        yield

    application = FastAPI(
        title="ContextShield Agent API",
        version="0.1.0",
        description="Accepts sanitized context and returns typed browser actions only.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.allowed_origins,
        allow_origin_regex=resolved.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )
    application.include_router(router)
    return application


app = create_app()
