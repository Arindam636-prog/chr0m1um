from app.model.mock import MockPlanner
from app.schemas import SanitizedContext

TASK = (
    "Select Python from the first dropdown, select option 2, "
    "select the blue radio button, and stop."
)


def context(selected_option: str, option_two: bool, blue: bool) -> SanitizedContext:
    return SanitizedContext.model_validate(
        {
            "task": TASK,
            "origin": "https://example.com",
            "snapshot_id": f"snap_{selected_option}_{option_two}_{blue}",
            "elements": [
                {
                    "id": "el_select",
                    "role": "combobox",
                    "text": None,
                    "label": None,
                    "input_type": "select",
                    "value_handle": None,
                    "enabled": True,
                    "selected": None,
                    "value_present": True,
                    "options": ["JAVA", "C#", "Python", "SQL"],
                    "selected_option": selected_option,
                    "control_value": None,
                    "dom_index": 0,
                },
                {
                    "id": "el_option_1",
                    "role": "checkbox",
                    "text": None,
                    "label": "Option 1",
                    "input_type": "checkbox",
                    "value_handle": None,
                    "enabled": True,
                    "selected": False,
                    "value_present": False,
                    "options": [],
                    "selected_option": None,
                    "control_value": "option-1",
                    "dom_index": 1,
                },
                {
                    "id": "el_option_2",
                    "role": "checkbox",
                    "text": None,
                    "label": "Option 2",
                    "input_type": "checkbox",
                    "value_handle": None,
                    "enabled": True,
                    "selected": option_two,
                    "value_present": False,
                    "options": [],
                    "selected_option": None,
                    "control_value": "option-2",
                    "dom_index": 2,
                },
                {
                    "id": "el_green",
                    "role": "radio",
                    "text": None,
                    "label": "Green",
                    "input_type": "radio",
                    "value_handle": None,
                    "enabled": True,
                    "selected": not blue,
                    "value_present": False,
                    "options": [],
                    "selected_option": None,
                    "control_value": "green",
                    "dom_index": 3,
                },
                {
                    "id": "el_blue",
                    "role": "radio",
                    "text": None,
                    "label": "Blue",
                    "input_type": "radio",
                    "value_handle": None,
                    "enabled": True,
                    "selected": blue,
                    "value_present": False,
                    "options": [],
                    "selected_option": None,
                    "control_value": "blue",
                    "dom_index": 4,
                },
            ],
            "safe_visual_crops": [],
            "privacy_summary": {},
        }
    )


def test_deterministic_fallback_completes_common_form_controls_in_order():
    planner = MockPlanner()

    first = planner.plan(context("JAVA", False, False))
    assert first.type == "SELECT"
    assert first.element_id == "el_select"
    assert first.option == "Python"

    second = planner.plan(context("Python", False, False))
    assert second.type == "CLICK"
    assert second.element_id == "el_option_2"

    third = planner.plan(context("Python", True, False))
    assert third.type == "CLICK"
    assert third.element_id == "el_blue"

    complete = planner.plan(context("Python", True, True))
    assert complete.type == "FINISH"
    assert "satisfied" in complete.reason


def ordinal_checkbox_context(first: bool, second: bool) -> SanitizedContext:
    return SanitizedContext.model_validate(
        {
            "task": "Select the first checkbox and clear the second checkbox.",
            "origin": "https://the-internet.herokuapp.com",
            "snapshot_id": f"snap_ordinal_{first}_{second}",
            "elements": [
                {
                    "id": "el_first",
                    "role": "checkbox",
                    "text": None,
                    "label": "checkbox 1",
                    "input_type": "checkbox",
                    "value_handle": None,
                    "enabled": True,
                    "selected": first,
                    "value_present": False,
                    "options": [],
                    "selected_option": None,
                    "control_value": None,
                    "dom_index": 0,
                },
                {
                    "id": "el_second",
                    "role": "checkbox",
                    "text": None,
                    "label": "checkbox 2",
                    "input_type": "checkbox",
                    "value_handle": None,
                    "enabled": True,
                    "selected": second,
                    "value_present": False,
                    "options": [],
                    "selected_option": None,
                    "control_value": None,
                    "dom_index": 1,
                },
            ],
            "safe_visual_crops": [],
            "privacy_summary": {},
        }
    )


