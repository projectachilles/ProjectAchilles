import { useState, useCallback } from 'react';

export type ScoringMode = 'all-stages' | 'any-stage';

const STORAGE_KEY = 'achilles-scoring-mode';

function readStoredMode(): ScoringMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'any-stage') return 'any-stage';
  } catch {
    // SSR or localStorage unavailable
  }
  return 'all-stages';
}

export function useScoringMode() {
  const [scoringMode, setScoringModeState] = useState<ScoringMode>(readStoredMode);

  const setScoringMode = useCallback((mode: ScoringMode) => {
    setScoringModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore write failures
    }
  }, []);

  return { scoringMode, setScoringMode } as const;
}
