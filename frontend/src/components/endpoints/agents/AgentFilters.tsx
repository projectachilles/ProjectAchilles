/**
 * Agent Filters Component
 */

import { Filter, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
    <div className="border border-border rounded-lg bg-surface p-4 mb-4">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Filter className="w-4 h-4" />
        </div>

        {/* Hostname Filter */}
        <div className="w-full sm:w-auto sm:min-w-48">
          <Input
            placeholder="Filter by hostname"
            value={filters.hostname || ''}
            onChange={(e) =>
              onFilterChange({ hostname: e.target.value || undefined })
            }
          />
        </div>

        {/* OS Filter */}
        <Select
          value={filters.os || 'all'}
          onValueChange={(value) =>
            onFilterChange({ os: value === 'all' ? undefined : (value as ListAgentsRequest['os']) })
          }
        >
          <SelectTrigger className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All OS</SelectItem>
            <SelectItem value="windows">Windows</SelectItem>
            <SelectItem value="linux">Linux</SelectItem>
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select
          value={filters.status || 'all'}
          onValueChange={(value) =>
            onFilterChange({ status: value === 'all' ? undefined : (value as ListAgentsRequest['status']) })
          }
        >
          <SelectTrigger className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="decommissioned">Decommissioned</SelectItem>
            <SelectItem value="uninstalled">Uninstalled</SelectItem>
          </SelectContent>
        </Select>

        {/* Online Only Switch */}
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch
            checked={filters.online_only || false}
            onCheckedChange={(checked) => onFilterChange({ online_only: checked })}
          />
          Online only
        </label>

        <div className="flex-grow" />

        <Button variant="secondary" onClick={onRefresh}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
    </div>
  );
}
