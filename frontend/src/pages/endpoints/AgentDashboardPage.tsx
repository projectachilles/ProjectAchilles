/**
 * Agent Dashboard Page - Overview of Achilles agent fleet
 * Replaces LimaCharlie EndpointDashboardPage with native agent metrics
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Wifi, WifiOff, ClipboardList, CheckCircle, XCircle, Activity, ArrowRight, Signal, Timer, AlertTriangle, Heart } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, TaskStatus, TaskType, FleetHealthMetrics } from '@/types/agent';

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
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

const STATUS_DONUT_COLORS: Record<string, string> = {
  active: 'oklch(0.60 0.18 145)',
  disabled: 'oklch(0.70 0.18 85)',
  decommissioned: 'oklch(0.55 0.22 25)',
};

const VERSION_PALETTE = [
  'oklch(0.55 0.20 290)',  // violet
  'oklch(0.65 0.15 200)',  // cyan
  'oklch(0.65 0.18 85)',   // amber
  'oklch(0.60 0.18 160)',  // emerald
  'oklch(0.58 0.22 15)',   // rose
  'oklch(0.62 0.14 230)',  // sky
  'oklch(0.68 0.18 130)',  // lime
  'oklch(0.58 0.22 320)',  // fuchsia
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
    colorMap[keys[i]] = VERSION_PALETTE[i % VERSION_PALETTE.length];
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

interface DonutChartProps {
  data: Record<string, number>;
  colorMap: Record<string, string>;
  label: string;
}

function DonutChart({ data, colorMap, label }: DonutChartProps) {
  const entries = Object.entries(data);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = entries.map(([key, count]) => ({
    name: key,
    value: count,
    fill: colorMap[key] || 'oklch(0.55 0.01 250)',
    percentage: Math.round((count / total) * 100),
  }));

  const chartConfig = chartData.reduce<ChartConfig>((acc, item) => {
    acc[item.name] = { label: item.name, color: item.fill };
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="w-[120px] h-[120px] flex-shrink-0">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="45%"
                  outerRadius="85%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, _name, item) => {
                        const p = item.payload;
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: p.fill }}
                              />
                              <span className="font-medium capitalize">{p.name}</span>
                            </div>
                            <span className="text-foreground font-bold ml-[18px]">
                              {Number(value).toLocaleString()} ({p.percentage}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
          </div>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            {chartData.map((entry, index) => (
              <div key={`legend-${index}`} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: entry.fill }}
                />
                <span className="text-sm capitalize truncate">{entry.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums flex-shrink-0 ml-auto">
                  {entry.value} ({entry.percentage}%)
                </span>
              </div>
            ))}
          </div>
        </div>
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
  const [fleetHealth, setFleetHealth] = useState<FleetHealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const [metricsData, tasksResult, healthData] = await Promise.all([
          agentApi.getMetrics(),
          agentApi.listTasks({ limit: 10 }),
          agentApi.getFleetHealthMetrics().catch(() => null),
        ]);

        setMetrics(metricsData);
        setRecentTasks(tasksResult.tasks);
        setFleetHealth(healthData);
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

        {/* Row 2: Fleet Health KPIs */}
        {fleetHealth && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <MetricCard
              icon={Signal}
              label="Fleet Uptime (30d)"
              value={`${fleetHealth.fleet_uptime_percent_30d.toFixed(1)}%`}
              color="text-emerald-500"
            />
            <MetricCard
              icon={CheckCircle}
              label="Task Success Rate (7d)"
              value={`${fleetHealth.task_success_rate_7d.toFixed(1)}%`}
              color="text-blue-500"
            />
            <MetricCard
              icon={Timer}
              label="MTBF"
              value={fleetHealth.mtbf_hours != null ? `${fleetHealth.mtbf_hours.toFixed(1)}h` : 'N/A'}
              color="text-purple-500"
            />
            <MetricCard
              icon={AlertTriangle}
              label="Stale Agents"
              value={fleetHealth.stale_agent_count}
              color={fleetHealth.stale_agent_count > 0 ? 'text-amber-500' : 'text-green-500'}
            />
            <MetricCard
              icon={Heart}
              label="Avg Health"
              value={fleetHealth.avg_health_score != null ? Math.round(fleetHealth.avg_health_score) : 'N/A'}
              color={
                fleetHealth.avg_health_score == null
                  ? 'text-muted-foreground'
                  : fleetHealth.avg_health_score >= 80
                    ? 'text-emerald-500'
                    : fleetHealth.avg_health_score >= 50
                      ? 'text-amber-500'
                      : 'text-red-500'
              }
            />
          </div>
        )}

        {/* Stale Agent Warning */}
        {fleetHealth && fleetHealth.stale_agent_count > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      {fleetHealth.stale_agent_count} stale agent{fleetHealth.stale_agent_count !== 1 ? 's' : ''} detected
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Online agents with no completed tasks in the last 7 days
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/endpoints/agents?stale=true')}
                >
                  View <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Task Activity + Version Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <TaskActivityCard
            activity={metrics?.task_activity_24h ?? { completed: 0, failed: 0, total: 0, success_rate: 0, in_progress: 0 }}
          />
          <DonutChart
            data={metrics?.by_version ?? {}}
            colorMap={versionColorMap}
            label="Agent Version Distribution"
          />
        </div>

        {/* OS + Status Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <DistributionBar
            data={metrics?.by_os ?? {}}
            colorMap={OS_COLORS}
            label="OS Distribution"
          />
          <DonutChart
            data={metrics?.by_status ?? {}}
            colorMap={STATUS_DONUT_COLORS}
            label="Status Distribution"
          />
        </div>

        {/* Recent Tasks Table */}
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
