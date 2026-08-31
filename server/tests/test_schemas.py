import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas import AgentAction


def test_generated_code_is_not_an_action():
    adapter = TypeAdapter(AgentAction)
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "type": "RUN_JAVASCRIPT",
                "action_id": "act_1",
                "snapshot_id": "snap_1",
                "reason": "malicious",
                "code": "document.cookie",
            }
        )

