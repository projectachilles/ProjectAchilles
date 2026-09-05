/**
 * Agent Detail Page - Dedicated route for viewing a single agent's
 * overview, task history, heartbeat metrics, and event log.
 */

import { useEffect, useState, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import { Button } from '@/components/shared/ui/Button';
import { Badge, PlatformBadge, StatusDot } from '@/components/shared/ui/Badge';
import { Loading } from '@/components/shared/ui/Spinner';
import { Alert } from '@/components/shared/ui/Alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shared/ui/Tabs';
import { agentApi } from '@/services/api/agent';
import type { Agent } from '@/types/agent';
import AgentOverviewTab from '@/components/endpoints/agents/detail/AgentOverviewTab';
import AgentTaskHistoryTab from '@/components/endpoints/agents/detail/AgentTaskHistoryTab';
import AgentHeartbeatTab from '@/components/endpoints/agents/detail/AgentHeartbeatTab';
import AgentEventLogTab from '@/components/endpoints/agents/detail/AgentEventLogTab';

function isOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  const normalized = lastHeartbeat.endsWith('Z') || lastHeartbeat.includes('+') ? lastHeartbeat : lastHeartbeat + 'Z';
  return (Date.now() - new Date(normalized).getTime()) / 1000 < 180;
}

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;

    let cancelled = false;
    async function loadAgent() {
      try {
        setLoading(true);
        const data = await agentApi.getAgent(agentId!);
        if (!cancelled) setAgent(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load agent');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAgent();
    return () => { cancelled = true; };
  }, [agentId]);

  // Silent poll — visibility-aware, pauses when tab is hidden
  const pollAgent = useCallback(async () => {
    if (!agentId) return;
    try {
      const data = await agentApi.getAgent(agentId);
      setAgent(data);
    } catch {
      // Silent — don't surface transient poll failures
    }
  }, [agentId]);

  usePolling(pollAgent, 30_000);

  if (loading) {
    return (
      <PageContainer>
        <div className="min-h-[400px] flex items-center justify-center">
          <Loading message="Loading agent details..." />
        </div>
      </PageContainer>
    );
  }

  if (error || !agent) {
    return (
      <PageContainer>
        <PageHeader title="Agent Not Found" />
        <Alert variant="destructive">{error || 'Agent not found'}</Alert>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/endpoints/agents')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Agents
        </Button>
      </PageContainer>
    );
  }

  const online = isOnline(agent.last_heartbeat);

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6 flex items-start gap-3 sm:items-center sm:gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/endpoints/agents')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="break-all text-xl font-bold sm:text-2xl">{agent.hostname}</h1>
            <StatusDot status={online ? 'online' : 'offline'} />
            <Badge variant={agent.status === 'active' ? 'success' : 'warning'}>
              {agent.status}
            </Badge>
            <PlatformBadge platform={agent.os} />
            <span className="font-mono text-sm text-muted-foreground">
              {agent.arch} &middot; v{agent.agent_version}
            </span>
          </div>
          <p className="mt-1 break-all text-sm text-muted-foreground">
            ID: <span className="font-mono">{agent.id}</span>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="max-w-full flex-nowrap overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Task History</TabsTrigger>
          <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
          <TabsTrigger value="events">Event Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <AgentOverviewTab agent={agent} />
        </TabsContent>
        <TabsContent value="tasks">
          <AgentTaskHistoryTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="heartbeat">
          <AgentHeartbeatTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="events">
          <AgentEventLogTab agentId={agent.id} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
