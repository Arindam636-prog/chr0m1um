export interface RailwayJourney {
  from: string;
  to: string;
  date: string;
  travelClass: string;
  quota: string;
  age: string;
  gender: string;
  berth: string;
}

export const RAILWAY_WORKFLOW = 'complete the railway sandbox booking: click search trains; compare morning departures and choose the lowest fare; click continue as demo traveller; fill passenger full name, email and phone using local handles; click review journey, then continue to payment, then pay simulated fare. finish only when simulated booking complete is visible. no real purchase is authorized.';
export const RAILWAY_TASK = 'Book a train from HOWRAH JN - HWH to NEW DELHI - NDLS on 2026-10-15; travel class AC 3 Tier (3A); quota GENERAL; passenger age 28; gender Other; berth No preference. ' + RAILWAY_WORKFLOW;

/** Only the user's explicit request supplies itinerary values, never page prose. */
export function parseRailwayJourney(task: string): RailwayJourney | null {
  if (!task.endsWith(RAILWAY_WORKFLOW)) return null;
  const prefix = task.slice(0, -RAILWAY_WORKFLOW.length).trim();
  const match = /^Book a train from ([^;\n]+) to ([^;\n]+) on (\d{4}-\d{2}-\d{2}); travel class ([^;\n]+); quota ([^;\n]+); passenger age (\d{1,3}); gender ([^;\n]+); berth ([^;\n]+)\.$/i.exec(prefix);
  if (!match) return null;
  const [, from, to, date, travelClass, quota, age, gender, berth] = match;
  if (!from || !to || !date || !travelClass || !quota || !age || !gender || !berth || from === to || Number(age) < 1 || Number(age) > 120) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return { from: from.trim(), to: to.trim(), date, travelClass: travelClass.trim(), quota: quota.trim(), age, gender: gender.trim(), berth: berth.trim() };
}

export function journeyMonthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
