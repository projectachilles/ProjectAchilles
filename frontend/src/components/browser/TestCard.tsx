import type { TestMetadata } from '@/types/test';
import { FileCode2, Calendar, Layers, Star, Shield, Workflow, ShieldCheck, Heart, User, Clock } from 'lucide-react';
import TechniqueBadge from './TechniqueBadge';
import { formatRelativeDate, formatFullDate } from '@/utils/dateFormatters';

interface TestCardProps {
  test: TestMetadata;
  onClick: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
}

export default function TestCard({ test, onClick, isFavorite, onToggleFavorite }: TestCardProps) {
  const severityColors: Record<string, string> = {
    'critical': 'text-red-500',
    'high': 'text-orange-500',
    'medium': 'text-yellow-500',
    'low': 'text-blue-500',
    'informational': 'text-gray-500',
  };

  const severityColor = test.severity ? severityColors[test.severity.toLowerCase()] || 'text-gray-500' : 'text-gray-500';

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-lg border border-border bg-card text-card-foreground p-4 hover:shadow-lg transition-all hover:border-primary/50"
    >
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
            {test.name}
          </h3>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleFavorite && (
              <button
                onClick={onToggleFavorite}
                className="p-1 rounded-md hover:bg-accent transition-colors"
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart className={`w-4 h-4 transition-colors ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
              </button>
            )}
            {test.score && (
              <div className="flex items-center gap-1 text-sm font-medium text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                <span>{test.score.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Metadata Row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {test.severity && (
            <span className={`font-medium uppercase ${severityColor}`}>
              {test.severity}
            </span>
          )}
          {test.isMultiStage && (
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              <span>{test.stageCount || test.techniques.length} stages</span>
            </div>
          )}
          {test.createdDate && (
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{test.createdDate}</span>
            </div>
          )}
          {test.author && (
            <div className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{test.author}</span>
            </div>
          )}
          {test.lastModifiedDate && (
            <div className="flex items-center gap-1" title={formatFullDate(test.lastModifiedDate)}>
              <Clock className="w-3 h-3" />
              <span>{formatRelativeDate(test.lastModifiedDate)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {test.description && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
          {test.description}
        </p>
      )}

      {/* Techniques */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {test.techniques.slice(0, 4).map(technique => (
          <TechniqueBadge key={technique} technique={technique} />
        ))}
        {test.techniques.length > 4 && (
          <span className="text-xs text-muted-foreground px-2 py-1">
            +{test.techniques.length - 4} more
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-3 border-t border-border">
        <div className="flex items-center gap-1">
          <FileCode2 className="w-3 h-3" />
          <span className="font-mono">{test.uuid.slice(0, 8)}...</span>
        </div>

        {test.hasDetectionFiles && (
          <div className="flex items-center gap-1 text-blue-500" title="Detection rules included (KQL/YARA)">
            <Shield className="w-3 h-3" />
            <span className="text-[10px] font-medium">KQL</span>
          </div>
        )}

        {test.hasAttackFlow && (
          <div className="flex items-center gap-1 text-purple-500" title="Attack flow diagram available">
            <Workflow className="w-3 h-3" />
            <span className="text-[10px] font-medium">Flow</span>
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
