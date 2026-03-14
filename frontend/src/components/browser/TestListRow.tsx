import type { TestMetadata } from '@/types/test';
import { Heart, Play } from 'lucide-react';
import TechniqueBadge from './TechniqueBadge';
import TargetBadge from './TargetBadge';

interface TestListRowProps {
  test: TestMetadata;
  onClick: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onExecute?: (e: React.MouseEvent) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}

const severityBadgeColors: Record<string, string> = {
  'critical': 'bg-red-500 text-white',
  'high': 'bg-orange-500 text-white',
  'medium': 'bg-yellow-500 text-black',
  'low': 'bg-blue-500 text-white',
  'informational': 'bg-gray-500 text-white',
};

export default function TestListRow({ test, onClick, isFavorite, onToggleFavorite, onExecute, selectMode, selected, onToggleSelect }: TestListRowProps) {
  return (
    <div
      onClick={selectMode ? onToggleSelect : onClick}
      className={`group cursor-pointer px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors relative ${selectMode ? 'pl-10' : ''} ${selected ? 'bg-primary/5' : ''}`}
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

      {/* Primary row: Severity + Title + Actions + Score */}
      <div className="flex items-center gap-3">
        {test.severity && (
          <span className={`font-bold text-[10px] px-2 py-0.5 rounded min-w-[52px] text-center shrink-0 ${severityBadgeColors[test.severity.toLowerCase()] || 'bg-gray-500 text-white'}`}>
            {test.severity.toUpperCase()}
          </span>
        )}
        <span className="font-semibold text-sm truncate flex-1 group-hover:text-primary transition-colors">
          {test.name}
        </span>

        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onToggleFavorite && (
            <button onClick={onToggleFavorite} className="p-1 rounded-md hover:bg-accent transition-colors"
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Heart className={`w-3.5 h-3.5 transition-colors ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
            </button>
          )}
          {onExecute && !selectMode && (
            <button onClick={onExecute} className="p-1 rounded-md hover:bg-accent transition-colors" title="Execute test">
              <Play className="w-3.5 h-3.5 text-primary" />
            </button>
          )}
        </div>

        {/* Score */}
        {test.score && (
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
            <span className="text-sm font-extrabold text-black">{test.score.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Secondary row: Techniques + Platform */}
      <div className="flex items-center gap-2 mt-1.5 pl-[64px]">
        <div className="flex flex-wrap gap-1 flex-1">
          {test.techniques.slice(0, 4).map(technique => (
            <TechniqueBadge key={technique} technique={technique} size="xs" />
          ))}
          {test.techniques.length > 4 && (
            <span className="text-[9px] text-muted-foreground px-1 py-0.5">
              +{test.techniques.length - 4} more
            </span>
          )}
        </div>
        {test.target && test.target.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {test.target.slice(0, 2).map(t => (
              <TargetBadge key={t} target={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
