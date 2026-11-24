import type {
  BuildVersionStamp,
  CurrentTestVersion,
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
 * Whether `a` was made from the source `b` describes. Equal fingerprints, or
 * the same library commit: with git, one commit is one set of files, so two
 * fingerprints of the same commit can only differ because the rule that
 * computes them changed (BUILD_INPUT_EXCLUDED_* in versionIdentity.ts). Without
 * a commit on both sides (no git, custom tests) only the fingerprint counts.
 * Callers pass a version they trust: a stamp that is not `modified`, or a
 * result that carries a fingerprint. The commit rule leans on that check as it
 * was made at build time, under the rule of that time: it is sound across a
 * rule change that only leaves more files out (the one made so far). A change
 * that makes the fingerprint count a file it ignored must not accept the same
 * commit for older stamps: a local edit to that file was not seen as modified.
 */
function sameSource(
  a: { fingerprint?: string | null; commit?: string | null },
  b: { fingerprint?: string | null; commit?: string | null },
): boolean {
  if (a.fingerprint && a.fingerprint === b.fingerprint) return true;
  return !!a.commit && a.commit === b.commit;
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

  if (!sameSource(built, synced)) {
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

/**
 * How the version recorded on a stored result relates to the one synced now.
 * A result without a fingerprint is unknown whatever else it carries: a task
 * gets a fingerprint (and a commit) only for a binary whose stamp could be
 * trusted (taskTestVersion), so the commit is never compared on its own.
 */
export function resultVersionState(
  v: Pick<TaskTestVersion, 'fingerprint' | 'commit'> | undefined,
  synced: CurrentTestVersion | undefined,
): ResultVersionState {
  if (!v) return 'not_recorded';
  if (!v.fingerprint || !synced) return 'unknown';
  return sameSource(v, synced) ? 'current' : 'older';
}

/**
 * The state of a result of one test, given the current version of every test
 * that can be read (uuid -> fingerprint and commit). The one rule for the
 * Executions rows, the campaign evidence matrix and the execution report: no
 * recorded version is not_recorded; a test missing from `current` (removed, or
 * its identity unreadable now) is unknown, never older.
 */
export function resultStateForTest(
  version: { fingerprint?: string; commit?: string } | undefined,
  testUuid: string,
  current: Map<string, CurrentTestVersion>,
): ResultVersionState {
  if (!version) return 'not_recorded';
  const synced = current.get(testUuid);
  if (synced === undefined) return 'unknown';
  return resultVersionState(version, synced);
}
