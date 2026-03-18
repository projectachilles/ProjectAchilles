import { client } from './client.js';
import type {
  Agent,
  AgentSummary,
  AgentMetrics,
  HeartbeatHistoryPoint,
  AgentEvent,
  FleetHealthMetrics,
  AgentOS,
  AgentStatus,
} from './types.js';

export interface ListAgentsParams {
  org_id?: string;
  status?: AgentStatus | 'online' | 'offline' | 'stale';
  os?: AgentOS;
  hostname?: string;
  tag?: string;
  online_only?: boolean;
  stale_only?: boolean;
  limit?: number;
  offset?: number;
}

export async function listAgents(params: ListAgentsParams = {}): Promise<{ agents: AgentSummary[]; total: number }> {
  return client.get('/api/agent/admin/agents', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getAgent(id: string): Promise<Agent> {
  return client.get(`/api/agent/admin/agents/${id}`);
}

export async function updateAgent(id: string, update: { status?: AgentStatus; tags?: string[] }): Promise<Agent> {
  return client.patch(`/api/agent/admin/agents/${id}`, { body: update });
}

export async function deleteAgent(id: string): Promise<{ id: string; status: string }> {
  return client.delete(`/api/agent/admin/agents/${id}`);
}

export async function rotateKey(id: string): Promise<{ agent_id: string; agent_key: string; rotated_at: string }> {
  return client.post(`/api/agent/admin/agents/${id}/rotate-key`);
}

export async function addTag(id: string, tag: string): Promise<{ id: string; tags: string[] }> {
  return client.post(`/api/agent/admin/agents/${id}/tags`, { body: { tag } });
}

export async function removeTag(id: string, tag: string): Promise<{ id: string; tags: string[] }> {
  return client.delete(`/api/agent/admin/agents/${id}/tags/${encodeURIComponent(tag)}`);
}

export async function getHeartbeats(id: string, days = 7): Promise<{ heartbeats: HeartbeatHistoryPoint[] }> {
  return client.get(`/api/agent/admin/agents/${id}/heartbeats`, { params: { days } });
}

export async function getEvents(
  id: string,
  params: { limit?: number; offset?: number; event_type?: string } = {},
): Promise<{ events: AgentEvent[]; total: number }> {
  return client.get(`/api/agent/admin/agents/${id}/events`, { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getMetrics(orgId?: string): Promise<AgentMetrics> {
  return client.get('/api/agent/admin/metrics', { params: { org_id: orgId } });
}

export async function getFleetHealth(orgId?: string): Promise<FleetHealthMetrics> {
  return client.get('/api/agent/admin/metrics/fleet-health', { params: { org_id: orgId } });
}

export async function getAutoRotationSettings(): Promise<{ enabled: boolean; intervalDays: number }> {
  return client.get('/api/agent/admin/settings/auto-rotation');
}

export async function setAutoRotationSettings(settings: { enabled: boolean; intervalDays: number }): Promise<{ enabled: boolean; intervalDays: number }> {
  return client.put('/api/agent/admin/settings/auto-rotation', { body: settings });
}
