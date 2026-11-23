import type { TestVersionRow, TestVersionStatus, VersionReason } from '@/types/testVersion';
import { cn } from '@/lib/utils';

export const VERSION_STATUS_LABEL: Record<TestVersionStatus, string> = {
  not_built: 'Not built',
  uploaded: 'Uploaded',
  unknown_build: 'Unknown build',
  update_available: 'Update available',
  rebuild_needed: 'Rebuild needed',
  up_to_date: 'Up to date',
  not_checked: 'Built, not checked',
};

export const VERSION_REASON_LABEL: Record<VersionReason, string> = {
  test_source_changed: 'test source changed',
  shared_changed: 'shared libraries changed',
  dependency_changed: 'an uploaded dependency changed',
  documentation_changed: 'documentation changed',
  modified_source: 'built from source that differs from the synced commit',
  no_stamp: 'built before versions were recorded',
};

const TONE: Record<TestVersionStatus, string> = {
  up_to_date: 'border-success/30 text-success',
  update_available: 'border-warning/30 bg-warning-dim text-warning',
  rebuild_needed: 'border-warning/30 bg-warning-dim text-warning',
  not_built: 'border-border bg-raised text-muted',
  uploaded: 'border-border bg-raised text-muted',
  unknown_build: 'border-border bg-raised text-muted',
  not_checked: 'border-border bg-raised text-muted',
};

/** First 7 characters of the commit the test was built from (synced when not built). */
export function shortCommit(row: TestVersionRow): string | null {
  const commit = row.built?.commit ?? row.synced?.commit ?? null;
  return commit ? commit.slice(0, 7) : null;
}

interface VersionStatusChipProps {
  row: TestVersionRow | undefined;
}

/** Status chip with the short commit (hidden below `sm`) and the update / Custom notes. */
export function VersionStatusChip({ row }: VersionStatusChipProps) {
  if (!row) return null;
  const commit = shortCommit(row);
  const reason = row.reason ? VERSION_REASON_LABEL[row.reason] : undefined;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <span
        title={reason}
        aria-label={reason ? `${VERSION_STATUS_LABEL[row.status]}: ${reason}` : undefined}
        className={cn(
          'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-[11px] font-medium',
          TONE[row.status],
        )}
      >
        {VERSION_STATUS_LABEL[row.status]}
      </span>
      {row.updateNote && <span className="whitespace-nowrap text-[11px] text-warning">update available</span>}
      {row.custom && <span className="whitespace-nowrap text-[11px] text-faint">Custom</span>}
      {commit && <span className="font-mono text-[11px] text-muted max-sm:hidden">{commit}</span>}
    </span>
  );
}
