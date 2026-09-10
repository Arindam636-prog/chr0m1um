import json

from app.model.qwen import SYSTEM_PROMPT, QwenLlamaPlanner, _compact_element, _selection_note
from app.schemas import SanitizedContext


def test_compaction_preserves_false_states_and_omits_only_absent_metadata(safe_context):
    element = SanitizedContext.model_validate(safe_context).elements[0]
    element = element.model_copy(update={'enabled': False, 'selected': False, 'dom_index': 0})
    compact = _compact_element(element)
    assert compact['enabled'] is False
    assert compact['selected'] is False
    assert compact['dom_index'] == 0
    assert 'value_handle' not in compact
    assert 'options' not in compact


def test_selection_note_exposes_satisfied_price_without_claiming_other_goals(safe_context):
    element = SanitizedContext.model_validate(safe_context).elements[0].model_copy(update={
        'options': ['₹1,499 / Flex / 08:00', '₹899 / Saver / 09:15'],
        'selected_option': '₹899 / Saver / 09:15',
    })
    note = _selection_note(element)
    assert "Lowest displayed numeric price: '₹899 / Saver / 09:15'" in note
    assert 'Already selected: True' in note
    assert 'additional user constraints separately' in note


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self) -> bytes:
        return json.dumps(self._payload).encode()


def test_qwen_adapter_requests_schema_output_and_accepts_grounded_action(
    monkeypatch, safe_context
):
    captured: dict = {}

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        action = {
            "type": "CLICK",
            "action_id": "act_model_1",
            "snapshot_id": safe_context["snapshot_id"],
            "element_id": "el_1",
            "reason": "Continue with the enabled button",
        }
        return FakeResponse({"choices": [{"message": {"content": json.dumps(action)}}]})

    monkeypatch.setattr("app.model.qwen.urlopen", fake_urlopen)
    planner = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10)
    action = planner.plan(SanitizedContext.model_validate(safe_context))

    assert action.type == "CLICK"
    body = json.loads(captured["request"].data)
    assert body["response_format"]["type"] == "json_schema"
    assert body["temperature"] == 0
    assert body["max_tokens"] == 512
    assert "maxLength" not in json.dumps(body["response_format"]["json_schema"]["schema"])
    assert "Authoritative form-state notes" in body["messages"][1]["content"][0]["text"]


def test_qwen_does_not_reuse_a_previous_run_with_the_same_task(
    monkeypatch, safe_context
):
    calls = 0

    def fake_urlopen(_request, timeout):
        nonlocal calls
        assert timeout == 10
        calls += 1
        action = {
            "type": "CLICK",
            "action_id": f"act_model_{calls}",
            "snapshot_id": safe_context["snapshot_id"],
            "element_id": "el_1",
            "reason": "Continue with the enabled button",
        }
        return FakeResponse({"choices": [{"message": {"content": json.dumps(action)}}]})

    monkeypatch.setattr("app.model.qwen.urlopen", fake_urlopen)
    planner = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10)
    context = SanitizedContext.model_validate(safe_context)

    assert planner.plan(context).type == "CLICK"
    assert planner.plan(context).type == "CLICK"
    assert calls == 2


def test_qwen_followup_uses_a_safe_grounded_transition_without_reinference(
    monkeypatch, safe_context
):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("A safe post-model follow-up must not reinvoke Qwen")

    monkeypatch.setattr("app.model.qwen.urlopen", fail_if_called)
    action = QwenLlamaPlanner(
        "http://127.0.0.1:8080", "qwen", 10
    ).plan_followup(SanitizedContext.model_validate(safe_context))

    assert action.type == "CLICK"
    assert action.element_id == "el_1"


def test_followup_does_not_treat_a_satisfied_selection_as_the_whole_task(monkeypatch, safe_context):
    safe_context['task'] = 'Select Python. Then explain the remaining choices.'
    safe_context['elements'][0].update(text='Prepare ticket', label='Prepare ticket')
    safe_context['elements'].append({
        **safe_context['elements'][0], 'id': 'el_select', 'role': 'combobox',
        'input_type': 'select', 'text': None, 'label': 'Language',
        'options': ['Java', 'Python'], 'selected_option': 'Python',
    })
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request)
        action = {'type': 'FINISH', 'action_id': 'act_explain',
                  'snapshot_id': safe_context['snapshot_id'],
                  'reason': 'The selection and explanation are complete',
                  'summary': 'Python is selected. Java is the other available choice.'}
        return FakeResponse({'choices': [{'message': {'content': json.dumps(action)}}]})

    monkeypatch.setattr('app.model.qwen.urlopen', fake_urlopen)
    action = QwenLlamaPlanner('http://127.0.0.1:8080', 'qwen', 10).plan_followup(
        SanitizedContext.model_validate(safe_context))
    assert action.type == 'FINISH'
    assert 'Java' in action.summary
    assert len(calls) == 1


