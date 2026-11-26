import type { ScoreMovementResponse } from '@/services/api/analytics';

const emptyList = { total: 0, rows: [] };

/** The example response of the score movement spec, with the footer figures set. */
export const FULL: ScoreMovementResponse = {
  window: { from: '2026-10-27T12:00:00Z', to: '2026-11-26T12:00:00Z', label: '30d' },
  pairs: { start: 52, end: 289 },
  failing: { start: 4, end: 11 },
  scoreDifference: { fixedButCounted: 2, countedTwice: 1 },
  failures: {
    total: 46,
    fixed: 32,
    stillFailing: 6,
    notRetested: 5,
    leftUntested: 3,
    fixRate: 69.57,
    origins: { openAtStart: 4, olderRetested: 0, newTest: 35, firstOnEndpoint: 2, regression: 5 },
  },
  newTests: { tests: 31, pairs: 228, stopped: 193, gotThrough: 35, rate: 84.65, gotThroughFixed: 27, gotThroughOpen: 8 },
  regressed: { total: 5, fixed: 3 },
  firstOnEndpoint: { pairs: 12, stopped: 10 },
  riskAccepted: 4,
  lists: {
    fixed: emptyList,
    stillFailing: emptyList,
    notRetested: emptyList,
    leftUntested: emptyList,
    newStopped: emptyList,
    newGotThrough: emptyList,
  },
};
