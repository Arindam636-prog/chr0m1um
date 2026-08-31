import type { AgentAction, SanitizedContext } from '@contextshield/shared';

export interface ActionProgressMarker {
  action: string;
  page: string;
}

function targetSignature(action: AgentAction, context: SanitizedContext): string | null {
  if (
    action.type === 'SCROLL' ||
    action.type === 'ASK_USER' ||
    action.type === 'FINISH'
  ) {
    return null;
  }
  const element = context.elements.find((candidate) => candidate.id === action.element_id);
  if (!element) return null;
  const target = [
    element.role,
    element.text,
    element.label,
    element.input_type,
    element.enabled,
    element.selected,
    element.value_present,
    element.options,
    element.selected_option,
    element.control_value,
  ];
  if (action.type === 'TYPE_HANDLE') return JSON.stringify([action.type, target, action.handle]);
  if (action.type === 'SELECT') return JSON.stringify([action.type, target, action.option]);
  return JSON.stringify([action.type, target]);
}

/** Creates a secret-free semantic marker for detecting repeated no-op actions. */
export function actionProgressMarker(
  action: AgentAction,
  context: SanitizedContext,
): ActionProgressMarker | null {
  const actionSignature = targetSignature(action, context);
  if (!actionSignature) return null;
  return {
    action: actionSignature,
    page: JSON.stringify({
      origin: context.origin,
      elements: context.elements.map((element) => [
        element.role,
        element.text,
        element.label,
        element.input_type,
        element.enabled,
        element.selected,
        element.value_present,
        element.options,
        element.selected_option,
        element.control_value,
      ]),
    }),
  };
}

export function isRepeatedNoProgress(
  previous: ActionProgressMarker | null,
  current: ActionProgressMarker | null,
): boolean {
  return Boolean(
    previous &&
      current &&
      previous.action === current.action &&
      previous.page === current.page,
  );
}
