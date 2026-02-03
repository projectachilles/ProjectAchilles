/**
 * Agent Detail Panel - Slide-out side panel for agent details
 */

import { X, Clock, Server, Cpu, HardDrive, Activity } from 'lucide-react';
import { Badge, PlatformBadge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import type { Agent } from '@/types/agent';

interface AgentDetailPanelProps {
  agent: Agent | null;
  latestVersion?: string;
  onClose: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString();
}

function getStatusVariant(status: Agent['status']): 'success' | 'warning' | 'destructive' {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'warning';
    case 'decommissioned':
      return 'destructive';
  }
}

function getRuntimeVariant(status: string): 'default' | 'warning' | 'destructive' {
  switch (status) {
    case 'executing':
      return 'warning';
    case 'error':
    case 'offline':
      return 'destructive';
    default:
      return 'default';
  }
}

export default function AgentDetailPanel({ agent, latestVersion, onClose }: AgentDetailPanelProps) {
  if (!agent) return null;

  const heartbeat = agent.last_heartbeat_data;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-xl z-40 overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Agent Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          {/* General Info */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">General</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hostname</span>
                <span className="font-medium">{agent.hostname}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs">{agent.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={getStatusVariant(agent.status)}>
                  {agent.status}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">OS / Arch</span>
                <div className="flex items-center gap-2">
                  <PlatformBadge platform={agent.os} />
                  <span>{agent.arch}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Version</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{agent.agent_version}</span>
                  {latestVersion && latestVersion !== agent.agent_version && (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-xs">{latestVersion}</span>
                      <Badge variant="warning">update pending</Badge>
                    </>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Enrolled</span>
                <span>{formatDate(agent.enrolled_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Heartbeat</span>
                <span>{formatDate(agent.last_heartbeat)}</span>
              </div>
            </div>
          </div>

          {/* System Info from heartbeat */}
          {heartbeat?.system && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">System Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> CPU
                  </span>
                  <span>{heartbeat.system.cpu_percent}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Server className="w-3 h-3" /> Memory
                  </span>
                  <span>{heartbeat.system.memory_mb} MB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> Disk Free
                  </span>
                  <span>{heartbeat.system.disk_free_mb} MB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Uptime
                  </span>
                  <span>{Math.floor(heartbeat.system.uptime_seconds / 3600)}h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Runtime
                  </span>
                  <Badge variant={getRuntimeVariant(heartbeat.status)}>
                    {heartbeat.status}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* Tags */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Tags</h3>
            <div className="flex flex-wrap gap-1">
              {agent.tags.length === 0 ? (
                <span className="text-sm text-muted-foreground">No tags</span>
              ) : (
                agent.tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
