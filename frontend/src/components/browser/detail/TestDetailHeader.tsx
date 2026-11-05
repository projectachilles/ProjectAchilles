import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, Heart, Play } from 'lucide-react';
import type { TestDetails } from '@/types/test';
import { IdentityPill } from '@/components/layout/ConsoleIdentity';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { formatRelativeDate, formatFullDate } from '@/utils/dateFormatters';
import { targetLabel } from '@/utils/platformLabels';
import { severityPillClass } from './severity';

interface TestDetailHeaderProps {
  test: TestDetails;
  backTo: string;
  canRun: boolean;
  onRun: () => void;
  canBuild: boolean;
  hasBuild: boolean;
  onDownload: () => void;
}

export default function TestDetailHeader({
  test, backTo, canRun, onRun, canBuild, hasBuild, onDownload,
}: TestDetailHeaderProps) {
  const { isFavorite, toggleFavorite } = useTestPreferences();
  const favorite = isFavorite(test.uuid);

  const meta: ReactNode[] = [];
  if (test.threatActor) meta.push(<span key="actor">{test.threatActor}</span>);
  if (test.target && test.target.length > 0) {
    meta.push(<span key="target">{test.target.map(t => targetLabel(t)).join(', ')}</span>);
  }
  if (test.stages?.length > 0) meta.push(<span key="stages">{test.stages.length} stages</span>);
  if (test.complexity) meta.push(<span key="complexity">{test.complexity} complexity</span>);
  if (test.author) meta.push(<span key="author">{test.author}</span>);
  if (test.lastModifiedDate) {
    meta.push(
      <span
        key="modified"
        title={test.lastCommitMessage
          ? `${formatFullDate(test.lastModifiedDate)} — ${test.lastCommitMessage}`
          : formatFullDate(test.lastModifiedDate)}
      >
        Modified {formatRelativeDate(test.lastModifiedDate)}
      </span>,
    );
  }
  meta.push(
    <span key="uuid" className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{test.uuid.slice(0, 8)}</span>
      <button
        type="button"
        aria-label="Copy test ID"
        title="Copy test ID"
        onClick={() => { void navigator.clipboard.writeText(test.uuid); }}
        className="rounded p-0.5 text-faint hover:bg-raised hover:text-foreground transition-colors"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>,
  );

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur">
      <div className="container mx-auto px-4 py-4">
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          <Link to={backTo} className="hover:text-foreground">Tests</Link>
          {test.category && (<><span className="text-faint">/</span><span>{test.category}</span></>)}
          {test.subcategory && (<><span className="text-faint">/</span><span>{test.subcategory}</span></>)}
        </nav>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-semibold tracking-tight text-foreground">{test.name}</h1>
              {test.severity && (
                <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${severityPillClass(test.severity)}`}>
                  {test.severity}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              {meta.map((item, i) => (
                <Fragment key={i}>
                  {i > 0 && <span aria-hidden="true" className="text-faint">·</span>}
                  {item}
                </Fragment>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <IdentityPill />
            {test.score ? (
              <span className="inline-flex h-8 items-center rounded-md border border-warning/30 bg-warning-dim px-2.5 text-[13px] font-semibold text-warning">
                {`★ ${test.score.toFixed(1)}`}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => toggleFavorite(test.uuid)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-raised transition-colors"
              title={favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart className={`h-4 w-4 transition-colors ${favorite ? 'fill-danger text-danger' : 'text-muted hover:text-danger'}`} />
            </button>
            {canBuild && hasBuild && (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-[13px] font-medium text-foreground hover:bg-raised transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            )}
            {canRun && (
              <button
                type="button"
                onClick={onRun}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:opacity-90 transition-opacity"
              >
                <Play className="h-3.5 w-3.5" />
                Run on agents
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
