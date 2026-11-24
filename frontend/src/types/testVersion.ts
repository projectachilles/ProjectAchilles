// Mirror of backend/src/types/testVersion.ts (response shapes of /api/browser/tests/versions).

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
  | 'no_stamp';

export type ResultVersionState = 'current' | 'older' | 'unknown' | 'not_recorded';

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
