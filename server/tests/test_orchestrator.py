from pathlib import Path

from app.agent.orchestrator import AgentOrchestrator
from app.schemas import SanitizedContext, VerificationResult
from app.schemas.contracts import ClickAction
from app.storage import TraceRepository


class SessionAwarePlanner:
    def __init__(self) -> None:
        self.initial_calls = 0
        self.followup_calls = 0

    def plan(self, context: SanitizedContext) -> ClickAction:
        self.initial_calls += 1
        return ClickAction(
            type="CLICK",
            action_id=f"act_initial_{self.initial_calls}",
            snapshot_id=context.snapshot_id,
            element_id="el_1",
            reason="Initial model plan",
        )

    def plan_followup(self, context: SanitizedContext) -> ClickAction:
        self.followup_calls += 1
        return ClickAction(
            type="CLICK",
            action_id=f"act_followup_{self.followup_calls}",
            snapshot_id=context.snapshot_id,
            element_id="el_1",
            reason="Grounded follow-up",
        )


def test_followup_optimization_is_scoped_to_one_session(
    tmp_path: Path, safe_context: dict
) -> None:
    repository = TraceRepository(str(tmp_path / "sessions.sqlite3"))
    repository.initialize()
    planner = SessionAwarePlanner()
    orchestrator = AgentOrchestrator(planner, repository)
    context = SanitizedContext.model_validate(safe_context)

    first = orchestrator.start(context)
    orchestrator.verify(
        first.session_id,
        VerificationResult(
            action_id=first.action.action_id,
            success=True,
            page_changed=True,
            new_snapshot_required=True,
            error=None,
        ),
    )
    next_context = context.model_copy(update={"snapshot_id": "snap_test_2"})
    orchestrator.step(first.session_id, next_context)

    # A new run with identical task text must still take its own initial model turn.
    orchestrator.start(context)

    assert planner.initial_calls == 2
    assert planner.followup_calls == 1
