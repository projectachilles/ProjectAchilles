/**
 * Agent Overview Tab - System info, metadata, tags, and recent tasks.
 */

import { useEffect, useState } from 'react';
import { Monitor, Clock, Tag, Cpu, HardDrive, MemoryStick, Heart } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Badge } from '@/components/shared/ui/Badge';
import { agentApi } from '@/services/api/agent';
import type { Agent, AgentTask } from '@/types/agent';

interface AgentOverviewTabProps {
  agent: Agent;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(normalized).toLocaleString();
}

function taskStatusVariant(status: string): 'success' | 'warning' | 'destructive' | 'default' {
  switch (status) {
    case 'completed': return 'success';
    case 'pending': case 'assigned': case 'downloading': return 'warning';
    case 'failed': case 'expired': return 'destructive';
    default: return 'default';
  }
}

export default function AgentOverviewTab({ agent }: AgentOverviewTabProps) {
  const [recentTasks, setRecentTasks] = useState<AgentTask[]>([]);

  useEffect(() => {
    agentApi.listTasks({ agent_id: agent.id, limit: 5 })
      .then(({ tasks }) => setRecentTasks(tasks))
      .catch(() => {});
  }, [agent.id]);

  const system = agent.last_heartbeat_data?.system;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      {/* System Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Monitor className="w-4 h-4" /> System Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Hostname</dt>
              <dd className="font-medium">{agent.hostname}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">OS / Arch</dt>
              <dd className="font-mono">{agent.os} / {agent.arch}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Agent Version</dt>
              <dd className="font-mono">{agent.agent_version}</dd>
            </div>
            {system && (
              <>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</dt>
                  <dd>{system.cpu_percent.toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground flex items-center gap-1"><MemoryStick className="w-3 h-3" /> Memory</dt>
                  <dd>{system.memory_mb.toLocaleString()} MB</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground flex items-center gap-1"><HardDrive className="w-3 h-3" /> Disk Free</dt>
                  <dd>{(system.disk_free_mb / 1024).toFixed(1)} GB</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Uptime</dt>
                  <dd>{formatDuration(system.uptime_seconds)}</dd>
                </div>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" /> Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Enrolled</dt>
              <dd>{formatDate(agent.enrolled_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Last Heartbeat</dt>
              <dd>{formatDate(agent.last_heartbeat)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={agent.status === 'active' ? 'success' : 'warning'}>
                  {agent.status}
                </Badge>
              </dd>
            </div>
            {agent.rotation_pending && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Key Rotation</dt>
                <dd><Badge variant="warning">Pending</Badge></dd>
              </div>
            )}
            {agent.health_score != null && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground flex items-center gap-1"><Heart className="w-3 h-3" /> Health Score</dt>
                <dd>
                  <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    agent.health_score >= 80
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : agent.health_score >= 50
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                  }`}>
                    {agent.health_score}
                  </span>
                </dd>
              </div>
            )}
          </dl>

          {/* Tags */}
          <div className="mt-4">
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
              <Tag className="w-3 h-3" /> Tags
            </div>
            <div className="flex flex-wrap gap-1">
              {agent.tags.length > 0 ? (
                agent.tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No tags</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Tasks */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet</p>
          ) : (
            <div className="space-y-2">
              {recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant={taskStatusVariant(task.status)} className="text-xs shrink-0">
                      {task.status}
                    </Badge>
                    <span className="truncate">
                      {task.type === 'execute_command' ? (task.payload.command ?? 'Command') : (task.payload.test_name || task.type)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {formatDate(task.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
