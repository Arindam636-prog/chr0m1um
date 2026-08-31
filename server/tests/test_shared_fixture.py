from pathlib import Path

from app.schemas import SanitizedContext


def test_typescript_shared_fixture_matches_pydantic_contract():
    fixture_path = (
        Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "sanitized-context.json"
    )
    context = SanitizedContext.model_validate_json(fixture_path.read_text(encoding="utf-8"))
    assert context.snapshot_id == "snap_fixture_1"
    assert context.elements[1].value_handle == "LOCAL_EMAIL_1"

