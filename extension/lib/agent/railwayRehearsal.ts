import type {
  AgentAction,
  SanitizedContext,
  SanitizedElement,
} from "@contextshield/shared";

export const RAILWAY_TASK =
  "complete the railway sandbox booking: click search trains; compare morning departures and choose the lowest fare; click continue as demo traveller; fill passenger full name, email and phone using local handles; click review journey, then continue to payment, then pay simulated fare. finish only when simulated booking complete is visible. no real purchase is authorized.";
/** Explicitly selected, deterministic fixture controller. This is NOT Qwen or a general agent. */
export function planRailwayRehearsal(
  context: SanitizedContext,
  pageUrl: string,
  rehearsal = true,
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
  const elements = context.elements.filter((el) => el.enabled);
  const name = (el: SanitizedElement) => (el.label || el.text || "").trim();
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
