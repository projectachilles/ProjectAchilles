// Types for tracking which version of a security test's source a built binary
// and a result came from.

export interface TestVersionIdentity {
  /** sha256 hex of uuid + source_hash + shared_hash */
  fingerprint: string;
  /** Build inputs inside the test folder */
  source_hash: string;
  /** Shared inputs (libraries, category shared/, signing helpers) */
  shared_hash: string;
  /** Git tree of the whole folder; null without git */
  test_tree: string | null;
  commit: string | null;
  /** ISO 8601 */
  commit_date: string | null;
  provenance: 'upstream' | 'custom';
}

export interface BuildVersionStamp extends TestVersionIdentity {
  /**
   * Uploaded embed dependencies (not source-built), hashed when the stamp is
   * written, after the build; null when none.
   */
  deps_hash: string | null;
  /**
   * Source-built embed dependencies (files and folders) as the build left
   * them; null when none exists. Absent on stamps written before it was
   * recorded: those are not compared on it.
   */
  outputs_hash?: string | null;
  modified: boolean;
  /**
   * Files the binary embeds that the fingerprint leaves out (by extension or
   * by name), relative to the test folder. Set only when there is at least
   * one. The fingerprint then says which source was built but not what the
   * binary carries, so such a build is never given a version results are
   * compared by (embedsLeftOutFiles in testVersionStatus.ts).
   */
  embeds_left_out?: string[];
  /** filename -> sha256 hex */
  binaries: Record<string, string>;
}

export interface TaskTestVersion {
  built_at: string;
  build_source: 'built' | 'uploaded';
  commit?: string;
  commit_date?: string;
  fingerprint?: string;
}

export type TestVersionStatus =
  | 'not_built'
  | 'uploaded'
  | 'unknown_build'
  | 'update_available'
  | 'rebuild_needed'
  | 'up_to_date'
  | 'not_checked';

export type VersionReason =
  | 'test_source_changed'
  | 'shared_changed'
  | 'dependency_changed'
  | 'documentation_changed'
  | 'modified_source'
  | 'embeds_excluded_file'
  | 'no_stamp';

export type ResultVersionState = 'current' | 'older' | 'unknown' | 'not_recorded';

/**
 * The version of one test that is synced now: what a build or a stored result
 * is compared with. `commit` is the library commit, null without git and for
 * custom tests.
 */
export interface CurrentTestVersion {
  fingerprint: string;
  commit: string | null;
}

/** One version of a test: the commit it is from and its content fingerprint. */
export interface VersionRef {
  commit: string | null;
  commitDate: string | null;
  fingerprint: string | null;
}

export interface TestVersionRow {
  status: TestVersionStatus;
  reason?: VersionReason;
  updateNote?: boolean;
  custom: boolean;
  published: VersionRef | null;
  synced: VersionRef | null;
  built: (VersionRef & { builtAt: string; signed: boolean }) | null;
}

export interface TestVersionsResponse {
  library: {
    gitEnabled: boolean;
    /** The timed check is on (git sync and TESTS_UPDATE_CHECK not 'off'). */
    checkEnabled: boolean;
    repoWebUrl: string | null;
    syncedCommit: string | null;
    syncedCommitDate: string | null;
    publishedCommit: string | null;
    publishedCommitDate: string | null;
    checkedAt: string | null;
    checkError: string | null;
    updatesAvailable: number;
    rebuildsNeeded: number;
    newTests: number;
  };
  tests: Record<string, TestVersionRow>;
}
