import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';
import type { FilterOption, SeverityLevel } from '@/services/api/analytics';

interface SeverityFilterProps {
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  loading?: boolean;
}

const SEVERITY_COLORS: Record<SeverityLevel, { bg: string; text: string; dot: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-500', dot: 'bg-red-500' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-500', dot: 'bg-orange-500' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', dot: 'bg-yellow-500' },
  low: { bg: 'bg-green-500/10', text: 'text-green-500', dot: 'bg-green-500' },
  info: { bg: 'bg-gray-500/10', text: 'text-gray-500', dot: 'bg-gray-500' },
};

const SEVERITY_ORDER: SeverityLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

export default function SeverityFilter({
  options,
  selected,
  onChange,
  loading = false,
}: SeverityFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sort options by severity order
  const sortedOptions = [...options].sort((a, b) => {
    const aIndex = SEVERITY_ORDER.indexOf(a.value as SeverityLevel);
    const bIndex = SEVERITY_ORDER.indexOf(b.value as SeverityLevel);
    return aIndex - bIndex;
  });

  // Toggle selection
  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(s => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  // Clear all selections
  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
    setIsOpen(false);
  };

  // Display text
  const displayText = selected.length === 0
    ? 'All Severities'
    : selected.length === 1
      ? selected[0].charAt(0).toUpperCase() + selected[0].slice(1)
      : `${selected.length} selected`;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className={`
          flex items-center gap-2 px-3 py-1.5
          bg-secondary border border-border rounded-lg text-sm
          hover:bg-accent transition-colors
          focus:outline-none focus:ring-2 focus:ring-primary
          disabled:opacity-50 disabled:cursor-not-allowed
          min-w-[160px]
        `}
      >
        <span className="text-muted-foreground">Severity:</span>
        <span className={`flex-1 text-left truncate ${selected.length === 0 ? 'text-muted-foreground' : ''}`}>
          {loading ? 'Loading...' : displayText}
        </span>
        {selected.length > 0 && (
          <X
            className="w-4 h-4 text-muted-foreground hover:text-foreground"
            onClick={clearAll}
          />
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-56 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-border flex justify-between items-center">
            <span className="text-sm font-medium">Severity</span>
            {selected.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="py-1">
            {sortedOptions.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No severities available
              </div>
            ) : (
              sortedOptions.map(option => {
                const isSelected = selected.includes(option.value);
                const colors = SEVERITY_COLORS[option.value as SeverityLevel] || SEVERITY_COLORS.info;

                return (
                  <button
                    key={option.value}
                    onClick={() => toggleOption(option.value)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 text-sm text-left
                      hover:bg-accent transition-colors
                      ${isSelected ? 'bg-accent/50' : ''}
                    `}
                  >
                    {/* Checkbox */}
                    <div className={`
                      w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                      ${isSelected ? 'bg-primary border-primary' : 'border-border'}
                    `}>
                      {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>

                    {/* Severity indicator dot */}
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />

                    {/* Label */}
                    <span className={`capitalize flex-1 ${isSelected ? colors.text : ''}`}>
                      {option.label}
                    </span>

                    {/* Count badge */}
                    <span className="text-xs text-muted-foreground">
                      ({option.count.toLocaleString()})
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {selected.length > 0 && (
            <div className="px-3 py-2 border-t border-border flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="text-sm text-primary font-medium hover:text-primary/80"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
