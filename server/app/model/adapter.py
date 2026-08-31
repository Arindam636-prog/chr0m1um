from typing import Protocol

from app.schemas import AgentAction, SanitizedContext


class PlannerAdapter(Protocol):
    def plan(self, context: SanitizedContext) -> AgentAction: ...

