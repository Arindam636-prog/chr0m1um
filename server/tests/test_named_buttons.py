import pytest

from app.model.mock import MockPlanner
from app.model.qwen import ModelInferenceError, QwenLlamaPlanner
from app.schemas import SanitizedContext


def test_exact_named_followup_and_negation(safe_context):
    safe_context['task'] = 'Compare the fares. Then click Prepare ticket. Do not purchase anything.'
    safe_context['elements'][0].update(text='Prepare ticket', label='Prepare ticket')
    planner = MockPlanner()
    assert planner.plan(SanitizedContext.model_validate(safe_context)).type == 'CLICK'
    safe_context['task'] = 'Do not click Prepare ticket.'
    assert planner.plan(SanitizedContext.model_validate(safe_context)).type != 'CLICK'
    safe_context['task'] = 'Click Prepare ticket.'
    safe_context['elements'].append({**safe_context['elements'][0], 'id': 'el_other'})
    assert planner.plan(SanitizedContext.model_validate(safe_context)).type != 'CLICK'


def test_qwen_cannot_bypass_negation_when_label_and_text_are_identical(safe_context):
    safe_context['task'] = 'Click Prepare ticket.'
    safe_context['elements'][0].update(text='Prepare ticket', label='Prepare ticket')
    action = MockPlanner().plan(SanitizedContext.model_validate(safe_context))
    safe_context['task'] = 'Do not click Prepare ticket.'
    with pytest.raises(ModelInferenceError, match='negative button instruction'):
        QwenLlamaPlanner._validate_grounding(action, SanitizedContext.model_validate(safe_context))
