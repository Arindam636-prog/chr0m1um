import type { AgentAction, SanitizedContext, SanitizedElement } from '@contextshield/shared';

const SET_VERBS = 'select|check|tick|mark|enable|choose';
const CLEAR_VERBS = 'clear|uncheck|untick|deselect|disable';
const ORDINALS: Readonly<Record<string, number>> = {
  first: 0,
  '1st': 0,
  second: 1,
  '2nd': 1,
  third: 2,
  '3rd': 2,
  fourth: 3,
  '4th': 3,
  fifth: 4,
  '5th': 4,
};

const COMPLEX_REASONING = /\b(?:compare|recommend|best|cheapest|lowest|least\s+expensive|research|calculate|evaluate|rank|book|purchase|place\s+(?:the\s+)?order|find\s+the)\b/i;
const LOCAL_SUMMARY = /\b(?:describe|summari[sz]e|analyse|analyze)\b[\s\S]*\b(?:screen|page|visible|viewport)\b/i;
const SIMPLE_ACTION = /\b(?:fill|enter|type|use|add|provide|select|choose|check|tick|mark|enable|clear|uncheck|untick|deselect|disable|click|press|scroll)\b/i;
const HANDLE = /\bLOCAL_([A-Z0-9_]+)_\d+\b/g;

function actionId(): string {
  return `act_local_${crypto.randomUUID().replaceAll('-', '')}`;
}

function normalized(value: string): string {
  return value.toLowerCase().replaceAll('-', ' ').replace(/\s+/g, ' ').trim();
}

function visibleName(element: SanitizedElement): string {
  return [element.label, element.text, element.control_value]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .trim();
}

