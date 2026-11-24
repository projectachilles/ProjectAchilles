import { tests } from '@/components/browser/detail/plural';
import type { TestVersionsResponse } from '@/types/testVersion';

type Library = TestVersionsResponse['library'];

/** True when the library has something to act on: a counter or a failed check. */
export function versionBannerVisible(library: Library): boolean {
  return (
    library.checkError != null ||
    library.updatesAvailable > 0 ||
    library.rebuildsNeeded > 0 ||
    library.newTests > 0
  );
}

interface VersionBannerProps {
  library: Library;
}

/** Information only: Sync and Check now live in the page header. */
export function VersionBanner({ library }: VersionBannerProps) {
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

  return (
    <div role="status" className="mb-4 rounded-[10px] border border-border bg-surface px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        {lines.map((line) => (
          <span key={line} className="text-foreground">
            {line}
          </span>
        ))}
        {library.checkError != null && (
          <span className="text-warning" title={library.checkError}>
            Could not check for updates
          </span>
        )}
      </div>
    </div>
  );
}
