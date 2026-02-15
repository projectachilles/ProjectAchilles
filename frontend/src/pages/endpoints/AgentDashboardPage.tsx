/**
 * Agent Dashboard Page - Overview of Achilles agent fleet
 * Replaces LimaCharlie EndpointDashboardPage with native agent metrics
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Wifi, WifiOff, ClipboardList, CheckCircle, XCircle, Activity, ArrowRight } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/ui/Table';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, TaskStatus, TaskType } from '@/types/agent';

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}

function MetricCard({ icon: Icon, label, value, color }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-lg bg-muted ${color}`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const OS_COLORS: Record<string, string> = {
  windows: 'bg-blue-500',
  linux: 'bg-orange-500',
  darwin: 'bg-gray-500',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  disabled: 'bg-yellow-500',
  decommissioned: 'bg-red-500',
};

const VERSION_COLORS = [
  'bg-violet-500',
  'bg-cyan-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-lime-500',
  'bg-fuchsia-500',
];

function taskStatusVariant(status: TaskStatus): 'success' | 'warning' | 'destructive' | 'default' | 'primary' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'pending':
    case 'assigned':
    case 'downloading':
      return 'warning';
    case 'failed':
    case 'expired':
      return 'destructive';
    case 'executing':
      return 'primary';
    default:
      return 'default';
  }
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return 'just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function getTaskLabel(type: TaskType, payload: AgentTask['payload']): React.ReactNode {
  switch (type) {
    case 'execute_test':
      return payload.test_name;
    case 'execute_command':
      return <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{payload.command ?? 'command'}</code>;
    case 'update_agent':
      return <span className="italic">Agent Update</span>;
    case 'uninstall':
      return <span className="italic">Uninstall</span>;
    default:
      return type;
  }
}

function buildVersionColorMap(versions: Record<string, number>): Record<string, string> {
  const colorMap: Record<string, string> = {};
  const keys = Object.keys(versions).sort();
  for (let i = 0; i < keys.length; i++) {
    colorMap[keys[i]] = VERSION_COLORS[i % VERSION_COLORS.length];
  }
  return colorMap;
}

interface DistributionBarProps {
  data: Record<string, number>;
  colorMap: Record<string, string>;
  label: string;
}

function DistributionBar({ data, colorMap, label }: DistributionBarProps) {
  const entries = Object.entries(data);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No data available</p>
        ) : (
          <div className="space-y-3">
            {entries.map(([key, count]) => {
              const percentage = Math.round((count / total) * 100);
              const barColor = colorMap[key] || 'bg-gray-500';

              return (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="capitalize">{key}</span>
                    <span className="text-muted-foreground">
                      {count} ({percentage}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TaskActivityCard({ activity }: { activity: AgentMetrics['task_activity_24h'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Task Activity (24h)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <div>
              <p className="text-lg font-semibold">{activity.completed}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <div>
              <p className="text-lg font-semibold">{activity.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            <div>
              <p className="text-lg font-semibold">{activity.in_progress}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 flex items-center justify-center">
              <span className="text-xs font-bold text-muted-foreground">%</span>
            </div>
            <div>
              <p className="text-lg font-semibold">{activity.success_rate}%</p>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgentDashboardPage() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [recentTasks, setRecentTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const [metricsData, tasksResult] = await Promise.all([
          agentApi.getMetrics(),
          agentApi.listTasks({ limit: 10 }),
        ]);

        setMetrics(metricsData);
        setRecentTasks(tasksResult.tasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
        setError(message);
        console.error('Failed to fetch agent dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <>
        <PageContainer>
          <Loading message="Loading agent dashboard..." className="min-h-[400px]" />
        </PageContainer>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageContainer>
          <PageHeader title="Agent Dashboard" description="Fleet overview and operational status" />
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="pt-6">
              <p className="text-destructive font-medium">Failed to load dashboard</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </CardContent>
          </Card>
        </PageContainer>
      </>
    );
  }

  const versionColorMap = buildVersionColorMap(metrics?.by_version ?? {});

  return (
    <>
      <PageContainer>
        <PageHeader
          title="Agent Dashboard"
          description="Fleet overview and operational status"
        />

        {/* Row 1: Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            icon={Monitor}
            label="Total Agents"
            value={metrics?.total ?? 0}
            color="text-blue-500"
          />
          <MetricCard
            icon={Wifi}
            label="Online"
            value={metrics?.online ?? 0}
            color="text-green-500"
          />
          <MetricCard
            icon={WifiOff}
            label="Offline"
            value={metrics?.offline ?? 0}
            color="text-red-500"
          />
          <MetricCard
            icon={ClipboardList}
            label="Pending Tasks"
            value={metrics?.pending_tasks ?? 0}
            color="text-yellow-500"
          />
        </div>

        {/* Row 2: Task Activity + Version Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <TaskActivityCard
            activity={metrics?.task_activity_24h ?? { completed: 0, failed: 0, total: 0, success_rate: 0, in_progress: 0 }}
          />
          <DistributionBar
            data={metrics?.by_version ?? {}}
            colorMap={versionColorMap}
            label="Agent Version Distribution"
          />
        </div>

        {/* Row 3: OS + Status Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <DistributionBar
            data={metrics?.by_os ?? {}}
            colorMap={OS_COLORS}
            label="OS Distribution"
          />
          <DistributionBar
            data={metrics?.by_status ?? {}}
            colorMap={STATUS_COLORS}
            label="Status Distribution"
          />
        </div>

        {/* Row 4: Recent Tasks Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Tasks</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
              onClick={() => navigate('/endpoints/tasks')}
            >
              View All <ArrowRight className="w-3 h-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {recentTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Exit Code</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Badge variant={taskStatusVariant(task.status)}>
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate">
                        {getTaskLabel(task.type, task.payload)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {task.agent_hostname ?? task.agent_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDuration(task.result?.execution_duration_ms)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {task.result?.exit_code != null ? task.result.exit_code : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {formatRelativeTime(task.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
