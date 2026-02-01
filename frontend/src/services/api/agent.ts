import { apiClient } from '@/hooks/useAuthenticatedApi';
import type {
  Agent,
  AgentSummary,
  AgentMetrics,
  AgentTask,
  EnrollmentToken,
  CreateTokenRequest,
  CreateTasksRequest,
  ListAgentsRequest,
  ListTasksRequest,
} from '@/types/agent';

export const agentApi = {
  // --- Agents ---

  async listAgents(params?: ListAgentsRequest): Promise<AgentSummary[]> {
    const response = await apiClient.get('/agent/admin/agents', { params });
    return response.data.data;
  },

  async getAgent(agentId: string): Promise<Agent> {
    const response = await apiClient.get(`/agent/admin/agents/${agentId}`);
    return response.data.data;
  },

  async updateAgent(agentId: string, updates: Partial<Pick<Agent, 'status' | 'tags'>>): Promise<Agent> {
    const response = await apiClient.patch(`/agent/admin/agents/${agentId}`, updates);
    return response.data.data;
  },

  async deleteAgent(agentId: string): Promise<void> {
    await apiClient.delete(`/agent/admin/agents/${agentId}`);
  },

  async tagAgent(agentId: string, tag: string): Promise<Agent> {
    const response = await apiClient.post(`/agent/admin/agents/${agentId}/tags`, { tag });
    return response.data.data;
  },

  async untagAgent(agentId: string, tag: string): Promise<Agent> {
    const response = await apiClient.delete(`/agent/admin/agents/${agentId}/tags/${encodeURIComponent(tag)}`);
    return response.data.data;
  },

  async getMetrics(): Promise<AgentMetrics> {
    const response = await apiClient.get('/agent/admin/metrics');
    return response.data.data;
  },

  // --- Enrollment Tokens ---

  async createToken(data: CreateTokenRequest): Promise<EnrollmentToken> {
    const response = await apiClient.post('/agent/admin/tokens', data);
    return response.data.data;
  },

  async listTokens(): Promise<EnrollmentToken[]> {
    const response = await apiClient.get('/agent/admin/tokens');
    return response.data.data;
  },

  async revokeToken(tokenId: string): Promise<void> {
    await apiClient.delete(`/agent/admin/tokens/${tokenId}`);
  },

  // --- Tasks ---

  async createTasks(data: CreateTasksRequest): Promise<AgentTask[]> {
    const response = await apiClient.post('/agent/admin/tasks', data);
    return response.data.data;
  },

  async listTasks(params?: ListTasksRequest): Promise<AgentTask[]> {
    const response = await apiClient.get('/agent/admin/tasks', { params });
    return response.data.data;
  },

  async getTask(taskId: string): Promise<AgentTask> {
    const response = await apiClient.get(`/agent/admin/tasks/${taskId}`);
    return response.data.data;
  },

  async cancelTask(taskId: string): Promise<AgentTask> {
    const response = await apiClient.post(`/agent/admin/tasks/${taskId}/cancel`);
    return response.data.data;
  },
};

// Re-export types for convenience
export type {
  Agent,
  AgentSummary,
  AgentMetrics,
  AgentTask,
  EnrollmentToken,
  CreateTokenRequest,
  CreateTasksRequest,
  ListAgentsRequest,
  ListTasksRequest,
};