def test_deterministic_fallback_handles_ordinal_checked_and_cleared_states():
    planner = MockPlanner()

    first = planner.plan(ordinal_checkbox_context(False, True))
    assert first.type == "CLICK"
    assert first.element_id == "el_first"

    second = planner.plan(ordinal_checkbox_context(True, True))
    assert second.type == "CLICK"
    assert second.element_id == "el_second"

    complete = planner.plan(ordinal_checkbox_context(True, False))
    assert complete.type == "FINISH"
    assert "satisfied" in complete.reason


def test_deterministic_fallback_does_not_finish_before_place_the_order():
    page = context("Python", True, True)
    page.task = "Continue and place the order."
    page.elements.append(
        page.elements[0].model_copy(
            update={
                "id": "el_place_order",
                "role": "button",
                "text": "Place order",
                "label": None,
                "input_type": None,
                "options": [],
                "selected_option": None,
                "value_present": False,
                "dom_index": 5,
            }
        )
    )

    action = MockPlanner().plan(page)
    assert action.type == "CLICK"
    assert action.element_id == "el_place_order"


def demoqa_context(filled: set[str], male: bool) -> SanitizedContext:
    task = (
        "Fill first name LOCAL_GIVEN_NAME_1, last name LOCAL_SURNAME_1, "
        "email LOCAL_EMAIL_1, gender Male, mobile LOCAL_PHONE_1, and "
        "address LOCAL_ADDRESS_1. Do not submit it."
    )
    fields = [
        ("el_first", "First Name", "LOCAL_GIVEN_NAME_1"),
        ("el_last", "Last Name", "LOCAL_SURNAME_1"),
        ("el_email", "Email", "LOCAL_EMAIL_1"),
        ("el_mobile", "Mobile Number", "LOCAL_PHONE_1"),
        ("el_address", "Current Address", "LOCAL_ADDRESS_1"),
    ]
    elements = [
        {
            "id": element_id,
            "role": "textbox",
            "text": None,
            "label": label,
            "input_type": "text",
            "value_handle": None if element_id in filled else handle,
            "enabled": True,
            "selected": None,
            "value_present": element_id in filled,
            "options": [],
            "selected_option": None,
            "control_value": None,
            "dom_index": index,
        }
        for index, (element_id, label, handle) in enumerate(fields)
    ]
    elements.extend(
        [
            {
                "id": "el_male",
                "role": "radio",
                "text": None,
                "label": "Male",
                "input_type": "radio",
                "value_handle": None,
                "enabled": True,
                "selected": male,
                "value_present": False,
                "options": [],
                "selected_option": None,
                "control_value": "Male",
                "dom_index": 5,
            },
            {
                "id": "el_sports",
                "role": "checkbox",
                "text": None,
                "label": "Sports",
                "input_type": "checkbox",
                "value_handle": None,
                "enabled": True,
                "selected": False,
                "value_present": False,
                "options": [],
                "selected_option": None,
                "control_value": "1",
                "dom_index": 6,
            },
            {
                "id": "el_submit",
                "role": "button",
                "text": "Submit",
                "label": None,
                "input_type": None,
                "value_handle": None,
                "enabled": True,
                "selected": None,
                "value_present": False,
                "options": [],
                "selected_option": None,
                "control_value": None,
                "dom_index": 7,
            },
        ]
    )
    return SanitizedContext.model_validate(
        {
            "task": task,
            "origin": "https://demoqa.com",
            "snapshot_id": f"snap_demoqa_{len(filled)}_{male}",
            "elements": elements,
            "safe_visual_crops": [],
            "privacy_summary": {},
        }
    )


def test_deterministic_fallback_fills_demoqa_and_obeys_do_not_submit():
    planner = MockPlanner()
    field_ids = {"el_first", "el_last", "el_email", "el_mobile", "el_address"}

    first = planner.plan(demoqa_context(set(), False))
    assert first.type == "TYPE_HANDLE"
    assert first.element_id == "el_first"

    gender = planner.plan(demoqa_context(field_ids, False))
    assert gender.type == "CLICK"
    assert gender.element_id == "el_male"

    complete = planner.plan(demoqa_context(field_ids, True))
    assert complete.type == "FINISH"
    assert "satisfied" in complete.reason
