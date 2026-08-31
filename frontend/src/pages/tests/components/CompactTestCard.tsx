import { Heart, Play } from 'lucide-react';
import type { TestMetadata } from '@/types/test';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { targetLabel } from '@/utils/platformLabels';
import { cn } from '@/lib/utils';

interface CompactTestCardProps {
  test: TestMetadata;
  onOpen: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onExecute?: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}

const SEVERITY_VARIANT: Record<string, 'high' | 'medium' | 'low' | 'default'> = {
  critical: 'high',
  high: 'medium',
  medium: 'medium',
  low: 'low',
};

function metaLine(test: TestMetadata): string {
  const parts: string[] = [];
  if (test.target?.length) {
    parts.push(test.target.map(targetLabel).join(', '));
  }
  const stageCount = test.stageCount ?? test.stages.length;
  if (stageCount > 0) {
    parts.push(`${stageCount} ${test.category === 'cyber-hygiene' ? (stageCount === 1 ? 'control' : 'controls') : stageCount === 1 ? 'stage' : 'stages'}`);
  }
  return parts.join(' · ');
}

export function CompactTestCard({
  test,
  onOpen,
  isFavorite,
  onToggleFavorite,
  onExecute,
  selectMode,
  selected,
  onToggleSelect,
}: CompactTestCardProps) {
  const severity = (test.severity || '').toLowerCase();

  return (
    <div
      onClick={selectMode ? onToggleSelect : onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (selectMode ? onToggleSelect : onOpen)();
      }}
      className={cn(
        'group relative cursor-pointer rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-raised',
        selected && 'border-accent/50 bg-accent-dim/40',
      )}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5"
            aria-label={`Select ${test.name}`}
          />
        )}
        <h3 className="flex-1 text-[13px] font-semibold leading-[1.35]">{test.name}</h3>
        {test.score != null && test.score > 0 && (
          <span className="shrink-0 rounded border border-warning/30 bg-warning-dim px-1.5 font-mono text-[11px] font-semibold text-warning">
            {test.score.toFixed(1)}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {severity && (
          <Badge
            variant={SEVERITY_VARIANT[severity] ?? 'default'}
            className="font-mono text-[10px] uppercase"
          >
            {severity}
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{metaLine(test)}</span>

        {/* Hover actions */}
        {!selectMode && (
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className={cn(
                'rounded p-1 hover:bg-overlay',
                isFavorite ? 'text-danger' : 'text-muted hover:text-foreground',
              )}
              title={isFavorite ? 'Remove favorite' : 'Add favorite'}
            >
              <Heart className={cn('h-3.5 w-3.5', isFavorite && 'fill-current')} />
            </button>
            {onExecute && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute();
                }}
                className="rounded p-1 text-muted hover:bg-overlay hover:text-accent"
                title="Run test"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
