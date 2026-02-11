/**
 * Agent Dashboard Page - Overview of Achilles agent fleet
 * Replaces LimaCharlie EndpointDashboardPage with native agent metrics
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Wifi, WifiOff, ClipboardList } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Badge } from '@/components/shared/ui/Badge';
import { Loading } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, TaskStatus } from '@/types/agent';

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
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  disabled: 'bg-yellow-500',
  decommissioned: 'bg-red-500',
};

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
          agentApi.listTasks({ limit: 5 }),
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
          <PageHeader title="Agent Dashboard" description="Fleet overview and quick actions" />
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

  const quickActions = [
    {
      title: 'Agents',
      description: 'View and manage registered agents',
      icon: Monitor,
      path: '/endpoints/agents',
      color: 'text-blue-500',
    },
    {
      title: 'Tasks',
      description: 'View and dispatch security test tasks',
      icon: ClipboardList,
      path: '/endpoints/tasks',
      color: 'text-purple-500',
    },
  ];

  return (
    <>
      <PageContainer>
        <PageHeader
          title="Agent Dashboard"
          description="Fleet overview and quick actions"
        />

        {/* Metric Cards */}
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

        {/* Distribution Charts */}
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

        {/* Quick Actions */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {quickActions.map((action) => (
              <Card
                key={action.title}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(action.path)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg bg-muted ${action.color}`}>
                      <action.icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{action.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {action.description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Recent Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet</p>
            ) : (
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {task.payload.test_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(task.created_at)}
                      </p>
                    </div>
                    <Badge variant={taskStatusVariant(task.status)}>
                      {task.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
