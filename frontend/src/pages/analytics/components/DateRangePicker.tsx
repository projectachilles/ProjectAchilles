import { useState } from 'react';
import { Calendar, X } from 'lucide-react';

interface DateRangeOption {
  label: string;
  value: string;
}

const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { label: 'Last 24 hours', value: '1d' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'All time', value: 'all' },
  { label: 'Custom range...', value: 'custom' },
];

export interface DateRangeValue {
  preset: string;
  from?: string;  // ISO date string for custom range
  to?: string;    // ISO date string for custom range
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');
  const [customFrom, setCustomFrom] = useState(value.from || '');
  const [customTo, setCustomTo] = useState(value.to || '');

  const handlePresetChange = (preset: string) => {
    if (preset === 'custom') {
      setShowCustom(true);
      // Default to last 30 days for custom
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fromStr = thirtyDaysAgo.toISOString().slice(0, 16);
      const toStr = now.toISOString().slice(0, 16);
      setCustomFrom(fromStr);
      setCustomTo(toStr);
    } else {
      setShowCustom(false);
      onChange({ preset });
    }
  };

  const applyCustomRange = () => {
    if (customFrom && customTo) {
      onChange({
        preset: 'custom',
        from: new Date(customFrom).toISOString(),
        to: new Date(customTo).toISOString()
      });
    }
  };

  const clearCustom = () => {
    setShowCustom(false);
    onChange({ preset: '7d' });
  };

  // Format dates for display
  const getDisplayLabel = () => {
    if (value.preset === 'custom' && value.from && value.to) {
      const from = new Date(value.from);
      const to = new Date(value.to);
      const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${formatDate(from)} - ${formatDate(to)}`;
    }
    return DATE_RANGE_OPTIONS.find(opt => opt.value === value.preset)?.label || 'Last 7 days';
  };

  return (
    <div className="flex items-center gap-2">
      <Calendar className="w-4 h-4 text-muted-foreground" />

      {!showCustom ? (
        <select
          value={value.preset}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {DATE_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === 'custom' && value.preset === 'custom' ? getDisplayLabel() : option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-2 py-1">
          <input
            type="datetime-local"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-transparent text-sm focus:outline-none w-[160px]"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="datetime-local"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-transparent text-sm focus:outline-none w-[160px]"
          />
          <button
            onClick={applyCustomRange}
            className="px-2 py-0.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90"
          >
            Apply
          </button>
          <button
            onClick={clearCustom}
            className="p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// Helper to convert date range value to ES format
export function getDateRangeFilter(value: DateRangeValue): { from?: string; to?: string } {
  // Custom range with explicit dates
  if (value.preset === 'custom' && value.from && value.to) {
    return { from: value.from, to: value.to };
  }

  // All time - no filter
  if (value.preset === 'all') {
    return {};
  }

  // Relative time presets
  const match = value.preset.match(/^(\d+)([dhw])$/);
  if (!match) {
    return { from: 'now-7d' };
  }

  return { from: `now-${value.preset}` };
}
