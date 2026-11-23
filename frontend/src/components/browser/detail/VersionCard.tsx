import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { VERSION_REASON_LABEL, VERSION_STATUS_LABEL } from '@/components/browser/VersionStatusChip';
import { useHasPermission } from '@/hooks/useAppRole';
import type { UseTestVersions } from '@/hooks/useTestVersions';
import { formatFullDate, formatRelativeDate } from '@/utils/dateFormatters';
import type { BuildInfo } from '@/types/test';
import type { TestVersionRow, TestVersionsResponse, VersionRef } from '@/types/testVersion';

interface VersionCardProps {
  uuid: string;
  /** The page's single `useTestVersions()` result. */
  versions: UseTestVersions;
  /** The build panel is building: Build & Sign waits. */
  building?: boolean;
  /** The build panel refuses to build until external dependencies are uploaded. */
  missingDeps?: boolean;
  /** Starts the page's build. The Build & Sign button needs this and `canBuild`. */
  onBuild?: () => void;
  /** `tests:builds:create` on a test with source. */
  canBuild: boolean;
  /** The page's build state; the versions are re-read when a build finishes or is deleted. */
  buildInfo?: BuildInfo | null;
}

const short = (commit: string) => commit.slice(0, 7);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] text-foreground">{children}</span>
    </div>
  );
}

function When({ iso, prefix = '', suffix = '' }: { iso: string | null; prefix?: string; suffix?: string }) {
  if (!iso) return suffix ? <span className="text-muted">{`${prefix}${suffix}`.trim()}</span> : null;
  return (
    <time dateTime={iso} title={formatFullDate(iso)} className="text-muted">
      {`${prefix}${formatRelativeDate(iso)}${suffix}`}
    </time>
  );
}

function RefValue({ version, fallback }: { version: VersionRef | null; fallback: string }) {
  if (!version?.commit) return <span className="text-muted">{fallback}</span>;
  return (
    <>
      <span className="font-mono text-xs">{short(version.commit)}</span>
      <When iso={version.commitDate} />
    </>
  );
}

/** The two commits behind "View changes on GitHub", older first. */
function comparison(row: TestVersionRow): [string, string] | null {
  const pair =
    row.status === 'update_available'
      ? [row.synced?.commit, row.published?.commit]
      : row.status === 'rebuild_needed'
        ? [row.built?.commit, row.synced?.commit]
        : [];
  const [from, to] = pair;
  return from && to && from !== to ? [from, to] : null;
}

/** Published / synced / built version of one test, with the next step. Read-only for everyone who can see the test. */
export default function VersionCard({ uuid, versions, building, missingDeps, onBuild, canBuild, buildInfo }: VersionCardProps) {
  const { data, checking, checkNow, checkError, reload } = versions;
  // The first load of the build state (null -> loaded) is not a change.
  const lastBuildInfo = useRef(buildInfo);
  useEffect(() => {
    if (lastBuildInfo.current && lastBuildInfo.current !== buildInfo) void reload();
    lastBuildInfo.current = buildInfo;
  }, [buildInfo, reload]);
  const canCheck = useHasPermission('tests:sync:execute');
  const row = data?.tests[uuid];
  if (!data || !row) return null;

  const library: TestVersionsResponse['library'] = data.library;
  const { status, reason, built, synced, published } = row;

  const sameAsPublished = !!published?.fingerprint && published.fingerprint === synced?.fingerprint;
  const showPublished = !row.custom && library.gitEnabled;
  const range = library.repoWebUrl ? comparison(row) : null;

  const wantsBuild = status === 'not_built' || status === 'rebuild_needed' || status === 'unknown_build';

  return (
    <section aria-labelledby={`version-card-${uuid}`} className="rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 id={`version-card-${uuid}`} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
          Version
        </h2>
        {row.custom && <span className="text-[11px] text-faint">Custom</span>}
      </header>
      <div className="space-y-3 p-4">
        <p className="text-[13px] font-medium text-foreground">
          {reason ? `${VERSION_STATUS_LABEL[status]}: ${VERSION_REASON_LABEL[reason]}` : VERSION_STATUS_LABEL[status]}
        </p>
        {status === 'not_built' && row.updateNote && (
          <p className="text-xs text-warning">A newer version is published. Sync first, then build.</p>
        )}

        <div className="space-y-2">
          {showPublished && (
            <Row label="Published">
              <RefValue version={published} fallback="not checked yet" />
            </Row>
          )}
          <Row label="Synced">
            <RefValue version={synced} fallback={row.custom ? 'local source' : 'not synced'} />
            {sameAsPublished && <span className="text-muted">same as published</span>}
          </Row>
          <Row label="Built">
            {built ? (
              <>
                {built.commit || built.fingerprint ? (
                  built.commit && <span className="font-mono text-xs">{short(built.commit)}</span>
                ) : (
                  <span className="text-muted">version not recorded</span>
                )}
                <When iso={built.builtAt} prefix="built " suffix={built.signed ? ', signed' : ', unsigned'} />
              </>
            ) : (
              <span className="text-muted">not built</span>
            )}
          </Row>
        </div>

        {(checkError || range || wantsBuild || status === 'update_available' || status === 'not_checked') && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {wantsBuild && canBuild && onBuild && (
              <div className="flex flex-col gap-1">
                <Button size="sm" onClick={onBuild} disabled={building || missingDeps}>
                  {building ? 'Building…' : 'Build & Sign'}
                </Button>
                {missingDeps && !building && (
                  <span className="text-xs text-muted">Upload the missing dependencies in the Deploy panel first.</span>
                )}
              </div>
            )}
            {status === 'update_available' && (
              <Link to="/tests" className="text-xs text-accent hover:underline">Sync in Test Library</Link>
            )}
            {status === 'not_checked' && canCheck && (
              <Button size="sm" variant="outline" onClick={() => void checkNow()} disabled={checking}>
                Check now
              </Button>
            )}
            {range && library.repoWebUrl && (
              <a
                href={`${library.repoWebUrl}/compare/${range[0]}...${range[1]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline"
              >
                View changes on GitHub
              </a>
            )}
          </div>
        )}
        {checkError && (
          <p role="alert" className="text-xs text-danger">{checkError}</p>
        )}
      </div>
    </section>
  );
}
