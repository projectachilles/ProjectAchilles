// Sensors service for LimaCharlie endpoint management

import axios from 'axios';
import { AuthService } from './auth.service.js';
import type {
  Sensor,
  ListSensorsResponse,
  Payload,
  Event,
  QueryEventsRequest,
  QueryEventsResponse,
  TaskResult,
} from '../../types/endpoints.js';

const API_BASE_URL = process.env.LC_API_BASE_URL || 'https://api.limacharlie.io';

const authService = new AuthService();

export class SensorsService {
  private oid: string;
  private apiKey: string;

  constructor(oid: string, apiKey: string) {
    this.oid = oid;
    this.apiKey = apiKey;
  }

  /**
   * List sensors with optional filtering
   */
  async listSensors(
    options: {
      platform?: string;
      hostname?: string;
      tag?: string;
      isOnline?: boolean;
    } = {}
  ): Promise<{ sensors: Sensor[]; total: number }> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const params = new URLSearchParams();
      params.set('with_tags', 'true');

      const url = `${API_BASE_URL}/v1/sensors/${this.oid}?${params.toString()}`;
      const response = await axios.get<ListSensorsResponse>(url, {
        headers: { Authorization: authHeader },
      });

      let sensors = response.data.sensors || [];

      // Apply client-side filters
      if (options.isOnline !== undefined) {
        sensors = sensors.filter((s) => s.is_online === options.isOnline);
      }

      if (options.hostname) {
        const pattern = options.hostname.toLowerCase();
        sensors = sensors.filter((s) =>
          s.hostname.toLowerCase().includes(pattern)
        );
      }

      if (options.tag) {
        sensors = sensors.filter(
          (s) => s.tags && s.tags.includes(options.tag!)
        );
      }

      if (options.platform) {
        const platformId = this.getPlatformId(options.platform);
        if (platformId !== null) {
          sensors = sensors.filter((s) => s.plat === platformId);
        }
      }

      return { sensors, total: sensors.length };
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.listSensors(options);
      }
      throw this.handleError(error, 'Failed to list sensors');
    }
  }

  /**
   * Get sensor by ID
   */
  async getSensor(sensorId: string): Promise<Sensor | null> {
    const { sensors } = await this.listSensors();
    return sensors.find((s) => s.sid === sensorId) || null;
  }

  /**
   * Add tag to sensor
   */
  async addTag(sensorId: string, tag: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const params = new URLSearchParams();
      params.set('tags', tag);

      const url = `${API_BASE_URL}/v1/${sensorId}/tags?${params.toString()}`;

      await axios.post(url, null, {
        headers: { Authorization: authHeader },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.addTag(sensorId, tag);
      }
      throw this.handleError(error, 'Failed to add tag');
    }
  }

  /**
   * Remove tag from sensor
   */
  async removeTag(sensorId: string, tag: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const params = new URLSearchParams();
      params.set('tags', tag);

      const url = `${API_BASE_URL}/v1/${sensorId}/tags?${params.toString()}`;

      await axios.delete(url, {
        headers: { Authorization: authHeader },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.removeTag(sensorId, tag);
      }
      throw this.handleError(error, 'Failed to remove tag');
    }
  }

  /**
   * Isolate sensor from network
   */
  async isolateSensor(sensorId: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const url = `${API_BASE_URL}/v1/${sensorId}`;

      await axios.post(
        url,
        new URLSearchParams({ tasks: 'segregate_network' }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.isolateSensor(sensorId);
      }
      throw this.handleError(error, 'Failed to isolate sensor');
    }
  }

  /**
   * Rejoin sensor to network
   */
  async rejoinSensor(sensorId: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const url = `${API_BASE_URL}/v1/${sensorId}`;

      await axios.post(
        url,
        new URLSearchParams({ tasks: 'rejoin_network' }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.rejoinSensor(sensorId);
      }
      throw this.handleError(error, 'Failed to rejoin sensor');
    }
  }

  /**
   * Run command on sensors
   */
  async runCommand(
    sensorIds: string[],
    command: string,
    investigationId?: string
  ): Promise<TaskResult[]> {
    const results: TaskResult[] = [];

    for (const sensorId of sensorIds) {
      try {
        const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
        const url = `${API_BASE_URL}/v1/${sensorId}`;

        const params = new URLSearchParams();
        params.set('tasks', command);
        if (investigationId) {
          params.set('investigation_id', investigationId);
        }

        await axios.post(url, params, {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        results.push({ sensorId, status: 'success' });
      } catch (error) {
        results.push({
          sensorId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Command failed',
        });
      }
    }

    return results;
  }

  /**
   * Deploy payload to sensors
   */
  async deployPayload(
    sensorIds: string[],
    payloadName: string,
    destinationPath: string
  ): Promise<TaskResult[]> {
    const command = `put ${payloadName} ${destinationPath}`;
    return this.runCommand(sensorIds, command);
  }

  /**
   * List payloads
   */
  async listPayloads(): Promise<Payload[]> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const url = `${API_BASE_URL}/v1/payloads/${this.oid}`;

      const response = await axios.get(url, {
        headers: { Authorization: authHeader },
      });

      const payloadsMap = response.data.payloads || {};
      return Object.entries(payloadsMap).map(([name, info]: [string, any]) => ({
        name,
        size: info?.size,
        uploadedAt: info?.uploaded_at,
        uploadedBy: info?.uploaded_by,
      }));
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.listPayloads();
      }
      throw this.handleError(error, 'Failed to list payloads');
    }
  }

  /**
   * Delete payload
   */
  async deletePayload(name: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const url = `${API_BASE_URL}/v1/payloads/${this.oid}/${name}`;

      await axios.delete(url, {
        headers: { Authorization: authHeader },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.deletePayload(name);
      }
      throw this.handleError(error, 'Failed to delete payload');
    }
  }

  /**
   * Query events
   */
  async queryEvents(options: QueryEventsRequest): Promise<Event[]> {
    try {
      const authHeader = await authService.getAuthHeader(this.oid, this.apiKey);
      const url = `${API_BASE_URL}/v1/insight/${this.oid}`;

      const params = new URLSearchParams();
      params.set('limit', options.limit.toString());
      if (options.query) params.set('query', options.query);
      if (options.sensorId) params.set('sid', options.sensorId);
      if (options.investigationId) {
        params.set('investigation_id', options.investigationId);
      }

      const response = await axios.get<QueryEventsResponse>(
        `${url}?${params.toString()}`,
        {
          headers: { Authorization: authHeader },
        }
      );

      return response.data.events || [];
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(this.oid, this.apiKey);
        return this.queryEvents(options);
      }
      throw this.handleError(error, 'Failed to query events');
    }
  }

  /**
   * Get platform ID from name
   */
  private getPlatformId(platform: string): number | null {
    switch (platform.toLowerCase()) {
      case 'windows':
        return 268435456;
      case 'macos':
        return 805306368;
      case 'linux':
        return 536870912;
      default:
        return null;
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: any, defaultMessage: string): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      return new Error(
        `${defaultMessage}: ${status ? `[${status}] ` : ''}${message}`
      );
    }
    return error instanceof Error ? error : new Error(defaultMessage);
  }
}
