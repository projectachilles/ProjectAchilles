import type {
  BuildVersionStamp,
  ResultVersionState,
  TaskTestVersion,
  TestVersionIdentity,
  TestVersionStatus,
  VersionReason,
} from '../../types/testVersion.js';

export interface StatusInput {
  build: { exists: boolean; source?: 'built' | 'uploaded'; version?: BuildVersionStamp };
  synced: TestVersionIdentity | undefined;
  /** undefined = not known */
  published: TestVersionIdentity | undefined;
  /** a check succeeded at least once */
  publishedKnown: boolean;
  /** false for custom tests and when git sync is off */
  hasGit: boolean;
  currentDepsHash: string | null;
  /**
   * Source-built embed dependencies now (BuildService.currentOutputsHash);
   * undefined = not applicable, not compared.
   */
  currentOutputsHash: string | null | undefined;
}

export interface DerivedStatus {
  status: TestVersionStatus;
  reason?: VersionReason;
  updateNote?: boolean;
}

/** Why two identities with different fingerprints differ. */
function changeReason(
  a: TestVersionIdentity,
  b: TestVersionIdentity,
): 'test_source_changed' | 'shared_changed' {
  return a.source_hash !== b.source_hash ? 'test_source_changed' : 'shared_changed';
}

/**
 * The single status shown for a test. First matching rule wins. `up_to_date`
 * is only returned when every comparison could actually be made.
 */
export function deriveStatus(i: StatusInput): DerivedStatus {
  const { build, synced } = i;
  // Published side is only meaningful with git and a successful check. A test
  // absent from a successful check was removed upstream: published = synced.
  const checked = i.hasGit && i.publishedKnown;
  const published = checked ? (i.published ?? synced) : undefined;

  if (!build.exists) {
    if (synced && published && published.fingerprint !== synced.fingerprint) {
      return { status: 'not_built', updateNote: true };
    }
    return { status: 'not_built' };
  }
  if (build.source === 'uploaded') return { status: 'uploaded' };

  const built = build.version;
  if (!built) return { status: 'unknown_build', reason: 'no_stamp' };
  if (built.modified) return { status: 'unknown_build', reason: 'modified_source' };
  if (!synced) return { status: 'unknown_build' };

  if (published) {
    if (published.fingerprint !== synced.fingerprint) {
      return { status: 'update_available', reason: changeReason(published, synced) };
    }
    if (published.test_tree !== synced.test_tree) {
      return { status: 'update_available', reason: 'documentation_changed' };
    }
  }

  if (built.fingerprint !== synced.fingerprint) {
    return { status: 'rebuild_needed', reason: changeReason(built, synced) };
  }
  if (built.deps_hash !== i.currentDepsHash) {
    return { status: 'rebuild_needed', reason: 'dependency_changed' };
  }
  // Source-built outputs only change when a build runs, and a build rewrites
  // the stamp: a difference means the files were changed after the build. A
  // stamp from before outputs_hash was recorded can't be compared on it.
  if (
    i.currentOutputsHash !== undefined &&
    built.outputs_hash !== undefined &&
    built.outputs_hash !== i.currentOutputsHash
  ) {
    return { status: 'rebuild_needed', reason: 'dependency_changed' };
  }

  if (i.hasGit && !i.publishedKnown) return { status: 'not_checked' };
  return { status: 'up_to_date' };
}

/** How the version recorded on a stored result relates to the synced one. */
export function resultVersionState(
  v: Pick<TaskTestVersion, 'fingerprint'> | undefined,
  syncedFingerprint: string | undefined,
): ResultVersionState {
  if (!v) return 'not_recorded';
  if (!v.fingerprint || !syncedFingerprint) return 'unknown';
  return v.fingerprint === syncedFingerprint ? 'current' : 'older';
}

/**
 * The state of a result of one test, given the current fingerprint of every
 * test that can be read (uuid -> fingerprint). The one rule for the Executions
 * rows and the campaign evidence matrix: no recorded version is not_recorded;
 * a test missing from `current` (removed, or its identity unreadable now) is
 * unknown, never older.
 */
export function resultStateForTest(
  version: { fingerprint?: string } | undefined,
  testUuid: string,
  current: Map<string, string>,
): ResultVersionState {
  if (!version) return 'not_recorded';
  const fingerprint = current.get(testUuid);
  if (fingerprint === undefined) return 'unknown';
  return resultVersionState(version, fingerprint);
}
