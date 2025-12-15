/**
 * API Client for LimaCharlie Sensor Management Backend
 */

import { apiClient } from '@/hooks/useAuthenticatedApi';
import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  SessionInfo,
  Sensor,
  ListSensorsRequest,
  PutPayloadRequest,
  RunCommandRequest,
  TaskResults,
  Payload,
  EventsQueryResponse,
} from '../../types/endpoints';

class ApiClient {
  private client = apiClient;

  constructor() {
    // Add response interceptor for error handling (endpoints-specific)
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && window.location.pathname.startsWith('/endpoints')) {
          // Handle unauthorized for endpoints module - redirect to endpoints login
          window.location.href = '/endpoints/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async login(data: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    const response = await this.client.post<ApiResponse<LoginResponse>>(
      '/auth/login',
      data
    );
    return response.data;
  }

  async logout(): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>('/auth/logout');
    return response.data;
  }

  async getSession(): Promise<ApiResponse<SessionInfo>> {
    const response = await this.client.get<ApiResponse<SessionInfo>>('/auth/session');
    return response.data;
  }

  async switchOrg(orgId: string): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>('/auth/switch-org', {
      orgId,
    });
    return response.data;
  }

  async validateCredentials(oid: string, apiKey: string): Promise<ApiResponse<{ valid: boolean }>> {
    const response = await this.client.post<ApiResponse<{ valid: boolean }>>(
      '/auth/validate',
      { oid, apiKey }
    );
    return response.data;
  }

  // ============================================================================
  // SENSORS
  // ============================================================================

  async listSensors(
    params?: ListSensorsRequest
  ): Promise<ApiResponse<{ sensors: Sensor[]; total: number; count: number }>> {
    const response = await this.client.get<
      ApiResponse<{ sensors: Sensor[]; total: number; count: number }>
    >('/endpoints/sensors', { params });
    return response.data;
  }

  async getSensor(sensorId: string): Promise<ApiResponse<Sensor>> {
    const response = await this.client.get<ApiResponse<Sensor>>(
      `/endpoints/sensors/${sensorId}`
    );
    return response.data;
  }

  async getOnlineStatus(
    sensorIds: string[]
  ): Promise<ApiResponse<{ statuses: Record<string, boolean> }>> {
    const response = await this.client.post<
      ApiResponse<{ statuses: Record<string, boolean> }>
    >('/endpoints/sensors/online-status', { sensorIds });
    return response.data;
  }

  async tagSensor(
    sensorId: string,
    tag: string,
    ttl?: number
  ): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>(
      `/endpoints/sensors/${sensorId}/tag`,
      { tag, ttl }
    );
    return response.data;
  }

  async untagSensor(sensorId: string, tag: string): Promise<ApiResponse> {
    const response = await this.client.delete<ApiResponse>(
      `/endpoints/sensors/${sensorId}/tag`,
      { data: { tag } }
    );
    return response.data;
  }

  async bulkTag(
    sensorIds: string[],
    tag: string,
    ttl?: number
  ): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>('/endpoints/sensors/bulk/tag', {
      sensorIds,
      tag,
      ttl,
    });
    return response.data;
  }

  async bulkUntag(sensorIds: string[], tag: string): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>('/endpoints/sensors/bulk/untag', {
      sensorIds,
      tag,
    });
    return response.data;
  }

  async isolateSensor(sensorId: string): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>(
      `/endpoints/sensors/${sensorId}/isolate`
    );
    return response.data;
  }

  async rejoinSensor(sensorId: string): Promise<ApiResponse> {
    const response = await this.client.post<ApiResponse>(
      `/endpoints/sensors/${sensorId}/rejoin`
    );
    return response.data;
  }

  // ============================================================================
  // TASKS
  // ============================================================================

  async putPayload(data: PutPayloadRequest): Promise<ApiResponse<TaskResults>> {
    const response = await this.client.post<ApiResponse<TaskResults>>(
      '/endpoints/tasks/put',
      data
    );
    return response.data;
  }

  async runCommand(data: RunCommandRequest): Promise<ApiResponse<TaskResults>> {
    const response = await this.client.post<ApiResponse<TaskResults>>(
      '/endpoints/tasks/run',
      data
    );
    return response.data;
  }

  async runCommandOnSensor(
    sensorId: string,
    command: string,
    investigationId?: string
  ): Promise<ApiResponse<{ id?: string; error?: string }>> {
    const response = await this.client.post<
      ApiResponse<{ id?: string; error?: string }>
    >(`/endpoints/tasks/sensor/${sensorId}/run`, {
      command,
      investigationId,
    });
    return response.data;
  }

  async putFileOnSensor(
    sensorId: string,
    sourcePath: string,
    destPath: string,
    investigationId?: string
  ): Promise<ApiResponse<{ id?: string; error?: string }>> {
    const response = await this.client.post<
      ApiResponse<{ id?: string; error?: string }>
    >(`/endpoints/tasks/sensor/${sensorId}/put`, {
      sourcePath,
      destPath,
      investigationId,
    });
    return response.data;
  }

  // ============================================================================
  // PAYLOADS
  // ============================================================================

  async uploadPayload(file: File): Promise<ApiResponse<{ name: string }>> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post<ApiResponse<{ name: string }>>(
      '/endpoints/payloads/upload',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  }

  async getDownloadUrl(
    name: string
  ): Promise<ApiResponse<{ url: string; name: string }>> {
    const response = await this.client.get<
      ApiResponse<{ url: string; name: string }>
    >(`/endpoints/payloads/${name}/download-url`);
    return response.data;
  }

  async listPayloads(): Promise<ApiResponse<{ payloads: Payload[]; count: number }>> {
    const response = await this.client.get<
      ApiResponse<{ payloads: Payload[]; count: number }>
    >('/endpoints/payloads');
    return response.data;
  }

  async deletePayload(name: string): Promise<ApiResponse> {
    const response = await this.client.delete<ApiResponse>(`/endpoints/payloads/${name}`);
    return response.data;
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  async queryEvents(
    query: string,
    limit?: number,
    timeout?: number
  ): Promise<ApiResponse<EventsQueryResponse>> {
    const response = await this.client.post<ApiResponse<EventsQueryResponse>>(
      '/endpoints/events/query',
      { query, limit, timeout }
    );
    return response.data;
  }

  async queryEventsByInvestigation(
    investigationId: string,
    startTime?: string,
    endTime?: string,
    limit?: number
  ): Promise<ApiResponse<EventsQueryResponse>> {
    const response = await this.client.post<ApiResponse<EventsQueryResponse>>(
      '/endpoints/events/by-investigation',
      { investigationId, startTime, endTime, limit }
    );
    return response.data;
  }

  async queryEventsBySensor(
    sensorId: string,
    eventType?: string,
    startTime?: string,
    endTime?: string,
    limit?: number
  ): Promise<ApiResponse<EventsQueryResponse>> {
    const response = await this.client.post<ApiResponse<EventsQueryResponse>>(
      '/endpoints/events/by-sensor',
      { sensorId, eventType, startTime, endTime, limit }
    );
    return response.data;
  }

  // ============================================================================
  // HEALTH
  // ============================================================================

  async healthCheck(): Promise<ApiResponse> {
    const response = await this.client.get<ApiResponse>('/health');
    return response.data;
  }
}

// Export singleton instance
export const api = new ApiClient();
export const endpointsApi = api; // Alias for consistency with other API modules
