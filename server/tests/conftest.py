import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path):
    settings = Settings(database_path=str(tmp_path / "test.sqlite3"), model_backend="mock")
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def safe_context() -> dict:
    return {
        "task": "Continue to the next step",
        "origin": "https://example.com",
        "snapshot_id": "snap_test_1",
        "elements": [
            {
                "id": "el_1",
                "role": "button",
                "text": "Continue",
                "label": "Continue",
                "input_type": None,
                "value_handle": None,
                "enabled": True,
                "selected": None,
                "value_present": False,
                "options": [],
            }
        ],
        "safe_visual_crops": [],
        "privacy_summary": {"EMAIL": 1},
    }
