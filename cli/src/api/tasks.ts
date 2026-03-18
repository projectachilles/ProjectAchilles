import { client } from './client.js';
import type { Task, TaskGroup, TaskStatus, TaskType } from './types.js';

export interface CreateTaskParams {
  org_id: string;
  agent_ids: string[];
  type?: TaskType;
  payload: {
    test_uuid: string;
    test_name: string;
    binary_name: string;
    execution_timeout?: number;
    arguments?: string[];
    metadata?: Record<string, unknown>;
  };
  priority?: number;
  target_index?: string;
}

export interface ListTasksParams {
  agent_id?: string;
  org_id?: string;
  status?: TaskStatus;
  type?: TaskType;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function createTasks(params: CreateTaskParams): Promise<{ task_ids: string[] }> {
  return client.post('/api/agent/admin/tasks', { body: params });
}

export async function createCommandTask(params: {
  org_id: string;
  agent_ids: string[];
  command: string;
  execution_timeout?: number;
  priority?: number;
}): Promise<{ task_ids: string[] }> {
  return client.post('/api/agent/admin/tasks/command', { body: params });
}

export async function createUpdateTasks(params: {
  org_id: string;
  agent_ids: string[];
}): Promise<{ task_ids: string[] }> {
  return client.post('/api/agent/admin/tasks/update', { body: params });
}

export async function createUninstallTasks(params: {
  org_id: string;
  agent_ids: string[];
  cleanup?: boolean;
}): Promise<{ task_ids: string[] }> {
  return client.post('/api/agent/admin/tasks/uninstall', { body: params });
}

export async function listTasks(params: ListTasksParams = {}): Promise<{ tasks: Task[]; total: number }> {
  return client.get('/api/agent/admin/tasks', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function listTasksGrouped(params: ListTasksParams = {}): Promise<{ groups: TaskGroup[]; total: number }> {
  return client.get('/api/agent/admin/tasks/grouped', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getTask(id: string): Promise<Task> {
  return client.get(`/api/agent/admin/tasks/${id}`);
}

export async function cancelTask(id: string): Promise<Task> {
  return client.post(`/api/agent/admin/tasks/${id}/cancel`);
}

export async function deleteTask(id: string): Promise<null> {
  return client.delete(`/api/agent/admin/tasks/${id}`);
}

export async function updateNotes(id: string, content: string): Promise<Task> {
  return client.patch(`/api/agent/admin/tasks/${id}/notes`, { body: { content } });
}
