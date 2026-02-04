/**
 * Agent Filters Component
 */

import { Filter, RefreshCw } from 'lucide-react';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';
import { Switch } from '../../shared/ui/Switch';
import type { ListAgentsRequest } from '@/types/agent';

interface AgentFiltersProps {
  filters: ListAgentsRequest;
  onFilterChange: (filters: Partial<ListAgentsRequest>) => void;
  onRefresh: () => void;
}

export default function AgentFilters({
  filters,
  onFilterChange,
  onRefresh,
}: AgentFiltersProps) {
  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-4">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Filter className="w-5 h-5" />
        </div>

        {/* Hostname Filter */}
        <div className="min-w-48">
          <Input
            placeholder="Filter by hostname"
            value={filters.hostname || ''}
            onChange={(e) =>
              onFilterChange({ hostname: e.target.value || undefined })
            }
          />
        </div>

        {/* OS Filter */}
        <div className="min-w-36">
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            value={filters.os || ''}
            onChange={(e) =>
              onFilterChange({
                os: e.target.value ? (e.target.value as ListAgentsRequest['os']) : undefined,
              })
            }
          >
            <option value="">All OS</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="min-w-36">
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            value={filters.status || ''}
            onChange={(e) =>
              onFilterChange({
                status: e.target.value ? (e.target.value as ListAgentsRequest['status']) : undefined,
              })
            }
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="decommissioned">Decommissioned</option>
          </select>
        </div>

        {/* Online Only Switch */}
        <div className="flex items-center">
          <Switch
            label="Online Only"
            checked={filters.online_only || false}
            onChange={(e) => onFilterChange({ online_only: e.target.checked })}
          />
        </div>

        <div className="flex-grow" />

        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>
  );
}
