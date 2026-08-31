import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from app.schemas import AgentAction, SanitizedContext, VerificationResult


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    latest_snapshot_id: str
    state: str
    pending_action_id: str | None


class TraceRepository:
    """Persists sanitized contexts and typed action/verification traces only."""

    def __init__(self, database_path: str) -> None:
        self._path = Path(database_path)

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    task TEXT NOT NULL,
                    latest_snapshot_id TEXT NOT NULL,
                    sanitized_context_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    pending_action_id TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            existing_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(sessions)")
            }
            if "pending_action_id" not in existing_columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN pending_action_id TEXT")
            if "updated_at" not in existing_columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN updated_at TEXT")
                connection.execute("UPDATE sessions SET updated_at = CURRENT_TIMESTAMP")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    action_id TEXT NOT NULL UNIQUE,
                    snapshot_id TEXT NOT NULL,
                    action_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS verifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    action_id TEXT,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
                )
                """
            )
            verification_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(verifications)")
            }
            if "action_id" not in verification_columns:
                connection.execute("ALTER TABLE verifications ADD COLUMN action_id TEXT")

    def create_session(
        self,
        session_id: str,
        context: SanitizedContext,
        state: str,
        action: AgentAction,
    ) -> None:
        payload = json.dumps(context.model_dump(mode="json"), separators=(",", ":"))
        pending_action_id = action.action_id if state == "EXECUTE" else None
        action_payload = json.dumps(action.model_dump(mode="json"), separators=(",", ":"))
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO sessions (
                    session_id, task, latest_snapshot_id, sanitized_context_json,
                    state, pending_action_id
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    context.task,
                    context.snapshot_id,
                    payload,
                    state,
                    pending_action_id,
                ),
            )
            connection.execute(
                """
                INSERT INTO actions (session_id, action_id, snapshot_id, action_json)
                VALUES (?, ?, ?, ?)
                """,
                (session_id, action.action_id, action.snapshot_id, action_payload),
            )

    def update_session(
        self,
        session_id: str,
        context: SanitizedContext,
        state: str,
        action: AgentAction,
    ) -> bool:
        payload = json.dumps(context.model_dump(mode="json"), separators=(",", ":"))
        pending_action_id = action.action_id if state == "EXECUTE" else None
        action_payload = json.dumps(action.model_dump(mode="json"), separators=(",", ":"))
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE sessions
                SET latest_snapshot_id = ?, sanitized_context_json = ?, state = ?,
                    pending_action_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ?
                """,
                (context.snapshot_id, payload, state, pending_action_id, session_id),
            )
            if cursor.rowcount == 1:
                connection.execute(
                    """
                    INSERT INTO actions (session_id, action_id, snapshot_id, action_json)
                    VALUES (?, ?, ?, ?)
                    """,
                    (session_id, action.action_id, action.snapshot_id, action_payload),
                )
        return cursor.rowcount == 1

    def get_session(self, session_id: str) -> SessionRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT session_id, latest_snapshot_id, state, pending_action_id
                FROM sessions WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
        if row is None:
            return None
        return SessionRecord(
            session_id=row["session_id"],
            latest_snapshot_id=row["latest_snapshot_id"],
            state=row["state"],
            pending_action_id=row["pending_action_id"],
        )

    def add_verification_and_transition(
        self,
        session_id: str,
        result: VerificationResult,
        state: str,
    ) -> bool:
        payload = json.dumps(result.model_dump(mode="json"), separators=(",", ":"))
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE sessions
                SET state = ?, pending_action_id = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ? AND pending_action_id = ?
                """,
                (state, session_id, result.action_id),
            )
            if cursor.rowcount == 1:
                connection.execute(
                    """
                    INSERT INTO verifications (session_id, action_id, result_json)
                    VALUES (?, ?, ?)
                    """,
                    (session_id, result.action_id, payload),
                )
        return cursor.rowcount == 1

    def session_exists(self, session_id: str) -> bool:
        return self.get_session(session_id) is not None