def test_qwen_sends_crop_bytes_once_and_bounds_third_party_dom(monkeypatch, safe_context):
    captured: dict = {}
    safe_context["safe_visual_crops"] = [
        {
            "id": "crop_1",
            "mime_type": "image/png",
            "sha256": "a" * 64,
            "width": 320,
            "height": 180,
            "data_base64": "A" * 12_000,
            "redaction_verified": True,
        }
    ]
    safe_context["elements"].extend(
        {
            "id": f"el_injected_{index}",
            "role": "link",
            "text": "Third-party injected toolbar item " + ("x" * 900),
            "label": f"Injected item {index}",
            "input_type": None,
            "value_handle": None,
            "enabled": True,
            "selected": None,
            "value_present": False,
            "options": [],
        }
        for index in range(200)
    )

    def fake_urlopen(request, timeout):
        captured["request"] = request
        action = {
            "type": "CLICK",
            "action_id": "act_model_bounded",
            "snapshot_id": safe_context["snapshot_id"],
            "element_id": "el_1",
            "reason": "Continue with the enabled button",
        }
        return FakeResponse({"choices": [{"message": {"content": json.dumps(action)}}]})

    monkeypatch.setattr("app.model.qwen.urlopen", fake_urlopen)
    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "CLICK"
    body = json.loads(captured["request"].data)
    prompt_text = body["messages"][1]["content"][0]["text"]
    assert "A" * 1_000 not in prompt_text
    assert len(prompt_text) < 25_000
    assert body["messages"][1]["content"][1]["image_url"]["url"].endswith(
        "A" * 12_000
    )


def test_qwen_adapter_replaces_invented_element_with_grounded_fallback(
    monkeypatch, safe_context
):
    action = {
        "type": "CLICK",
        "action_id": "act_model_2",
        "snapshot_id": safe_context["snapshot_id"],
        "element_id": "el_invented",
        "reason": "Invented target",
    }
    monkeypatch.setattr(
        "app.model.qwen.urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            {"choices": [{"message": {"content": json.dumps(action)}}]}
        ),
    )
    recovered = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert recovered.type == "CLICK"
    assert recovered.element_id == "el_1"


def test_qwen_prompt_defines_form_completion_semantics():
    assert "value_present applies to text-entry controls" in SYSTEM_PROMPT
    assert "selected_option" in SYSTEM_PROMPT
    assert "control_value" in SYSTEM_PROMPT
    assert "value_handle means a local value is AVAILABLE" in SYSTEM_PROMPT


def test_qwen_fills_grounded_local_handles_without_an_inference_round_trip(
    monkeypatch, safe_context
):
    safe_context["elements"].insert(
        0,
        {
            "id": "el_email",
            "role": "textbox",
            "text": None,
            "label": "Email",
            "input_type": "email",
            "value_handle": "LOCAL_EMAIL_1",
            "enabled": True,
            "selected": None,
            "value_present": False,
            "options": [],
            "selected_option": None,
            "control_value": None,
            "dom_index": 0,
        },
    )

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("Qwen must not receive an exact local-handle fill")

    monkeypatch.setattr("app.model.qwen.urlopen", fail_if_called)
    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "TYPE_HANDLE"
    assert action.element_id == "el_email"
    assert action.handle == "LOCAL_EMAIL_1"


