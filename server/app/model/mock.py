import re
from uuid import uuid4

from app.schemas.contracts import (
    AgentAction,
    ClickAction,
    FinishAction,
    SanitizedContext,
    SelectAction,
    TypeHandleAction,
)


def _action_id() -> str:
    return f"act_{uuid4().hex}"


_ORDINALS = {
    "first": 0,
    "1st": 0,
    "second": 1,
    "2nd": 1,
    "third": 2,
    "3rd": 2,
    "fourth": 3,
    "4th": 3,
    "fifth": 4,
    "5th": 4,
}
_SET_VERBS = "select|check|tick|mark|enable|choose"
_CLEAR_VERBS = "clear|uncheck|untick|deselect|disable"


def _ordinal_control_requests(task: str) -> list[tuple[int, str, int, bool]]:
    pattern = re.compile(
        rf"\b(?P<verb>{_SET_VERBS}|{_CLEAR_VERBS})\s+(?:the\s+)?"
        rf"(?P<ordinal>{'|'.join(_ORDINALS)})\s+"
        r"(?P<kind>checkbox|radio(?:\s+button)?)\b",
        re.I,
    )
    requests: list[tuple[int, str, int, bool]] = []
    for match in pattern.finditer(task):
        ordinal = _ORDINALS[match.group("ordinal").lower()]
        kind = "radio" if match.group("kind").lower().startswith("radio") else "checkbox"
        desired = not re.fullmatch(_CLEAR_VERBS, match.group("verb"), re.I)
        requests.append((match.start(), kind, ordinal, desired))
    return requests


def _requested_named_state(task: str, names: list[str]) -> bool | None:
    usable_names = {
        name.strip()
        for name in names
        if len(name.strip()) >= 2 and not name.strip().isdigit()
    }
    for name in sorted(usable_names, key=len, reverse=True):
        escaped = re.escape(name)
        if not re.search(rf"(?<!\w){escaped}(?!\w)", task):
            continue
        return not bool(
            re.search(rf"\b(?:{_CLEAR_VERBS})\s+(?:the\s+)?{escaped}\b", task)
        )
    return None


def button_is_prohibited(task: str, visible_name: str) -> bool:
    normalized_task = task.lower().replace("-", " ")
    normalized_name = visible_name.lower().strip()
    if "submit" in normalized_name:
        return bool(
            re.search(
                r"\b(?:do\s+not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?submit\b",
                normalized_task,
            )
        )
    if "place order" in normalized_name:
        return bool(
            re.search(
                r"\b(?:do\s+not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?(?:place\s+(?:the\s+)?order|order)\b",
                normalized_task,
            )
        )
    if "continue" in normalized_name:
        return bool(
            re.search(
                r"\b(?:do\s+not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?continue\b",
                normalized_task,
            )
        )
    return False


