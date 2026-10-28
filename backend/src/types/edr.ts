// Types shared by every EDR integration (Defender, CrowdStrike, SentinelOne,
// and any vendor in services/outcomes/vendors.ts). Vendor type files
// re-export these names so older imports keep working.

export interface EnrichmentPassOptions {
  /** How far back to consider eligible test docs. Defaults to 90. */
  lookbackDays?: number;
  /** Test docs per msearch batch. Defaults to 200. */
  batchSize?: number;
  /** Hard cap on pass duration to avoid blocking the next sync. Defaults to 60000. */
  maxDurationMs?: number;
}

export interface EnrichmentPassResult {
  /** Eligible test docs examined. */
  scanned: number;
  /** Docs flipped to defender_detected:true in this pass (bundle-level match). */
  detected: number;
  /**
   * Docs flipped to defender_stage_detected:true in this pass — the stricter
   * stage-binary match. Subset of `detected` for new docs; can include
   * docs previously flagged at the bundle level that are now confirmed
   * stage-specific.
   */
  stageDetected: number;
  /** Docs skipped because the helper returned null (malformed input). */
  skipped: number;
  /** Number of msearch round-trips. */
  batches: number;
  /** Alerts tagged with f0rtika.achilles_correlated in this pass. */
  alertsMarkedCorrelated: number;
  /** Per-batch errors collected non-fatally. */
  errors: string[];
  /** Wall-clock duration of the pass. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Auto-resolve pillar
// ---------------------------------------------------------------------------

/**
 * Operational mode for the Defender auto-resolve pass.
 * - `disabled`: feature off, no ES or Graph calls
 * - `dry_run`: compute candidates and write receipts, but do NOT PATCH Defender
 * - `enabled`: PATCH Defender alerts to status=resolved
 */
export type AutoResolveMode = 'disabled' | 'dry_run' | 'enabled';

export interface AutoResolvePassOptions {
  /** Override the mode from settings (primarily for tests). */
  modeOverride?: AutoResolveMode;
  /** Max alerts to PATCH per pass (rate-limit guard). Defaults to 30. */
  maxPerPass?: number;
  /** Hard cap on pass duration. Defaults to 30000. */
  maxDurationMs?: number;
}

export interface AutoResolvePassResult {
  /** Mode the pass ran under. */
  mode: AutoResolveMode;
  /** Correlated + unresolved + not-yet-auto-resolved alert docs considered. */
  candidates: number;
  /** Alerts actually PATCHed to Defender (0 in dry-run). */
  patched: number;
  /** Alerts that would have been PATCHed in dry-run. */
  wouldPatch: number;
  /** Candidates skipped (e.g., malformed correlation fields). */
  skipped: number;
  /** Error messages collected non-fatally. */
  errors: string[];
  /** Wall-clock duration of the pass. */
  durationMs: number;
}
