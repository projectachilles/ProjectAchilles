import type { TestMetadata } from '@/types/test';
import { Layers, Shield, Workflow, ShieldCheck, Heart, Play } from 'lucide-react';
import TechniqueBadge from './TechniqueBadge';
import TargetBadge from './TargetBadge';
import { formatRelativeDate } from '@/utils/dateFormatters';

interface TestCardProps {
  test: TestMetadata;
  onClick: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onExecute?: (e: React.MouseEvent) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}

export default function TestCard({ test, onClick, isFavorite, onToggleFavorite, onExecute, selectMode, selected, onToggleSelect }: TestCardProps) {
  const severityBadgeColors: Record<string, string> = {
    'critical': 'bg-red-500 text-white',
    'high': 'bg-orange-500 text-white',
    'medium': 'bg-yellow-500 text-black',
    'low': 'bg-blue-500 text-white',
    'informational': 'bg-gray-500 text-white',
  };

  const tooltipParts = [
    test.author && `Author: ${test.author}`,
    test.createdDate && `Created: ${test.createdDate}`,
    test.lastModifiedDate && `Modified: ${formatRelativeDate(test.lastModifiedDate)}`,
    `UUID: ${test.uuid}`,
  ].filter(Boolean).join('\n');

  return (
    <div
      onClick={selectMode ? onToggleSelect : onClick}
      title={tooltipParts}
      className={`group cursor-pointer rounded-base border-theme border-border bg-card text-card-foreground shadow-theme p-4 hover:translate-x-[var(--theme-hover-translate)] hover:translate-y-[var(--theme-hover-translate)] hover:shadow-[var(--theme-hover-shadow)] transition-all hover:border-primary/50 relative ${selectMode ? 'pl-10' : ''} ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      {/* Select mode checkbox */}
      {selectMode && (
        <div className="absolute left-3 top-4">
          <input
            type="checkbox"
            className="h-4 w-4 appearance-auto accent-primary cursor-pointer"
            checked={selected}
            onChange={() => {}}
            onClick={onToggleSelect}
          />
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
            {test.name}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {onToggleFavorite && (
              <button onClick={onToggleFavorite} className="p-1 rounded-md hover:bg-accent transition-colors"
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart className={`w-4 h-4 transition-colors ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
              </button>
            )}
            {onExecute && !selectMode && (
              <button onClick={onExecute} className="p-1 rounded-md hover:bg-accent transition-colors" title="Execute test">
                <Play className="w-4 h-4 text-primary" />
              </button>
            )}
            {test.score && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-sm font-bold">
                {test.score.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        {/* Metadata Row — Tier 2 */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {test.source === 'custom' && (
            <span className="font-bold uppercase text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-500">
              Custom
            </span>
          )}
          {test.severity && (
            <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded ${severityBadgeColors[test.severity.toLowerCase()] || 'bg-gray-500 text-white'}`}>
              {test.severity}
            </span>
          )}
          {test.isMultiStage && (
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              <span>{test.stageCount || test.techniques.length} stages</span>
            </div>
          )}
          {test.target && test.target.length > 0 && (
            <div className="flex items-center gap-1.5">
              {test.target.slice(0, 3).map(t => (
                <TargetBadge key={t} target={t} />
              ))}
              {test.target.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{test.target.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {test.description && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
          {test.description}
        </p>
      )}

      {/* Techniques */}
      <div className="flex flex-wrap gap-1.5 mb-3 opacity-70">
        {test.techniques.slice(0, 4).map(technique => (
          <TechniqueBadge key={technique} technique={technique} size="xs" />
        ))}
        {test.techniques.length > 4 && (
          <span className="text-[9px] text-muted-foreground px-1 py-0.5">
            +{test.techniques.length - 4} more
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-3 border-t-[length:var(--theme-border-width)] border-border">
        {test.hasDetectionFiles && (
          <div className="flex items-center gap-1 text-blue-500" title="Detection rules included">
            <Shield className="w-3 h-3" />
            <span className="text-[10px] font-medium">Rules</span>
          </div>
        )}
        {test.hasAttackFlow && (
          <div className="flex items-center gap-1 text-purple-500" title="Attack flow diagram available">
            <Workflow className="w-3 h-3" />
            <span className="text-[10px] font-medium">Flow</span>
          </div>
        )}
        {test.hasKillChain && (
          <div className="flex items-center gap-1 text-orange-500" title="Kill chain diagram available">
            <Workflow className="w-3 h-3" />
            <span className="text-[10px] font-medium">Kill Chain</span>
          </div>
        )}
        {test.hasDefenseGuidance && (
          <div className="flex items-center gap-1 text-green-500" title="Defense guidance available">
            <ShieldCheck className="w-3 h-3" />
            <span className="text-[10px] font-medium">Defense</span>
          </div>
        )}
      </div>
    </div>
  );
}