def test_qwen_uses_grounded_fallback_when_model_repeats_completed_select(
    monkeypatch, safe_context
):
    safe_context["elements"].insert(
        0,
        {
            "id": "el_fare",
            "role": "combobox",
            "text": None,
            "label": "Choose a fare",
            "input_type": "select",
            "value_handle": None,
            "enabled": True,
            "selected": None,
            "value_present": True,
            "options": ["₹899 — Saver — 09:15"],
            "selected_option": "₹899 — Saver — 09:15",
        },
    )
    repeated = {
        "type": "SELECT",
        "action_id": "act_repeat",
        "snapshot_id": safe_context["snapshot_id"],
        "element_id": "el_fare",
        "option": "₹899 — Saver — 09:15",
        "reason": "Repeat the already selected fare",
    }
    monkeypatch.setattr(
        "app.model.qwen.urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            {"choices": [{"message": {"content": json.dumps(repeated)}}]}
        ),
    )

    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "CLICK"
    assert action.element_id == "el_1"


def test_qwen_keeps_defaulted_selects_and_control_semantics_in_prompt(
    monkeypatch, safe_context
):
    captured: dict = {}
    safe_context["task"] = (
        "Select Python from the first dropdown, select option 2, "
        "select the blue radio button, and stop."
    )
    safe_context["elements"] = [
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
            "selected_option": "JAVA",
            "control_value": None,
            "dom_index": 0,
        },
        {
            "id": "el_option_2",
            "role": "checkbox",
            "text": None,
            "label": "Option 2",
            "input_type": "checkbox",
            "value_handle": None,
            "enabled": True,
            "selected": False,
            "value_present": False,
            "options": [],
            "selected_option": None,
            "control_value": "option-2",
            "dom_index": 1,
        },
        {
            "id": "el_blue",
            "role": "radio",
            "text": None,
            "label": "blue",
            "input_type": "radio",
            "value_handle": None,
            "enabled": True,
            "selected": False,
            "value_present": False,
            "options": [],
            "selected_option": None,
            "control_value": "blue",
            "dom_index": 2,
        },
    ]

    def fake_urlopen(request, timeout):
        captured["request"] = request
        action = {
            "type": "SELECT",
            "action_id": "act_select_python",
            "snapshot_id": safe_context["snapshot_id"],
            "element_id": "el_select",
            "option": "Python",
            "reason": "Select the requested option from the first dropdown",
        }
        return FakeResponse({"choices": [{"message": {"content": json.dumps(action)}}]})

    monkeypatch.setattr("app.model.qwen.urlopen", fake_urlopen)
    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "SELECT"
    body = json.loads(captured["request"].data)
    prompt = body["messages"][1]["content"][0]["text"]
    assert '"selected_option":"JAVA"' in prompt
    assert '"control_value":"option-2"' in prompt
    assert '"control_value":"blue"' in prompt


def test_qwen_uses_grounded_fallback_for_malformed_model_json(
    monkeypatch, safe_context
):
    monkeypatch.setattr(
        "app.model.qwen.urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            {"choices": [{"message": {"content": "not-json"}}]}
        ),
    )

    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "CLICK"
    assert action.element_id == "el_1"


def test_qwen_rejects_submit_when_task_explicitly_forbids_it(
    monkeypatch, safe_context
):
    safe_context["task"] = "Fill the form. Do not submit it."
    safe_context["elements"] = [
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
            "dom_index": 0,
        }
    ]
    forbidden = {
        "type": "CLICK",
        "action_id": "act_forbidden_submit",
        "snapshot_id": safe_context["snapshot_id"],
        "element_id": "el_submit",
        "reason": "Submit the form",
    }
    monkeypatch.setattr(
        "app.model.qwen.urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            {"choices": [{"message": {"content": json.dumps(forbidden)}}]}
        ),
    )

    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "FINISH"


def test_qwen_rejects_unrequested_numeric_checkbox(monkeypatch, safe_context):
    safe_context["task"] = "Fill mobile LOCAL_PHONE_1 and select gender Male."
    safe_context["elements"] = [
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
            "dom_index": 0,
        }
    ]
    invented = {
        "type": "CLICK",
        "action_id": "act_unrequested_sports",
        "snapshot_id": safe_context["snapshot_id"],
        "element_id": "el_sports",
        "reason": "Choose hobby one",
    }
    monkeypatch.setattr(
        "app.model.qwen.urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            {"choices": [{"message": {"content": json.dumps(invented)}}]}
        ),
    )

    action = QwenLlamaPlanner("http://127.0.0.1:8080", "qwen", 10).plan(
        SanitizedContext.model_validate(safe_context)
    )

    assert action.type == "FINISH"
