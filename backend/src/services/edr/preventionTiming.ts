// In-run prevention: an EDR action counts as prevention for a stage that
// exited 101 (it ran to completion) only when it happened before the run
// ended. EDRs also act after the fact: Defender
// blocks or quarantines a stage's file minutes after the stage exited 101
// (live, Nov 2026: Lumma's T1204.002 file "prevented" 7 minutes after the run,
// never as a running process). That is cleanup, not the EDR stopping the
// attack, so the result stays Detected. Error-coded results are not gated
// (alert-enrichment.service.ts inRunCutoffFor): the error fits the EDR having
// stopped the stage, and Defender keeps adding later activity to one alert
// for hours or days, so last activity is too loose a bound there (live: all
// 10 error-coded stages a gate would have dropped were such alerts).
//
// The latest moment an alert's action can have happened is its last activity
// (Defender `lastActivityDateTime`, stored as `last_activity_at` since sync
// v7). Vendors without it use the alert's own time (`created_at`), which for
// CrowdStrike, SentinelOne and Sophos is the detection / event time. An alert
// with neither keeps counting: there is nothing to judge it by.
//
// The result's `routing.event_time` is when the agent reported it, i.e. the
// end of the run (bundle stages share it). The slack covers clock differences
// between the endpoint, the EDR cloud and the console.

/** How long after the result's time an action still counts as "during the run". */
export const IN_RUN_SLACK_MS = 2 * 60 * 1000;

/** Alert `_source` fields actionTime() reads. */
export const ACTION_TIME_FIELDS = ['last_activity_at', 'created_at'];

const time = (v: unknown): number | null => {
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Latest time the alert's action can have happened, or null when the alert carries no time. */
export function actionTime(src: { last_activity_at?: unknown; created_at?: unknown }): number | null {
  return time(src.last_activity_at) ?? time(src.created_at);
}

/** The cut-off for a result: its time plus the slack, or null when the result has no usable time. */
export function inRunCutoff(resultTime: unknown): number | null {
  const t = time(resultTime);
  return t === null ? null : t + IN_RUN_SLACK_MS;
}

/** True when the alert's action can have happened during the run (unknown times count). */
export function actedInRun(src: { last_activity_at?: unknown; created_at?: unknown }, cutoff: number | null): boolean {
  if (cutoff === null) return true;
  const t = actionTime(src);
  return t === null || t <= cutoff;
}

/** ES filter equivalent of actedInRun() for one cut-off (used to filter the prevention aggregation). */
export function actedInRunClause(cutoff: number | null): Record<string, unknown> {
  if (cutoff === null) return { match_all: {} };
  const iso = new Date(cutoff).toISOString();
  return {
    bool: {
      should: [
        { range: { last_activity_at: { lte: iso } } },
        {
          bool: {
            must_not: [{ exists: { field: 'last_activity_at' } }],
            should: [
              { range: { created_at: { lte: iso } } },
              { bool: { must_not: [{ exists: { field: 'created_at' } }] } },
            ],
            minimum_should_match: 1,
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}
