import { apiClient } from '@/hooks/useAuthenticatedApi';
import type {
  Agent,
  AgentSummary,
  AgentMetrics,
  AgentTask,
  AgentVersion,
  EnrollmentToken,
  CreateTokenRequest,
  CreateTasksRequest,
  CreateCommandTasksRequest,
  ListAgentsRequest,
  ListTasksRequest,
  TaskGroup,
  TaskNoteEntry,
  Schedule,
  ScheduleStatus,
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '@/types/agent';

export const agentApi = {
  // --- Config (public) ---

  async getConfig(): Promise<{ server_url: string }> {
    const response = await apiClient.get('/agent/config');
    return response.data.data;
  },

  // --- Agents ---

  async listAgents(params?: ListAgentsRequest): Promise<AgentSummary[]> {
    const response = await apiClient.get('/agent/admin/agents', { params });
    const data = response.data.data;
    // Backend returns { agents: [...], total: N }
    return Array.isArray(data) ? data : data.agents ?? [];
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

  async rotateAgentKey(agentId: string): Promise<{
    agent_id: string;
    agent_key: string;
    rotated_at: string;
    warning: string;
  }> {
    const response = await apiClient.post(`/agent/admin/agents/${agentId}/rotate-key`);
    return response.data.data;
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

  async createTasks(data: CreateTasksRequest): Promise<string[]> {
    const response = await apiClient.post('/agent/admin/tasks', data);
    return response.data.data.task_ids;
  },

  async createCommandTasks(data: CreateCommandTasksRequest): Promise<string[]> {
    const response = await apiClient.post('/agent/admin/tasks/command', data);
    return response.data.data.task_ids;
  },

  async triggerUpdate(data: { org_id: string; agent_ids: string[] }): Promise<string[]> {
    const response = await apiClient.post('/agent/admin/tasks/update', data);
    return response.data.data.task_ids;
  },

  async listTasks(params?: ListTasksRequest): Promise<{ tasks: AgentTask[]; total: number }> {
    const response = await apiClient.get('/agent/admin/tasks', { params });
    const data = response.data.data;
    if (Array.isArray(data)) return { tasks: data, total: data.length };
    return { tasks: data.tasks ?? [], total: data.total ?? 0 };
  },

  async listTasksGrouped(params?: ListTasksRequest): Promise<{ groups: TaskGroup[]; total: number }> {
    const response = await apiClient.get('/agent/admin/tasks/grouped', { params });
    const data = response.data.data;
    return { groups: data.groups ?? [], total: data.total ?? 0 };
  },

  async getTask(taskId: string): Promise<AgentTask> {
    const response = await apiClient.get(`/agent/admin/tasks/${taskId}`);
    return response.data.data;
  },

  async cancelTask(taskId: string): Promise<AgentTask> {
    const response = await apiClient.post(`/agent/admin/tasks/${taskId}/cancel`);
    return response.data.data;
  },

  async deleteTask(taskId: string): Promise<void> {
    await apiClient.delete(`/agent/admin/tasks/${taskId}`);
  },

  async updateTaskNotes(taskId: string, content: string): Promise<AgentTask> {
    const response = await apiClient.patch(`/agent/admin/tasks/${taskId}/notes`, { content });
    return response.data.data;
  },

  // --- Agent Versions ---

  async listVersions(): Promise<AgentVersion[]> {
    const response = await apiClient.get('/agent/admin/versions');
    return response.data.data;
  },

  async uploadVersion(formData: FormData): Promise<AgentVersion> {
    const response = await apiClient.post('/agent/admin/versions/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  },

  async deleteVersion(version: string, os: string, arch: string): Promise<void> {
    await apiClient.delete(`/agent/admin/versions/${encodeURIComponent(version)}/${os}/${arch}`);
  },

  async buildVersion(version: string, os: string, arch: string): Promise<AgentVersion> {
    const response = await apiClient.post('/agent/admin/versions/build', { version, os, arch });
    return response.data.data;
  },

  // --- Schedules ---

  async createSchedule(data: CreateScheduleRequest): Promise<Schedule> {
    const response = await apiClient.post('/agent/admin/schedules', data);
    return response.data.data;
  },

  async listSchedules(params?: { status?: ScheduleStatus }): Promise<Schedule[]> {
    const response = await apiClient.get('/agent/admin/schedules', { params });
    return response.data.data;
  },

  async updateSchedule(id: string, updates: UpdateScheduleRequest): Promise<Schedule> {
    const response = await apiClient.patch(`/agent/admin/schedules/${id}`, updates);
    return response.data.data;
  },

  async deleteSchedule(id: string): Promise<void> {
    await apiClient.delete(`/agent/admin/schedules/${id}`);
  },
};

// Re-export types for convenience
export type {
  Agent,
  AgentSummary,
  AgentMetrics,
  AgentTask,
  AgentVersion,
  EnrollmentToken,
  CreateTokenRequest,
  CreateTasksRequest,
  CreateCommandTasksRequest,
  ListAgentsRequest,
  ListTasksRequest,
  TaskGroup,
  TaskNoteEntry,
  Schedule,
  ScheduleStatus,
  CreateScheduleRequest,
  UpdateScheduleRequest,
};
