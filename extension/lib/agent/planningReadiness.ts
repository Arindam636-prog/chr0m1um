// A privacy model may conservatively mask an ordinary comparison word as a
// name. Do not send a changed optimization objective to a planner and let it
// guess. This check does not unmask anything or infer private values.
const COMPARISON = /\b(?:lowest|highest|cheapest|shortest|longest|fastest|slowest|earliest|latest|least expensive|most expensive)\b/gi;

export function comparisonCriterionWasRedacted(originalTask: string, sanitizedTask: string): boolean {
  const required = [...originalTask.matchAll(COMPARISON)].map((match) => match[0].toLowerCase());
  const retained = new Set([...sanitizedTask.matchAll(COMPARISON)].map((match) => match[0].toLowerCase()));
  return required.some((word) => !retained.has(word));
}
