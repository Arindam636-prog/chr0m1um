import re
from uuid import uuid4

from app.model import PlannerAdapter
from app.schemas import AgentAction, AgentStartResponse, SanitizedContext, VerificationResult
from app.schemas.contracts import (
    ClickAction,
    FinishAction,
    SelectAction,
    TypeHandleAction,
    VerificationResponse,
)
from app.storage import TraceRepository


class SessionNotFoundError(LookupError):
    pass


class SessionStateError(RuntimeError):
    pass


class InvalidPlannerActionError(RuntimeError):
    pass


BLOCKED_FINISH = re.compile(
    r"\b(?:cannot|can't|could not|couldn't|unable|failed|failure|not possible|"
    r"not completed|incomplete|blocked|no actionable elements?|no further safe action|"
    r"no (?:matching|requested|eligible|available|relevant|safe) "
    r"(?:element|action|control|target|option)s?(?: (?:was|were))? found)\b",
    re.I,
)


class AgentOrchestrator:
    def __init__(self, planner: PlannerAdapter, repository: TraceRepository) -> None:
        self._planner = planner
        self._repository = repository
        self._model_planned_sessions: set[str] = set()

    def _plan_for_session(
        self, session_id: str, context: SanitizedContext
    ) -> AgentAction:
        """Use deterministic follow-ups only after this exact session used the model."""
        followup = getattr(self._planner, "plan_followup", None)
        if session_id in self._model_planned_sessions and callable(followup):
            return followup(context)

        action = self._planner.plan(context)
        # The Qwen adapter intentionally handles exact LOCAL_* insertion without
        # inference. Any other action from that adapter represents a genuine model
        # turn, so later grounded form transitions may use its fast follow-up path.
        if callable(followup) and not isinstance(action, TypeHandleAction):
            self._model_planned_sessions.add(session_id)
        return action

    def _discard_terminal_session(self, session_id: str, state: str) -> None:
        if state in {"COMPLETE", "FAILED"}:
            self._model_planned_sessions.discard(session_id)

    @staticmethod
    def _validate_action(action: AgentAction, context: SanitizedContext) -> None:
        if action.snapshot_id != context.snapshot_id:
            raise InvalidPlannerActionError("Planner returned a stale snapshot")
        elements = {element.id: element for element in context.elements}
        if isinstance(action, (ClickAction, TypeHandleAction, SelectAction)):
            element = elements.get(action.element_id)
            if element is None or not element.enabled:
                raise InvalidPlannerActionError("Planner referenced an unavailable element")
            if isinstance(action, TypeHandleAction) and element.value_handle != action.handle:
                raise InvalidPlannerActionError("Planner referenced an unavailable handle")
            if isinstance(action, SelectAction) and action.option not in element.options:
                raise InvalidPlannerActionError("Planner referenced an unavailable option")
            if isinstance(action, SelectAction) and action.option == element.selected_option:
                raise InvalidPlannerActionError("Planner repeated the currently selected option")

    def start(self, context: SanitizedContext) -> AgentStartResponse:
        session_id = str(uuid4())
        action = self._with_server_action_id(
            self._plan_for_session(session_id, context)
        )
        self._validate_action(action, context)
        state = self._state_for_action(action)
        self._repository.create_session(session_id, context, state, action)
        self._discard_terminal_session(session_id, state)
        return AgentStartResponse(session_id=session_id, state=state, action=action)

    def step(self, session_id: str, context: SanitizedContext) -> AgentStartResponse:
        session = self._repository.get_session(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.state != "OBSERVE":
            raise SessionStateError(f"Cannot plan while session is {session.state}")
        if session.latest_snapshot_id == context.snapshot_id:
            raise SessionStateError("A fresh snapshot is required")
        action = self._with_server_action_id(
            self._plan_for_session(session_id, context)
        )
        self._validate_action(action, context)
        state = self._state_for_action(action)
        if not self._repository.update_session(session_id, context, state, action):
            raise SessionNotFoundError(session_id)
        self._discard_terminal_session(session_id, state)
        return AgentStartResponse(session_id=session_id, state=state, action=action)

    @staticmethod
    def _state_for_action(action: AgentAction) -> str:
        if not isinstance(action, FinishAction):
            return "EXECUTE"
        if BLOCKED_FINISH.search(f"{action.reason}\n{action.summary}"):
            return "FAILED"
        return "COMPLETE"

    @staticmethod
    def _with_server_action_id(action: AgentAction) -> AgentAction:
        """Give every planned action a unique ID owned by the trusted server.

        Local language models are deterministic at temperature zero and can return the
        same schema-valid action_id for repeated prompts.  An action ID is protocol
        bookkeeping, not a planning decision, so the server must generate it rather
        than trusting the model to provide globally unique values.
        """
        return action.model_copy(update={"action_id": f"act_{uuid4().hex}"})

    def verify(self, session_id: str, result: VerificationResult) -> VerificationResponse:
        session = self._repository.get_session(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.state != "EXECUTE" or session.pending_action_id != result.action_id:
            raise SessionStateError("Verification does not match the pending action")
        # A stale snapshot proves that the page changed after planning.  The local
        # broker has already blocked the action, and the session must terminate
        # instead of repeatedly replanning against a deliberately unstable page.
        state = "OBSERVE" if result.success else "FAILED"
        if not self._repository.add_verification_and_transition(session_id, result, state):
            raise SessionStateError("Verification was already consumed")
        return VerificationResponse(session_id=session_id, state=state, accepted=True)
