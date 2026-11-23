import { Heart, Play } from 'lucide-react';
import type { TestMetadata } from '@/types/test';
import type { TestVersionRow } from '@/types/testVersion';
import { VersionStatusChip } from '@/components/browser/VersionStatusChip';
import { Checkbox } from '@/components/ui/checkbox';
import { targetLabel } from '@/utils/platformLabels';
import { cn } from '@/lib/utils';
import type { FleetResult } from './fleetResult';
import { techniqueIds } from './techniqueIds';

/*
 * Column tracks, shared by the header and every row so they cannot drift.
 * Below xl the row stacks (name, subtitle, fleet | score, actions) and the header hides.
 * Width check (list = viewport - 240 sidebar - 48 gutters - 216 rail; row px-4 = 32):
 * xl at 1280: 776 - 32 - (120+180+48+72) - 4*12 = 276px name; 2xl at the 1016 cap:
 * 1016 - 32 - (180+120+56+160+48+72) - 6*12 = 286px name. Techniques 180 fits two
 * sub-technique chips (~69px each) plus "+n"; fleet 160 fits "12 / 12 endpoints protected".
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 px-3 xl:grid-cols-[minmax(0,1fr)_120px_180px_48px_72px] xl:px-4 2xl:grid-cols-[minmax(0,1fr)_180px_120px_56px_160px_48px_72px]';

/** Cells that only exist from xl (platform) or 2xl (techniques, stages). */
const FROM_XL = 'hidden xl:block';
const FROM_2XL = 'hidden 2xl:block';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

const VISIBLE_TECHNIQUES = 2;

interface TestListRowProps {
  test: TestMetadata;
  fleet: FleetResult;
  onOpen: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onExecute?: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** Version row; the chip shows under the name when set. */
  version?: TestVersionRow;
}

function actorLine(test: TestMetadata): string {
  const actor = test.threatActor?.trim() || 'No attributed actor';
  const sub = test.subcategory?.trim();
  return sub ? `${actor} · ${sub}` : actor;
}

/** Column labels for a group's list; hidden below `xl`, where the row stacks. */
export function TestListHeader() {
  return (
    <div
      className={cn(
        ROW_GRID,
        'hidden border-b border-border py-2.5 text-[11px] uppercase tracking-wider text-faint xl:grid',
      )}
    >
      <span>Test</span>
      <span className={FROM_2XL}>Techniques</span>
      <span>Platform</span>
      <span className={FROM_2XL}>Stages</span>
      <span>Fleet result</span>
      <span>Score</span>
      <span />
    </div>
  );
}

export function TestListRow({
  test,
  fleet,
  onOpen,
  isFavorite,
  onToggleFavorite,
  onExecute,
  selectMode,
  selected,
  onToggleSelect,
  version,
}: TestListRowProps) {
  const primary = selectMode ? onToggleSelect : onOpen;
  const stageCount = test.stageCount ?? test.stages.length;
  const techniques = techniqueIds(test.techniques);
  const extraTechniques = techniques.length - VISIBLE_TECHNIQUES;
  const platforms = test.target?.length ? test.target.map(targetLabel).join(', ') : '—';

  return (
    <li
      onClick={primary}
      className={cn(
        ROW_GRID,
        'group cursor-pointer items-center border-b border-border py-3 transition-colors last:border-b-0 hover:bg-raised',
        selected && 'bg-accent-dim/40 hover:bg-accent-dim/60',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {selectMode && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5"
            aria-label={`Select ${test.name}`}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            title={test.name}
            onClick={(e) => {
              e.stopPropagation();
              primary();
            }}
            className={cn(
              'block min-w-0 max-w-full truncate rounded-sm text-left text-[13.5px] font-semibold text-foreground hover:text-accent',
              FOCUS_RING,
            )}
          >
            {test.name}
          </button>
          <span className="truncate text-xs text-muted">{actorLine(test)}</span>
          {version && <VersionStatusChip row={version} />}
        </div>
      </div>

      <div className="hidden min-w-0 flex-nowrap items-center gap-1 overflow-hidden 2xl:flex">
        {techniques.slice(0, VISIBLE_TECHNIQUES).map((technique) => (
          <span key={technique} className="shrink-0 whitespace-nowrap rounded bg-overlay px-1.5 py-px font-mono text-[11px] text-muted">
            {technique}
          </span>
        ))}
        {extraTechniques > 0 && <span className="shrink-0 text-[11px] text-faint">+{extraTechniques}</span>}
      </div>

      <span className={cn(FROM_XL, 'truncate text-xs text-muted')} title={platforms}>
        {platforms}
      </span>

      <span className={cn(FROM_2XL, 'font-mono text-xs text-muted')}>
        {stageCount > 0 ? stageCount : '—'}
      </span>

      <div
        title={fleet.title}
        className="flex min-w-0 flex-col gap-1 max-xl:col-start-1 max-xl:row-start-2"
      >
        {fleet.share != null && (
          <div className="flex h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-danger-dim">
            <div
              data-testid="fleet-bar"
              className="bg-accent"
              style={{ width: `${Math.round(fleet.share * 100)}%` }}
            />
          </div>
        )}
        <span
          data-fleet-text
          className={cn('text-xs', fleet.share != null ? 'text-foreground' : 'text-faint')}
        >
          {fleet.text}
        </span>
      </div>

      <span className="self-center font-mono text-xs text-muted max-xl:col-start-2 max-xl:row-span-2 max-xl:row-start-1">
        {test.score != null && test.score > 0 ? test.score.toFixed(1) : '—'}
      </span>

      <div
        className={cn(
          'flex items-center justify-end gap-1.5 opacity-40 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          'max-xl:col-start-3 max-xl:row-span-2 max-xl:row-start-1',
        )}
      >
        {!selectMode && (
          <>
            <button
              type="button"
              aria-label={isFavorite ? `Remove ${test.name} from favorites` : `Add ${test.name} to favorites`}
              aria-pressed={isFavorite}
              title={isFavorite ? 'Remove favorite' : 'Add favorite'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className={cn(
                'inline-flex size-[30px] items-center justify-center rounded-md hover:bg-overlay',
                isFavorite ? 'text-danger' : 'text-muted hover:text-foreground',
                FOCUS_RING,
              )}
            >
              <Heart className={cn('h-[15px] w-[15px]', isFavorite && 'fill-current')} aria-hidden="true" />
            </button>
            {onExecute && (
              <button
                type="button"
                aria-label={`Run ${test.name}`}
                title="Run test"
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute();
                }}
                className={cn(
                  'inline-flex size-[30px] items-center justify-center rounded-md border border-accent/40 bg-accent-dim text-accent hover:bg-accent-dim/70',
                  FOCUS_RING,
                )}
              >
                <Play className="h-[13px] w-[13px]" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
