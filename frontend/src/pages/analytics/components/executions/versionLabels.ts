import type { EnrichedTestExecution, ResultVersionState } from '@/services/api/analytics';

/** What a result's version state is called everywhere on the Executions screen (and in the CSV). */
export const VERSION_STATE_LABEL: Record<ResultVersionState, string> = {
  current: 'current',
  older: 'older',
  unknown: 'version unknown',
  not_recorded: 'not recorded',
};

/** Options of the Executions "Version" filter, in display order. */
export const VERSION_FILTER_OPTIONS: Array<{ value: ResultVersionState; label: string }> = [
  { value: 'older', label: 'Older version' },
  { value: 'current', label: 'Current version' },
  { value: 'unknown', label: 'Version unknown' },
  { value: 'not_recorded', label: 'Not recorded' },
];

/** First 7 characters of the commit the result's test was built from; '' for a custom test or no stamp. */
export function shortCommit(exec: EnrichedTestExecution): string {
  return exec.test_version?.commit?.slice(0, 7) ?? '';
}
