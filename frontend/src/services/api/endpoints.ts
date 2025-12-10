import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true, // Required for session cookies
});

export interface Organization {
  id: string;
  name: string;
  oid: string;
}

export interface LoginResponse {
  success: boolean;
  organizations: Organization[];
  currentOrg: Organization | null;
}

export interface SessionResponse {
  authenticated: boolean;
  organizations: Organization[];
  currentOrg: Organization | null;
}

export interface Sensor {
  sid: string;
  hostname: string;
  platform: string;
  architecture: string;
  internalIp: string;
  externalIp: string;
  macAddress: string;
  isOnline: boolean;
  lastSeen: string;
  enrolledAt: string;
  tags: string[];
  agentVersion: string;
}

export interface SensorFilters {
  platform?: string;
  hostname?: string;
  tag?: string;
  isOnline?: boolean;
}

export const endpointsApi = {
  // Authentication
  async login(credentials: { oid: string; apiKey: string }): Promise<LoginResponse> {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },

  async checkSession(): Promise<SessionResponse> {
    const response = await api.get('/auth/session');
    return response.data;
  },

  async switchOrg(oid: string): Promise<{ currentOrg: Organization }> {
    const response = await api.post('/auth/switch-org', { oid });
    return response.data;
  },

  // Sensors
  async getSensors(filters?: SensorFilters): Promise<Sensor[]> {
    const response = await api.get('/endpoints/sensors', { params: filters });
    return response.data;
  },

  async getSensor(sid: string): Promise<Sensor> {
    const response = await api.get(`/endpoints/sensors/${sid}`);
    return response.data;
  },

  async tagSensor(sid: string, tag: string): Promise<void> {
    await api.post(`/endpoints/sensors/${sid}/tag`, { tag });
  },

  async untagSensor(sid: string, tag: string): Promise<void> {
    await api.delete(`/endpoints/sensors/${sid}/tag`, { data: { tag } });
  },

  async isolateSensor(sid: string): Promise<void> {
    await api.post(`/endpoints/sensors/${sid}/isolate`);
  },

  async rejoinSensor(sid: string): Promise<void> {
    await api.post(`/endpoints/sensors/${sid}/rejoin`);
  },

  // Tasks
  async runCommand(sensorIds: string[], command: string, investigationId?: string): Promise<{ taskId: string }> {
    const response = await api.post('/endpoints/tasks/run', {
      sensorIds,
      command,
      investigationId,
    });
    return response.data;
  },

  async deployPayload(
    sensorIds: string[],
    payloadName: string,
    destinationPath: string
  ): Promise<{ taskId: string }> {
    const response = await api.post('/endpoints/tasks/put', {
      sensorIds,
      payloadName,
      destinationPath,
    });
    return response.data;
  },

  // Payloads
  async getPayloads(): Promise<Array<{ name: string; size: number; createdAt: string }>> {
    const response = await api.get('/endpoints/payloads');
    return response.data;
  },

  async uploadPayload(file: File): Promise<{ name: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/endpoints/payloads/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deletePayload(name: string): Promise<void> {
    await api.delete(`/endpoints/payloads/${encodeURIComponent(name)}`);
  },

  // Events
  async queryEvents(params: {
    query?: string;
    sensorId?: string;
    investigationId?: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const response = await api.post('/endpoints/events/query', params);
    return response.data;
  },
};
