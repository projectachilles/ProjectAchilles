import { client } from './client.js';
import type { Schedule, ScheduleStatus } from './types.js';

export interface CreateScheduleParams {
  name?: string;
  agent_ids: string[];
  org_id: string;
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout?: number;
  priority?: number;
  metadata?: Record<string, unknown>;
  schedule_type: 'once' | 'daily' | 'weekly' | 'monthly';
  schedule_config: Record<string, unknown>;
  timezone?: string;
  target_index?: string;
}

export async function createSchedule(params: CreateScheduleParams): Promise<Schedule> {
  return client.post('/api/agent/admin/schedules', { body: params });
}

export async function listSchedules(params: {
  org_id?: string;
  status?: ScheduleStatus;
} = {}): Promise<Schedule[]> {
  return client.get('/api/agent/admin/schedules', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getSchedule(id: string): Promise<Schedule> {
  return client.get(`/api/agent/admin/schedules/${id}`);
}

export async function updateSchedule(id: string, update: {
  status?: 'active' | 'paused';
  cron?: string;
  payload?: Record<string, unknown>;
  name?: string;
  agent_ids?: string[];
  schedule_config?: Record<string, unknown>;
  timezone?: string;
  priority?: number;
  execution_timeout?: number;
}): Promise<Schedule> {
  return client.patch(`/api/agent/admin/schedules/${id}`, { body: update });
}

export async function deleteSchedule(id: string): Promise<null> {
  return client.delete(`/api/agent/admin/schedules/${id}`);
}
