/**
 * Agent Heartbeat Tab - Sparkline charts for CPU, memory, and disk over time.
 * Supports dual Y-axis overlay for agent process metrics alongside host metrics.
 */

import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import type { HeartbeatHistoryPoint } from '@/types/agent';

interface AgentHeartbeatTabProps {
  agentId: string;
}

function formatTimestamp(ts: string): string {
  const normalized = ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z';
  const d = new Date(normalized);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Colors
const HOST_CPU_COLOR = 'oklch(0.60 0.18 145)';
const AGENT_CPU_COLOR = 'oklch(0.75 0.16 145)';
const HOST_MEM_COLOR = 'oklch(0.55 0.20 290)';
const AGENT_MEM_COLOR = 'oklch(0.70 0.16 290)';
const DISK_COLOR = 'oklch(0.65 0.18 85)';

export default function AgentHeartbeatTab({ agentId }: AgentHeartbeatTabProps) {
  const [history, setHistory] = useState<HeartbeatHistoryPoint[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await agentApi.getHeartbeatHistory(agentId, days);
        if (!cancelled) setHistory(data);
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [agentId, days]);

  if (loading && history.length === 0) {
    return <div className="py-8"><Loading message="Loading heartbeat data..." /></div>;
  }

  const chartData = history.map((point) => ({
    time: formatTimestamp(point.timestamp),
    cpu: point.cpu_percent ?? 0,
    memory: point.memory_mb ?? 0,
    disk: point.disk_free_mb ? point.disk_free_mb / 1024 : 0,
    agentCpu: point.process_cpu_percent ?? undefined,
    agentMemory: point.process_memory_mb ?? undefined,
  }));

  // Detect if any data point has process metrics (agent may not have upgraded yet)
  const hasProcessMetrics = history.some(
    (p) => p.process_cpu_percent != null || p.process_memory_mb != null
  );

  // Downsample if > 500 points for chart readability
  const maxPoints = 500;
  const sampled = chartData.length > maxPoints
    ? chartData.filter((_, i) => i % Math.ceil(chartData.length / maxPoints) === 0)
    : chartData;

  return (
    <div className="mt-4 space-y-4">
      {/* Period Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Period:</span>
        {[7, 14, 30].map(d => (
          <Button
            key={d}
            variant={days === d ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setDays(d)}
          >
            {d}d
          </Button>
        ))}
        <span className="text-sm text-muted-foreground ml-4">
          {history.length} data point{history.length !== 1 ? 's' : ''}
        </span>
      </div>

      {history.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No heartbeat history available for this period</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* CPU Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {hasProcessMetrics ? 'CPU Usage — Host & Agent (%)' : 'CPU Usage (%)'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={sampled}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" domain={[0, 100]} tick={{ fontSize: 10 }} />
                  {hasProcessMetrics && (
                    <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} tick={{ fontSize: 10 }} />
                  )}
                  <Tooltip />
                  {hasProcessMetrics && <Legend />}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="cpu"
                    name="Host CPU"
                    stroke={HOST_CPU_COLOR}
                    fill={`${HOST_CPU_COLOR} / 0.2)`}
                    fillOpacity={0.2}
                  />
                  {hasProcessMetrics && (
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="agentCpu"
                      name="Agent CPU"
                      stroke={AGENT_CPU_COLOR}
                      fill="none"
                      strokeDasharray="6 3"
                      connectNulls
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Memory Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {hasProcessMetrics ? 'Memory Usage — Host & Agent (MB)' : 'Memory Usage (MB)'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={sampled}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                  {hasProcessMetrics && (
                    <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} tick={{ fontSize: 10 }} />
                  )}
                  <Tooltip />
                  {hasProcessMetrics && <Legend />}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="memory"
                    name="Host Memory"
                    stroke={HOST_MEM_COLOR}
                    fill={`${HOST_MEM_COLOR} / 0.2)`}
                    fillOpacity={0.2}
                  />
                  {hasProcessMetrics && (
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="agentMemory"
                      name="Agent Memory"
                      stroke={AGENT_MEM_COLOR}
                      fill="none"
                      strokeDasharray="6 3"
                      connectNulls
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Disk Free Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Disk Free (GB)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={sampled}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="disk" stroke={DISK_COLOR} fill={`${DISK_COLOR} / 0.2)`} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