class MockPlanner:
    """Deterministic planner used to prove the typed integration before Qwen."""

    def plan(self, context: SanitizedContext) -> AgentAction:
        task = context.task.lower().replace("-", " ")
        recognized_state_request = False
        visible_page_text = " ".join(
            value
            for element in context.elements
            for value in (element.text, element.label)
            if value
        ).lower()
        if (
            re.search(
                r"\b(?:controlled demo complete|order (?:was )?placed|booking confirmed|"
                r"form submitted successfully|task completed successfully)\b",
                visible_page_text,
            )
            and re.search(r"\b(?:complete|finish|order|book|submit|continue)\b", task)
        ):
            return FinishAction(
                type="FINISH",
                action_id=_action_id(),
                snapshot_id=context.snapshot_id,
                reason="The page visibly reports successful task completion",
                summary="The requested browser workflow is visibly complete.",
            )
        for element in context.elements:
            if element.enabled and element.value_handle:
                return TypeHandleAction(
                    type="TYPE_HANDLE",
                    action_id=_action_id(),
                    snapshot_id=context.snapshot_id,
                    element_id=element.id,
                    handle=element.value_handle,
                    reason="Fill the requested field using its device-local handle",
                )

        for element in sorted(context.elements, key=lambda candidate: candidate.dom_index):
            if not element.enabled or not element.options:
                continue
            candidates = [option for option in element.options if "select" not in option.lower()]
            if not candidates:
                continue

            requested = next(
                (option for option in candidates if option.lower() in task),
                None,
            )
            if requested is not None:
                recognized_state_request = True
                if requested == element.selected_option:
                    continue
                return SelectAction(
                    type="SELECT",
                    action_id=_action_id(),
                    snapshot_id=context.snapshot_id,
                    element_id=element.id,
                    option=requested,
                    reason="Choose the exact option requested by the user",
                )

            if not any(word in task for word in ("cheap", "lowest", "least expensive")):
                continue
            recognized_state_request = True

            def price(option: str) -> float:
                match = re.search(r"(?:₹|Rs\.?|INR|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)", option, re.I)
                if match is None:
                    return float("inf")
                try:
                    return float(match.group(1).replace(",", ""))
                except ValueError:
                    return float("inf")

            option = min(candidates, key=price)
            if option == element.selected_option:
                continue
            return SelectAction(
                type="SELECT",
                action_id=_action_id(),
                snapshot_id=context.snapshot_id,
                element_id=element.id,
                option=option,
                reason="Choose the lowest-priced available option exposed by the page",
            )

        ordered_controls = [
            element
            for element in sorted(context.elements, key=lambda candidate: candidate.dom_index)
            if element.enabled and element.role in {"checkbox", "radio"}
        ]
        for _, kind, ordinal, desired in _ordinal_control_requests(task):
            matching = [element for element in ordered_controls if element.role == kind]
            if ordinal >= len(matching):
                continue
            recognized_state_request = True
            element = matching[ordinal]
            if element.selected is desired:
                continue
            return ClickAction(
                type="CLICK",
                action_id=_action_id(),
                snapshot_id=context.snapshot_id,
                element_id=element.id,
                reason=f"Set the requested {kind} state using its grounded page order",
            )

        for element in ordered_controls:
            if not element.enabled or element.role not in {"checkbox", "radio"}:
                continue
            names = [
                value.lower().replace("-", " ")
                for value in (element.label, element.control_value, element.text)
                if value
            ]
            requested_state = _requested_named_state(task, names)
            if requested_state is None:
                continue
            recognized_state_request = True
            if element.selected is requested_state:
                continue
            return ClickAction(
                type="CLICK",
                action_id=_action_id(),
                snapshot_id=context.snapshot_id,
                element_id=element.id,
                reason="Set the checkbox or radio choice requested by the user",
            )

        button_intents = (
            (re.compile(r"\bcontinue\b"), "continue"),
            (re.compile(r"\bplace\s+(?:the\s+)?order\b"), "place order"),
            (re.compile(r"\bsubmit\b"), "submit"),
        )
        for task_pattern, desired_text in button_intents:
            if not task_pattern.search(task):
                continue
            for element in context.elements:
                visible_name = " ".join(filter(None, (element.text, element.label))).lower()
                if (
                    element.enabled
                    and element.role == "button"
                    and desired_text in visible_name
                    and not button_is_prohibited(task, visible_name)
                ):
                    return ClickAction(
                        type="CLICK",
                        action_id=_action_id(),
                        snapshot_id=context.snapshot_id,
                        element_id=element.id,
                        reason=f"The available {desired_text.title()} button advances the task",
                    )

        if recognized_state_request:
            return FinishAction(
                type="FINISH",
                action_id=_action_id(),
                snapshot_id=context.snapshot_id,
                reason="Every requested form state is already satisfied",
                summary="The requested form controls are now in the required state.",
            )

        return FinishAction(
            type="FINISH",
            action_id=_action_id(),
            snapshot_id=context.snapshot_id,
            reason="No deterministic next action is available",
            summary="The mock planner has no further safe action.",
        )
