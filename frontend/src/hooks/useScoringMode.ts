export type ScoringMode = 'all-stages' | 'any-stage';

/**
 * Returns the active scoring mode for analytics queries.
 *
 * The All-Stages / Any-Stage toggle was removed from the UI — kill-chain
 * semantics ("breaking one link breaks the chain") match how SOCs and
 * Red Teams operationally evaluate detection, so the user-facing surface
 * is locked to `'any-stage'`. The backend retains the parameter and the
 * `'all-stages'` code paths for completeness, but no caller exercises
 * the all-stages branch in the live app.
 *
 * The hook is kept (rather than inlining `'any-stage'`) so a future
 * reintroduction of the toggle — e.g. behind an Advanced setting — is
 * a localized change. `setScoringMode` is intentionally a no-op.
 */
export function useScoringMode() {
  return { scoringMode: 'any-stage' as const, setScoringMode: () => {} } as const;
}
