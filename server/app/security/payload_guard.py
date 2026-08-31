import json
import re

from fastapi import HTTPException, status

from app.schemas import SanitizedContext

MAX_CONTEXT_BYTES = 2_500_000

OBVIOUS_SECRET_PATTERNS = (
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    re.compile(r"\b[A-Z0-9][A-Z0-9._-]{1,}@[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)"),
    re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
    re.compile(r"\b(?:password|otp)\s*[:=]\s*\S+", re.IGNORECASE),
)


def assert_sanitized_context(context: SanitizedContext) -> None:
    """Reject obvious privacy-boundary violations; the client remains authoritative."""
    encoded = json.dumps(context.model_dump(mode="json"), separators=(",", ":")).encode()
    if len(encoded) > MAX_CONTEXT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Sanitized context exceeds the server limit",
        )

    searchable_text = "\n".join(
        [context.task]
        + [
            part
            for element in context.elements
            for part in (element.text, element.label, *element.options)
            if part is not None
        ]
    )
    if any(pattern.search(searchable_text) for pattern in OBVIOUS_SECRET_PATTERNS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Payload appears to contain unsanitized sensitive data",
        )
