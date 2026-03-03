/**
 * Agent Event Log Tab - Chronological lifecycle events with type badges and filtering.
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/shared/ui/Card';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import type { AgentEvent, AgentEventType } from '@/types/agent';

interface AgentEventLogTabProps {
  agentId: string;
}

const PAGE_SIZE = 30;

const EVENT_TYPE_LABELS: Record<AgentEventType, string> = {
  enrolled: 'Enrolled',
  went_offline: 'Went Offline',
  came_online: 'Came Online',
  task_failed: 'Task Failed',
  task_completed: 'Task Completed',
  version_updated: 'Version Updated',
  key_rotated: 'Key Rotated',
  status_changed: 'Status Changed',
  decommissioned: 'Decommissioned',
};

const EVENT_TYPE_VARIANT: Record<AgentEventType, 'success' | 'warning' | 'destructive' | 'default' | 'primary' | 'outline'> = {
  enrolled: 'primary',
  went_offline: 'destructive',
  came_online: 'success',
  task_failed: 'destructive',
  task_completed: 'success',
  version_updated: 'default',
  key_rotated: 'warning',
  status_changed: 'warning',
  decommissioned: 'destructive',
};

const ALL_EVENT_TYPES: AgentEventType[] = [
  'enrolled', 'came_online', 'went_offline', 'task_completed', 'task_failed',
  'version_updated', 'key_rotated', 'status_changed', 'decommissioned',
];

function formatEventDate(dateStr: string): string {
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(normalized).toLocaleString();
}

function formatDetails(event: AgentEvent): string | null {
  const d = event.details;
  if (!d || Object.keys(d).length === 0) return null;

  switch (event.event_type) {
    case 'version_updated':
      return `${d.from} \u2192 ${d.to}`;
    case 'status_changed':
      return `${d.from} \u2192 ${d.to}`;
    case 'task_completed':
    case 'task_failed':
      return `Task: ${d.task_id ?? ''}`;
    case 'enrolled':
      return `${d.hostname ?? ''} (${d.os}/${d.arch})`;
    default:
      return JSON.stringify(d);
  }
}

export default function AgentEventLogTab({ agentId }: AgentEventLogTabProps) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState<AgentEventType | undefined>(undefined);

  const loadEvents = useCallback(async (reset = false) => {
    const isMore = !reset && events.length > 0;
    if (isMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const result = await agentApi.getAgentEvents(agentId, {
        limit: PAGE_SIZE,
        offset: reset ? 0 : events.length,
        event_type: filterType,
      });
      if (reset) {
        setEvents(result.events);
      } else {
        setEvents(prev => [...prev, ...result.events]);
      }
      setTotal(result.total);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [agentId, filterType, events.length]);

  useEffect(() => {
    loadEvents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, filterType]);

  if (loading && events.length === 0) {
    return <div className="py-8"><Loading message="Loading events..." /></div>;
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Filter Chips */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterType === undefined ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setFilterType(undefined)}
        >
          All
        </Button>
        {ALL_EVENT_TYPES.map(type => (
          <Button
            key={type}
            variant={filterType === type ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setFilterType(type)}
          >
            {EVENT_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No events recorded</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const details = formatDetails(event);
            return (
              <div
                key={event.id}
                className="flex items-center gap-3 p-3 rounded-base bg-muted/30 border-theme border-border"
              >
                <Badge variant={EVENT_TYPE_VARIANT[event.event_type]} className="text-xs shrink-0">
                  {EVENT_TYPE_LABELS[event.event_type]}
                </Badge>
                <div className="flex-1 min-w-0">
                  {details && (
                    <span className="text-sm truncate">{details}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatEventDate(event.created_at)}
                </span>
              </div>
            );
          })}

          {/* Load More */}
          {events.length < total && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => loadEvents(false)}
              >
                {loadingMore ? 'Loading...' : `Load more (${events.length}/${total})`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
