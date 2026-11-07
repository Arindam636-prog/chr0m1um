import type {
  AgentAction,
  PageObservation,
  SanitizedContext,
  SanitizedElement,
} from "@contextshield/shared";

import { journeyMonthLabel, parseRailwayJourney, type RailwayJourney } from '@contextshield/shared/railway';
export { RAILWAY_TASK } from '@contextshield/shared/railway';

const JOURNEY_CONTROLS = new Set(['From', 'To', 'Travel class', 'Quota', 'Journey month', 'Passenger age', 'Passenger gender', 'Berth preference']);

/** Local execution view only. Never mutate the sanitized context or send this
 * view to Qwen. An NER false positive must not hide an explicitly requested
 * dropdown option from the on-device adapter. Private textboxes stay masked. */
function localJourneyElements(context: SanitizedContext, observation?: PageObservation): SanitizedElement[] {
  if (!observation) return context.elements;
  if (observation.snapshot_id !== context.snapshot_id || observation.origin !== context.origin) throw new Error('RAILWAY_OBSERVATION_MISMATCH');
  const observed = new Map(observation.elements.map((element) => [element.id, element]));
  return context.elements.map((element) => {
    const local = observed.get(element.id);
    if (!local || !local.visible || !local.enabled || local.role !== element.role) return element;
    const label = local.label ?? '';
    if (local.role === 'combobox' && local.tag === 'select' && JOURNEY_CONTROLS.has(label)) {
      return { ...element, label, options: [...local.options], selected_option: local.selected_option };
    }
    if (local.role === 'button' && local.tag === 'button' && /^(?:Choose journey date|(?:Selected journey date|Journey date) \d{4}-\d{2}-\d{2})$/.test(label)) {
      return { ...element, label };
    }
    return element;
  });
}
/** Explicitly selected, deterministic fixture controller. This is NOT Qwen or a general agent. */
export function planRailwayRehearsal(
  context: SanitizedContext,
  pageUrl: string,
  rehearsal = true,
  journey: RailwayJourney | null = parseRailwayJourney(context.task),
  localObservation?: PageObservation,
): AgentAction | null {
  const url = new URL(pageUrl);
  if (
    !["http://127.0.0.1:4173", "http://localhost:4173"].includes(url.origin) ||
    url.pathname !== "/railway.html"
  )
    return null;
  const base = {
    action_id: `act_rail_${crypto.randomUUID().replaceAll("-", "")}`,
    snapshot_id: context.snapshot_id,
    reason: rehearsal
      ? "Explicit local railway rehearsal; current visible controls only"
      : "Railway workflow adapter; exact observed control, subject to local authorization",
  };
  if (localObservation && localObservation.url !== pageUrl) throw new Error('RAILWAY_OBSERVATION_MISMATCH');
  const elements = localJourneyElements(context, localObservation).filter((el) => el.enabled);
  const name = (el: SanitizedElement) => (el.label || el.text || "").trim();
  const choose = (label: string, requested: string): AgentAction | null => {
    const field = elements.find((el) => el.role === 'combobox' && name(el) === label);
    if (!field || field.selected_option === requested) return null;
    if (!field.options.includes(requested)) throw new Error(`RAILWAY_REQUEST_UNAVAILABLE: ${label}`);
    return { ...base, type: 'SELECT', element_id: field.id, option: requested };
  };
  if (elements.some((el) => name(el) === 'Search trains')) {
    if (!journey) throw new Error('RAILWAY_REQUEST_UNAVAILABLE: Booking request');
    for (const [label, value] of [['From', journey.from], ['To', journey.to], ['Travel class', journey.travelClass], ['Quota', journey.quota]]) {
      if (!label || !value) continue;
      const action = choose(label, value);
      if (action) return action;
    }
    const month = elements.find((el) => el.role === 'combobox' && name(el) === 'Journey month');
    if (month) {
      const changeMonth = choose('Journey month', journeyMonthLabel(journey.date));
      if (changeMonth) return changeMonth;
      const day = elements.find((el) => el.role === 'button' && name(el) === `Journey date ${journey.date}`);
      if (!day) throw new Error('RAILWAY_REQUEST_UNAVAILABLE: Journey date');
      return { ...base, type: 'CLICK', element_id: day.id };
    }
    const date = elements.find((el) => el.role === 'button' && (name(el) === 'Choose journey date' || name(el).startsWith('Selected journey date ')));
    if (date && name(date) !== `Selected journey date ${journey.date}`) return { ...base, type: 'CLICK', element_id: date.id };
  }
  if (elements.some((el) => name(el) === "Simulated booking complete"))
    return {
      ...base,
      type: "FINISH",
      summary: rehearsal
        ? "Local rehearsal completed a simulated booking. No Qwen inference or real payment was used."
        : "Qwen-assisted railway workflow completed a simulated booking. Qwen compared fares; a local adapter handled the booking steps. No real payment was made.",
    };
  for (const kind of ["PERSON_NAME", "EMAIL", "PHONE"]) {
    const field = elements.find(
      (el) =>
        !el.value_present &&
        el.value_handle?.startsWith(`LOCAL_${kind}_`) &&
        /passenger/i.test(name(el)) &&
        el.role === "textbox",
    );
    if (field?.value_handle)
      return {
        ...base,
        type: "TYPE_HANDLE",
        element_id: field.id,
        handle: field.value_handle,
      };
  }
  if (journey) {
    for (const [label, value] of [['Passenger age', journey.age], ['Passenger gender', journey.gender], ['Berth preference', journey.berth]]) {
      if (!label || !value) continue;
      const action = choose(label, value);
      if (action) return action;
    }
  }
  const fares = elements
    .flatMap((el) => {
      const match =
        /^Choose train .+, departure (\d{2}):\d{2}, fare (\d+)$/.exec(name(el));
      return match && Number(match[1]) < 12
        ? [{ el, fare: Number(match[2]) }]
        : [];
    })
    .sort((a, b) => a.fare - b.fare);
  if (fares[0])
    return rehearsal
      ? { ...base, type: "CLICK", element_id: fares[0].el.id }
      : null;
  for (const text of [
    "Search trains",
    "Continue as demo traveller",
    "Review journey",
    "Continue to payment",
    "Pay simulated fare",
  ]) {
    const button = elements.find(
      (el) => el.role === "button" && name(el) === text,
    );
    if (button) return { ...base, type: "CLICK", element_id: button.id };
  }
  return null;
}
