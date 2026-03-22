/**
 * Agent Event Log Tab - Chronological lifecycle events with type badges and filtering.
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, Power, Download, HelpCircle, Server, Clock, ShieldAlert, HardDrive, MemoryStick, Plug } from 'lucide-react';
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

const RECONNECT_REASON_LABELS: Record<string, string> = {
  service_restart: 'Service Restart',
  network_recovery: 'Network Recovery',
  machine_reboot: 'Machine Reboot',
  update_restart: 'Update Restart',
  network_adapter_disabled: 'Network Adapter Disabled',
  dns_failure: 'DNS Failure',
  server_unreachable: 'Server Unreachable',
  network_unreachable: 'Network Unreachable',
  connection_timeout: 'Connection Timeout',
  connection_reset: 'Connection Reset',
  tls_error: 'TLS/Certificate Error',
  disk_pressure_crash: 'Disk Pressure (Crash)',
  memory_pressure_crash: 'Memory Pressure (Crash)',
  unknown: 'Unknown',
};

const RECONNECT_REASON_ICONS: Record<string, typeof RefreshCw> = {
  service_restart: RefreshCw,
  network_recovery: Wifi,
  machine_reboot: Power,
  update_restart: Download,
  network_adapter_disabled: WifiOff,
  dns_failure: Server,
  server_unreachable: Server,
  network_unreachable: WifiOff,
  connection_timeout: Clock,
  connection_reset: Plug,
  tls_error: ShieldAlert,
  disk_pressure_crash: HardDrive,
  memory_pressure_crash: MemoryStick,
  unknown: HelpCircle,
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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
    case 'came_online': {
      const parts: string[] = [];
      const offlineDur = d.offline_duration_seconds as number | undefined;
      if (offlineDur) {
        parts.push(`Offline for ${formatDuration(offlineDur)}`);
      }
      const failureCount = d.failure_count as number | undefined;
      if (failureCount && failureCount > 0) {
        parts.push(`${failureCount} failed heartbeat${failureCount > 1 ? 's' : ''}`);
      }
      const probableCause = d.probable_cause as string | undefined;
      if (probableCause) {
        parts.push(`Probable: ${probableCause.replace(/_/g, ' ')}`);
      }
      return parts.length > 0 ? parts.join(' \u00b7 ') : null;
    }
    case 'went_offline': {
      const parts: string[] = [];
      const cause = d.probable_cause as string | undefined;
      if (cause) {
        parts.push(`Probable: ${cause.replace(/_/g, ' ')}`);
      }
      const cpu = d.last_cpu_percent as number | undefined;
      const mem = d.last_memory_mb as number | undefined;
      const totalMem = d.last_total_memory_mb as number | undefined;
      const disk = d.last_disk_free_mb as number | undefined;
      if (cpu !== undefined) parts.push(`CPU: ${cpu}%`);
      if (mem && totalMem) {
        parts.push(`Mem: ${Math.round((mem / totalMem) * 100)}%`);
      } else if (mem) {
        parts.push(`Mem: ${mem} MB`);
      }
      if (disk !== undefined) parts.push(`Disk: ${Math.round(disk / 1024)} GB free`);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
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
            const rawReason = event.event_type === 'came_online'
              ? (event.details?.reconnect_reason as string | undefined)
              : undefined;
            const reconnectReason = rawReason?.trim();
            const ReasonIcon = reconnectReason ? RECONNECT_REASON_ICONS[reconnectReason] ?? HelpCircle : null;
            const reasonLabel = reconnectReason ? RECONNECT_REASON_LABELS[reconnectReason] ?? reconnectReason.replace(/_/g, ' ') : null;
            return (
              <div
                key={event.id}
                className="flex items-center gap-3 p-3 rounded-base bg-muted/30 border-theme border-border"
              >
                <Badge variant={EVENT_TYPE_VARIANT[event.event_type]} className="text-xs shrink-0">
                  {EVENT_TYPE_LABELS[event.event_type]}
                </Badge>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {ReasonIcon && reasonLabel && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <ReasonIcon className="w-3 h-3" />
                      {reasonLabel}
                    </span>
                  )}
                  {ReasonIcon && reasonLabel && details && (
                    <span className="text-xs text-muted-foreground/50">|</span>
                  )}
                  {details && (
                    <span className="text-xs text-muted-foreground truncate">{details}</span>
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
