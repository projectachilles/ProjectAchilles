import type { TestMetadata } from '@/types/test';
import TechniqueBadge from './TechniqueBadge';
import { Calendar, Layers, Star, Shield, Workflow } from 'lucide-react';

interface TestListItemProps {
  test: TestMetadata;
  onClick: () => void;
}

export default function TestListItem({ test, onClick }: TestListItemProps) {
  const getSeverityColor = (severity?: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'text-red-500';
      case 'high':
        return 'text-orange-500';
      case 'medium':
        return 'text-yellow-500';
      case 'low':
        return 'text-blue-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-6 py-4 border-b border-border hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start gap-6">
        {/* Name and UUID */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold mb-1 truncate">{test.name}</h3>
          <p className="text-xs font-mono text-muted-foreground">{test.uuid.substring(0, 8)}...</p>
        </div>

        {/* Techniques */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1">
            {test.techniques.slice(0, 3).map(technique => (
              <TechniqueBadge key={technique} technique={technique} size="sm" />
            ))}
            {test.techniques.length > 3 && (
              <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                +{test.techniques.length - 3} more
              </span>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {/* Severity */}
          {test.severity && (
            <div className="flex items-center gap-1 min-w-[80px]">
              <Shield className="w-3 h-3" />
              <span className={`font-medium uppercase text-xs ${getSeverityColor(test.severity)}`}>
                {test.severity}
              </span>
            </div>
          )}

          {/* Multi-stage indicator */}
          {test.isMultiStage && (
            <div className="flex items-center gap-1 min-w-[70px]">
              <Layers className="w-3 h-3" />
              <span className="text-xs">{test.stageCount || 0} stages</span>
            </div>
          )}

          {/* Score */}
          {test.score && (
            <div className="flex items-center gap-1 min-w-[60px]">
              <Star className="w-3 h-3 text-amber-500 fill-current" />
              <span className="text-xs font-medium text-amber-500">{test.score.toFixed(1)}</span>
            </div>
          )}

          {/* Date */}
          {test.createdDate && (
            <div className="flex items-center gap-1 min-w-[100px]">
              <Calendar className="w-3 h-3" />
              <span className="text-xs">{test.createdDate.split(' ')[0]}</span>
            </div>
          )}

          {/* Detection Files Badge */}
          {test.hasDetectionFiles && (
            <div className="flex items-center gap-1 min-w-[50px] text-blue-500" title="Detection rules (KQL/YARA)">
              <Shield className="w-3 h-3" />
              <span className="text-xs font-medium">KQL</span>
            </div>
          )}

          {/* Attack Flow Badge */}
          {test.hasAttackFlow && (
            <div className="flex items-center gap-1 min-w-[50px] text-purple-500" title="Attack flow diagram">
              <Workflow className="w-3 h-3" />
              <span className="text-xs font-medium">Flow</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
