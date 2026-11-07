import { describe, expect, it } from 'vitest';
import { parseRailwayJourney, RAILWAY_TASK, RAILWAY_WORKFLOW } from '../schemas/railwayTask';

describe('explicit railway booking request', () => {
  it('takes the journey from the user request, not UI defaults', () => {
    expect(parseRailwayJourney(RAILWAY_TASK)).toMatchObject({ from: 'HOWRAH JN - HWH', to: 'NEW DELHI - NDLS', date: '2026-10-15', age: '28' });
    const changed = RAILWAY_TASK.replace('2026-10-15', '2026-11-19').replace('AC 3 Tier (3A)', 'Sleeper (SL)').replace('age 28', 'age 35');
    expect(parseRailwayJourney(changed)).toMatchObject({ date: '2026-11-19', travelClass: 'Sleeper (SL)', age: '35' });
  });
  it('does not invent missing journey details or accept invalid dates', () => {
    expect(parseRailwayJourney(RAILWAY_WORKFLOW)).toBeNull();
    expect(parseRailwayJourney(RAILWAY_TASK.replace('2026-10-15', '2026-02-30'))).toBeNull();
    expect(parseRailwayJourney(RAILWAY_TASK.replace('age 28', 'age 0'))).toBeNull();
    expect(parseRailwayJourney(RAILWAY_TASK.replace('NEW DELHI - NDLS', 'HOWRAH JN - HWH'))).toBeNull();
  });
});
