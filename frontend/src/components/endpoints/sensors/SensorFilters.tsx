/**
 * Sensor Filters Component
 */

import { Filter, RefreshCw } from 'lucide-react';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';
import { Switch } from '../../shared/ui/Switch';
import type { ListSensorsRequest } from '../../../types/endpoints';

interface SensorFiltersProps {
  filters: ListSensorsRequest;
  onFilterChange: (filters: Partial<ListSensorsRequest>) => void;
  onRefresh: () => void;
}

export default function SensorFilters({
  filters,
  onFilterChange,
  onRefresh,
}: SensorFiltersProps) {
  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-4">
      <div className="flex flex-wrap gap-4 items-end">
        {/* Filter Icon */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Filter className="w-5 h-5" />
        </div>

        {/* Hostname Filter */}
        <div className="min-w-48">
          <Input
            placeholder="server-* or exact name"
            value={filters.filterHostname || ''}
            onChange={(e) =>
              onFilterChange({ filterHostname: e.target.value || undefined })
            }
          />
        </div>

        {/* Platform Filter */}
        <div className="min-w-36">
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            value={filters.filterPlatform || ''}
            onChange={(e) =>
              onFilterChange({
                filterPlatform: e.target.value ? (e.target.value as any) : undefined,
              })
            }
          >
            <option value="">All Platforms</option>
            <option value="windows">Windows</option>
            <option value="macos">macOS</option>
            <option value="linux">Linux</option>
            <option value="lc_secops">LC_SecOps</option>
          </select>
        </div>

        {/* Tag Filter */}
        <div className="min-w-36">
          <Input
            placeholder="Tag filter"
            value={filters.filterTag || ''}
            onChange={(e) =>
              onFilterChange({ filterTag: e.target.value || undefined })
            }
          />
        </div>

        {/* Online Only Switch */}
        <div className="flex items-center">
          <Switch
            label="Online Only"
            checked={filters.onlyOnline || false}
            onChange={(e) => onFilterChange({ onlyOnline: e.target.checked })}
          />
        </div>

        {/* Spacer */}
        <div className="flex-grow" />

        {/* Refresh Button */}
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>
  );
}
