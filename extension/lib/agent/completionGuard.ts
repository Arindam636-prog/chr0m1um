import type { SanitizedContext } from '@contextshield/shared';

const BLOCKED_FINISH = /\b(?:cannot|can't|could not|couldn't|unable|failed|failure|not possible|not completed|incomplete|blocked|no actionable elements?|no further safe action|no (?:matching|requested|eligible|available|relevant|safe) (?:element|action|control|target|option)s?(?: (?:was|were))? found)\b/i;

const BUTTON_INTENTS: ReadonlyArray<{ task: RegExp; negative: RegExp; button: RegExp }> = [
  { task: /\bcontinue\b/i, negative: /\b(?:do not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?continue\b/i, button: /\bcontinue\b/i },
  { task: /\bplace\s+(?:the\s+)?order\b/i, negative: /\b(?:do not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?(?:place\s+(?:the\s+)?order|order)\b/i, button: /\bplace\s+order\b/i },
  { task: /\bsubmit\b/i, negative: /\b(?:do not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?submit\b/i, button: /\bsubmit\b/i },
];

function hasPendingRequestedButton(context: SanitizedContext): boolean {
  return BUTTON_INTENTS.some(
    (intent) =>
      intent.task.test(context.task) &&
      !intent.negative.test(context.task) &&
      context.elements.some((element) => {
        const name = [element.text, element.label].filter(Boolean).join(' ');
        return element.enabled && element.role === 'button' && intent.button.test(name);
      }),
  );
}

/** Prevents a planner's blocked/no-op FINISH from being presented as success. */
export function finishRepresentsSuccess(
  reason: string,
  summary: string,
  context?: SanitizedContext,
): boolean {
  return (
    !BLOCKED_FINISH.test(`${reason}\n${summary}`) &&
    (!context || !hasPendingRequestedButton(context))
  );
}
