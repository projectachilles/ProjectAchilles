import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tests } from '@/components/browser/detail/plural';
import { cn } from '@/lib/utils';
import type { TestVersionsResponse } from '@/types/testVersion';

type Library = TestVersionsResponse['library'];

/** True when the library has something to say: a counter, an error, or git sync being off. */
export function versionBannerVisible(library: Library): boolean {
  return (
    !library.gitEnabled ||
    library.checkError != null ||
    library.updatesAvailable > 0 ||
    library.rebuildsNeeded > 0 ||
    library.newTests > 0
  );
}

interface VersionBannerProps {
  library: Library;
  canSync: boolean;
  syncing: boolean;
  checking: boolean;
  /** Why the last Check now failed. */
  actionError?: string | null;
  onSync: () => void;
  onCheck: () => void;
}

export function VersionBanner({ library, canSync, syncing, checking, actionError, onSync, onCheck }: VersionBannerProps) {
  const lines: string[] = [];
  const { updatesAvailable: updates, rebuildsNeeded: rebuilds, newTests } = library;
  if (updates > 0) {
    lines.push(`${tests(updates)} ${updates === 1 ? 'has' : 'have'} a newer published version`);
  }
  if (rebuilds > 0) {
    lines.push(`${tests(rebuilds)} ${rebuilds === 1 ? 'needs' : 'need'} a rebuild`);
  }
  if (newTests > 0) {
    lines.push(`${newTests} new ${newTests === 1 ? 'test' : 'tests'} available`);
  }

  const showSync = canSync && (updates > 0 || newTests > 0);
  const showCheck = canSync && library.gitEnabled;

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-border bg-surface px-3 py-2 text-xs"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {lines.map((line) => (
          <span key={line} className="text-foreground">
            {line}
          </span>
        ))}
        {!library.gitEnabled && (
          <span className="text-muted">Git sync is off: published versions are not checked</span>
        )}
        {library.checkError != null && (
          <span className="text-warning" title={library.checkError}>
            Could not check for updates
          </span>
        )}
        {actionError && (
          <span role="alert" className="text-danger">
            {actionError}
          </span>
        )}
      </div>
      {(showSync || showCheck) && (
        <div className="flex items-center gap-2">
          {showSync && (
            <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
              <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
              Sync
            </Button>
          )}
          {showCheck && (
            <Button variant="outline" size="sm" onClick={onCheck} disabled={checking}>
              Check now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