function taskContainsName(task: string, name: string): boolean {
  const candidate = normalized(name);
  return (
    candidate.length >= 2 &&
    !/^\d+$/.test(candidate) &&
    new RegExp(`(?<!\\w)${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'i').test(task)
  );
}

function requestedNamedState(task: string, element: SanitizedElement): boolean | null {
  const names = [element.label, element.text, element.control_value]
    .filter((value): value is string => Boolean(value))
    .map(normalized)
    .filter((value) => value.length >= 2 && !/^\d+$/.test(value));
  for (const name of [...new Set(names)].sort((left, right) => right.length - left.length)) {
    if (!taskContainsName(task, name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`\\b(?:${CLEAR_VERBS})\\s+(?:the\\s+)?${escaped}\\b`, 'i').test(task);
  }
  return null;
}

function ordinalRequests(task: string): Array<{ role: 'checkbox' | 'radio'; index: number; desired: boolean }> {
  const pattern = new RegExp(
    `\\b(?<verb>${SET_VERBS}|${CLEAR_VERBS})\\s+(?:the\\s+)?(?<ordinal>${Object.keys(ORDINALS).join('|')})\\s+(?<kind>checkbox|radio(?:\\s+button)?)\\b`,
    'gi',
  );
  const requests: Array<{ role: 'checkbox' | 'radio'; index: number; desired: boolean }> = [];
  for (const match of task.matchAll(pattern)) {
    const ordinal = match.groups?.ordinal?.toLowerCase();
    const verb = match.groups?.verb;
    const kind = match.groups?.kind;
    if (!ordinal || !verb || !kind) continue;
    const index = ORDINALS[ordinal];
    if (index === undefined) continue;
    requests.push({
      role: kind.toLowerCase().startsWith('radio') ? 'radio' : 'checkbox',
      index,
      desired: !new RegExp(`^(?:${CLEAR_VERBS})$`, 'i').test(verb),
    });
  }
  return requests;
}

function handleKind(handle: string): string | null {
  const match = /^LOCAL_([A-Z0-9_]+)_\d+$/.exec(handle);
  return match?.[1] ?? null;
}

function elementKinds(element: SanitizedElement): string[] {
  const label = normalized([element.label, element.text].filter(Boolean).join(' '));
  const kinds: string[] = [];
  if (element.input_type === 'email' || label.includes('email')) kinds.push('EMAIL');
  if (element.input_type === 'tel' || /\b(?:phone|mobile)\b/.test(label)) kinds.push('PHONE');
  if (element.input_type === 'password' || label.includes('password')) kinds.push('PASSWORD');
  if (label.includes('first name')) kinds.push('GIVEN_NAME', 'PERSON_NAME');
  if (label.includes('last name')) kinds.push('SURNAME', 'PERSON_NAME');
  if (label.includes('full name') || (label.includes('name') && kinds.length === 0)) kinds.push('PERSON_NAME');
  if (label.includes('address')) kinds.push('ADDRESS');
  if (label.includes('upi')) kinds.push('UPI_ID');
  if (label.includes('otp')) kinds.push('OTP');
  if (label.includes('username') || label.includes('user name')) kinds.push('USERNAME');
  if (element.input_type === 'search' || label.includes('search') || label.includes('text input')) kinds.push('TEXT');
  return kinds;
}

function taskRequestsHandle(task: string, element: SanitizedElement): boolean {
  const handle = element.value_handle;
  if (!handle) return false;
  if (task.includes(handle.toLowerCase())) return true;
  if (!/\b(?:fill|enter|type|use|add|provide)\b/i.test(task)) return false;
  const kind = handleKind(handle);
  if (!kind || !elementKinds(element).includes(kind)) return false;
  const fieldWords: Readonly<Record<string, RegExp>> = {
    EMAIL: /\bemail\b/i,
    PHONE: /\b(?:phone|mobile)\b/i,
    PASSWORD: /\bpassword\b/i,
    GIVEN_NAME: /\bfirst\s+name\b/i,
    SURNAME: /\blast\s+name\b/i,
    PERSON_NAME: /\b(?:full\s+)?name\b/i,
    ADDRESS: /\baddress\b/i,
    UPI_ID: /\bupi\b/i,
    OTP: /\botp\b/i,
    USERNAME: /\buser\s*name\b/i,
    TEXT: /\b(?:text\s+input|search(?:\s+(?:query|box))?)\b/i,
  };
  return fieldWords[kind]?.test(task) ?? false;
}

function allTaskHandlesSatisfied(context: SanitizedContext): boolean {
  const requested = [...context.task.matchAll(HANDLE)].map((match) => ({
    handle: match[0],
    kind: match[1] ?? '',
  }));
  return requested.every(({ handle, kind }) =>
    context.elements.some(
      (element) =>
        element.enabled &&
        elementKinds(element).includes(kind) &&
        (element.value_present || element.value_handle === handle),
    ),
  );
}

function localScreenSummary(context: SanitizedContext): string {
  const interactive = context.elements.filter((element) =>
    ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab'].includes(element.role),
  );
  const visual = context.elements.filter((element) =>
    element.sources?.some((source) => source === 'VISION' || source === 'OCR'),
  );
  const names = interactive
    .map(visibleName)
    .filter(Boolean)
    .slice(0, 6);
  const detail = names.length ? ` Visible controls include ${names.join(', ')}.` : '';
  return `Local screen analysis found ${interactive.length} interactive elements and ${visual.length} pixel-derived records.${detail}`;
}

function finish(context: SanitizedContext, summary: string): AgentAction {
  return {
    type: 'FINISH',
    action_id: actionId(),
    snapshot_id: context.snapshot_id,
    reason: 'The locally owned task is visibly satisfied without server inference',
    summary,
  };
}

/**
 * Returns a strictly grounded local action for simple tasks, or null when the
 * sanitized context requires server reasoning. It never invents values or IDs.
 */
export function planLocalAction(context: SanitizedContext): AgentAction | null {
  const task = normalized(context.task);
  if (LOCAL_SUMMARY.test(task)) return finish(context, localScreenSummary(context));
  if (COMPLEX_REASONING.test(task) || !SIMPLE_ACTION.test(task)) return null;

  for (const element of context.elements) {
    if (
      element.enabled &&
      !element.value_present &&
      element.value_handle &&
      taskRequestsHandle(task, element)
    ) {
      return {
        type: 'TYPE_HANDLE',
        action_id: actionId(),
        snapshot_id: context.snapshot_id,
        element_id: element.id,
        handle: element.value_handle,
        reason: 'An exact device-local handle can be filled without server inference',
      };
    }
  }

  for (const element of context.elements) {
    if (!element.enabled || element.options.length === 0) continue;
    const requested = element.options.find((option) => taskContainsName(task, option));
    if (!requested || requested === element.selected_option) continue;
    return {
      type: 'SELECT',
      action_id: actionId(),
      snapshot_id: context.snapshot_id,
      element_id: element.id,
      option: requested,
      reason: 'The exact requested option is grounded locally',
    };
  }

  const orderedControls = context.elements
    .filter((element) => element.enabled && (element.role === 'checkbox' || element.role === 'radio'))
    .sort((left, right) => left.dom_index - right.dom_index);
  const orderedRequests = ordinalRequests(task);
  for (const request of orderedRequests) {
    const controls = orderedControls.filter((element) => element.role === request.role);
    const element = controls[request.index];
    if (!element || element.selected === request.desired) continue;
    return {
      type: 'CLICK',
      action_id: actionId(),
      snapshot_id: context.snapshot_id,
      element_id: element.id,
      reason: 'The requested control state is grounded by local page order',
    };
  }

  for (const element of orderedControls) {
    const requested = requestedNamedState(task, element);
    if (requested === null || element.selected === requested) continue;
    return {
      type: 'CLICK',
      action_id: actionId(),
      snapshot_id: context.snapshot_id,
      element_id: element.id,
      reason: 'The named checkbox or radio state is grounded locally',
    };
  }

  const scroll = /\bscroll\s+(?<direction>up|down)\b/i.exec(task);
  if (scroll?.groups?.direction) {
    return {
      type: 'SCROLL',
      action_id: actionId(),
      snapshot_id: context.snapshot_id,
      direction: scroll.groups.direction.toUpperCase() as 'UP' | 'DOWN',
      amount: 700,
      reason: 'The user requested a simple local scroll',
    };
  }

  const buttons = context.elements.filter((element) => element.enabled && element.role === 'button');
  for (const element of buttons) {
    const name = visibleName(element);
    if (!name || !taskContainsName(task, name)) continue;
    const escapedName = normalized(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const explicitClick = new RegExp(
      `\\b(?:click|press)\\s+(?:the\\s+)?${escapedName}\\b`,
      'i',
    ).test(task);
    const directNavigationButton =
      /^(?:continue|next|back|finish|save)$/i.test(name.trim()) &&
      new RegExp(`\\b${escapedName}\\b`, 'i').test(task);
    if (!explicitClick && !directNavigationButton) continue;
    if (/\b(?:do\s+not|don't|never)\s+(?:click\s+|press\s+)?(?:the\s+)?submit\b/i.test(task) && /submit/i.test(name)) continue;
    return {
      type: 'CLICK',
      action_id: actionId(),
      snapshot_id: context.snapshot_id,
      element_id: element.id,
      reason: 'The exact named button is grounded locally',
    };
  }

  const handlesSatisfied = allTaskHandlesSatisfied(context);
  const orderedSatisfied = orderedRequests.every((request) => {
    const controls = orderedControls.filter((element) => element.role === request.role);
    return controls[request.index]?.selected === request.desired;
  });
  const namedControls = orderedControls.filter((element) => requestedNamedState(task, element) !== null);
  const namedSatisfied = namedControls.every(
    (element) => element.selected === requestedNamedState(task, element),
  );
  const requestedOptionExists = context.elements.some((element) =>
    element.options.some((option) => taskContainsName(task, option)),
  );
  const implicitFieldSatisfied = context.elements.some(
    (element) =>
      element.value_present &&
      elementKinds(element).some((kind) => {
        const words: Readonly<Record<string, RegExp>> = {
          EMAIL: /\bemail\b/i,
          PHONE: /\b(?:phone|mobile)\b/i,
          PASSWORD: /\bpassword\b/i,
          GIVEN_NAME: /\bfirst\s+name\b/i,
          SURNAME: /\blast\s+name\b/i,
          PERSON_NAME: /\b(?:full\s+)?name\b/i,
          ADDRESS: /\baddress\b/i,
          UPI_ID: /\bupi\b/i,
          OTP: /\botp\b/i,
          USERNAME: /\buser\s*name\b/i,
          TEXT: /\b(?:text\s+input|search(?:\s+(?:query|box))?)\b/i,
        };
        return words[kind]?.test(task) ?? false;
      }),
  );
  const optionsSatisfied = context.elements.every((element) => {
    const requested = element.options.find((option) => taskContainsName(task, option));
    return !requested || requested === element.selected_option;
  });
  const recognized =
    [...context.task.matchAll(HANDLE)].length > 0 ||
    orderedRequests.length > 0 ||
    namedControls.length > 0 ||
    requestedOptionExists ||
    implicitFieldSatisfied;

  return recognized && handlesSatisfied && orderedSatisfied && namedSatisfied && optionsSatisfied
    ? finish(context, 'The requested simple form and control states are complete locally.')
    : null;
}
