from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.agent import AgentOrchestrator
from app.agent.orchestrator import (
    InvalidPlannerActionError,
    SessionNotFoundError,
    SessionStateError,
)
from app.model import ModelInferenceError
from app.schemas import AgentStartResponse, AgentStepRequest, SanitizedContext, VerificationRequest
from app.schemas.contracts import VerificationResponse
from app.security.payload_guard import assert_sanitized_context

router = APIRouter()


def get_orchestrator(request: Request) -> AgentOrchestrator:
    return request.app.state.orchestrator


AgentOrchestratorDependency = Annotated[AgentOrchestrator, Depends(get_orchestrator)]


def planner_is_ready(request: Request) -> bool:
    settings = request.app.state.settings
    if settings.model_backend == "mock":
        return True
    endpoint = settings.llama_server_url.rstrip("/") + "/v1/models"
    probe = UrlRequest(endpoint, method="GET")  # noqa: S310 -- loopback/operator URL
    try:
        with urlopen(probe, timeout=0.75) as response:  # noqa: S310
            return 200 <= response.status < 300
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


@router.get("/health")
def health(request: Request) -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": "contextshield-agent",
        "model_backend": request.app.state.settings.model_backend,
        "planner_ready": planner_is_ready(request),
        "privacy_boundary": "sanitized-context-only",
    }


@router.post("/v1/agent/start", response_model=AgentStartResponse)
def start_agent(
    context: SanitizedContext,
    orchestrator: AgentOrchestratorDependency,
) -> AgentStartResponse:
    assert_sanitized_context(context)
    try:
        return orchestrator.start(context)
    except (InvalidPlannerActionError, ModelInferenceError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Planner failed to produce a safe structured action",
        ) from error


@router.post("/v1/agent/step", response_model=AgentStartResponse)
def step_agent(
    request: AgentStepRequest,
    orchestrator: AgentOrchestratorDependency,
) -> AgentStartResponse:
    assert_sanitized_context(request.context)
    try:
        return orchestrator.step(request.session_id, request.context)
    except SessionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        ) from error
    except SessionStateError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invalid agent state transition"
        ) from error
    except (InvalidPlannerActionError, ModelInferenceError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Planner failed to produce a safe structured action",
        ) from error


@router.post("/v1/agent/verify", response_model=VerificationResponse)
def verify_agent(
    request: VerificationRequest,
    orchestrator: AgentOrchestratorDependency,
) -> VerificationResponse:
    try:
        return orchestrator.verify(request.session_id, request.result)
    except SessionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        ) from error
    except SessionStateError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invalid agent state transition"
        ) from error
