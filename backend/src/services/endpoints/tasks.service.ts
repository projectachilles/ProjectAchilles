/**
 * Tasks Service
 * Based on internal/api/tasks.go
 */

import axios from 'axios';
import {
  Credentials,
  TaskResponse,
  ReliableTaskRequest,
  PutPayloadRequest,
  RunCommandRequest,
} from '../../types/endpoints.js';
import { authService } from './auth.service.js';
import { sensorsService } from './sensors.service.js';

const API_BASE_URL = process.env.LC_API_BASE_URL || 'https://api.limacharlie.io';
const DEFAULT_TTL = 604800; // 7 days in seconds
const DEFAULT_PAYLOAD_BASE_PATH = 'c:\\F0';

export class TasksService {
  /**
   * Send task to sensor
   */
  async taskSensor(
    credentials: Credentials,
    sensorId: string,
    tasks: string[],
    investigationId?: string
  ): Promise<TaskResponse> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/${sensorId}`;

      const formData = new URLSearchParams();
      formData.append('tasks', tasks.join(','));
      if (investigationId) {
        formData.append('investigation_id', investigationId);
      }

      const response = await axios.post<TaskResponse>(url, formData, {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return response.data;
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.taskSensor(credentials, sensorId, tasks, investigationId);
      }
      throw this.handleError(error, 'Failed to task sensor');
    }
  }

  /**
   * Create reliable task (with retry mechanism)
   */
  async createReliableTask(
    credentials: Credentials,
    sensorId: string,
    command: string,
    context: string,
    ttl: number = DEFAULT_TTL
  ): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/extension/request/ext-reliable-tasking?oid=${credentials.oid}&action=task`;

      const taskData: ReliableTaskRequest = {
        task: command,
        ttl: ttl,
        sid: sensorId,
        context: context,
      };

      const formData = new URLSearchParams();
      formData.append('data', JSON.stringify(taskData));

      await axios.post(url, formData, {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.createReliableTask(credentials, sensorId, command, context, ttl);
      }
      throw this.handleError(error, 'Failed to create reliable task');
    }
  }

  /**
   * Put payload (upload file to sensor)
   */
  async putPayload(
    credentials: Credentials,
    request: PutPayloadRequest
  ): Promise<Map<string, TaskResponse>> {
    try {
      // Get sensors matching filters
      const result = await sensorsService.listSensors(credentials, {
        filterHostname: request.filterHostname,
        filterPlatform: request.filterPlatform,
        filterTag: request.filterTag,
        onlyOnline: request.onlineOnly,
      });

      const sensors = result.sensors;

      if (sensors.length === 0) {
        throw new Error('No sensors match the specified filters');
      }

      const results = new Map<string, TaskResponse>();
      const ttl = request.ttl || DEFAULT_TTL;
      const context = request.context || `put_${request.payloadName}`;

      // Execute put command on each sensor
      for (const sensor of sensors) {
        const command = `run --shell-command "put ${request.payloadPath} ${request.payloadName}"`;

        try {
          await this.createReliableTask(
            credentials,
            sensor.sid,
            command,
            context,
            ttl
          );
          results.set(sensor.sid, { id: context });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          results.set(sensor.sid, { error: errorMessage });
        }
      }

      return results;
    } catch (error) {
      throw this.handleError(error, 'Failed to put payload');
    }
  }

  /**
   * Run command on sensors
   */
  async runCommand(
    credentials: Credentials,
    request: RunCommandRequest
  ): Promise<Map<string, TaskResponse>> {
    try {
      // Get sensors matching filters
      const result = await sensorsService.listSensors(credentials, {
        filterHostname: request.filterHostname,
        filterPlatform: request.filterPlatform,
        filterTag: request.filterTag,
        onlyOnline: request.onlineOnly,
      });

      const sensors = result.sensors;

      if (sensors.length === 0) {
        throw new Error('No sensors match the specified filters');
      }

      const results = new Map<string, TaskResponse>();
      const ttl = request.ttl || DEFAULT_TTL;

      // Determine command to execute
      let command: string;
      let context: string;

      if (request.command) {
        command = `run --shell-command "${request.command}"`;
        context = request.context || 'run_command';
      } else if (request.payloadName) {
        const basePath = request.payloadBasePath || DEFAULT_PAYLOAD_BASE_PATH;
        const fullPath = `${basePath}\\${request.payloadName}`;
        command = `run --shell-command "${fullPath}"`;
        context = request.context || `run_${request.payloadName}`;
      } else {
        throw new Error('Either command or payloadName must be specified');
      }

      // Execute command on each sensor
      for (const sensor of sensors) {
        try {
          await this.createReliableTask(
            credentials,
            sensor.sid,
            command,
            context,
            ttl
          );
          results.set(sensor.sid, { id: context });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          results.set(sensor.sid, { error: errorMessage });
        }
      }

      return results;
    } catch (error) {
      throw this.handleError(error, 'Failed to run command');
    }
  }

  /**
   * Run command with custom investigation ID (using reliable tasking)
   */
  async runCommandWithInvestigation(
    credentials: Credentials,
    sensorId: string,
    command: string,
    investigationId: string
  ): Promise<TaskResponse> {
    const taskCommand = `run --shell-command "${command}"`;
    const context = investigationId || `run_${Date.now()}`;

    await this.createReliableTask(
      credentials,
      sensorId,
      taskCommand,
      context,
      DEFAULT_TTL
    );

    return { id: context };
  }

  /**
   * Put file with custom investigation ID (using reliable tasking)
   * Uses LimaCharlie's 'put' task to deploy a payload from LC storage to sensor
   */
  async putFileWithInvestigation(
    credentials: Credentials,
    sensorId: string,
    sourcePath: string,
    destPath: string,
    investigationId: string
  ): Promise<TaskResponse> {
    // Format: put --payload-name <filename> --payload-path '<destination>'
    // sourcePath is the payload name in LimaCharlie storage
    // destPath is where to write it on the sensor
    const taskCommand = `put --payload-name ${sourcePath} --payload-path '${destPath}'`;
    const context = investigationId || `put_${sourcePath}_${Date.now()}`;

    await this.createReliableTask(
      credentials,
      sensorId,
      taskCommand,
      context,
      DEFAULT_TTL
    );

    return { id: context };
  }

  /**
   * Handle errors and provide meaningful messages
   */
  private handleError(error: any, defaultMessage: string): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      return new Error(`${defaultMessage}: ${status ? `[${status}] ` : ''}${message}`);
    }
    return error instanceof Error ? error : new Error(defaultMessage);
  }
}

// Singleton instance
export const tasksService = new TasksService();
