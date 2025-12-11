/**
 * Sensors Service
 * Based on internal/api/sensors.go
 */

import axios from 'axios';
import {
  Credentials,
  Sensor,
  ListSensorsRequest,
  ListSensorsResponse,
  OnlineStatusResponse,
  Platform,
  PlatformID,
} from '../../types/endpoints.js';
import { authService } from './auth.service.js';

const API_BASE_URL = process.env.LC_API_BASE_URL || 'https://api.limacharlie.io';

export class SensorsService {
  /**
   * List sensors with optional filtering
   * BUG FIX #2: Returns {sensors, total} instead of just sensors
   * BUG FIX #3: Platform ID conversion implemented
   */
  async listSensors(
    credentials: Credentials,
    options: ListSensorsRequest = {}
  ): Promise<{ sensors: Sensor[]; total: number }> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const params = new URLSearchParams();

      // Don't send limit/offset to API - we'll handle pagination client-side after filtering
      if (options.withTags) params.set('with_tags', 'true');
      if (options.withIp) params.set('with_ip', options.withIp);
      if (options.withHostnamePrefix) {
        params.set('with_hostname_prefix', options.withHostnamePrefix);
      }
      // Note: onlyOnline is NOT an API parameter - it's applied client-side below

      const url = `${API_BASE_URL}/v1/sensors/${credentials.oid}?${params.toString()}`;
      const response = await axios.get<ListSensorsResponse>(url, {
        headers: { Authorization: authHeader },
      });

      let sensors = response.data.sensors || [];

      // Apply client-side filters for options not supported by API
      if (options.onlyOnline) {
        sensors = sensors.filter((s) => s.is_online === true);
      }

      if (options.filterHostname) {
        sensors = this.filterByHostname(sensors, options.filterHostname);
      }

      if (options.filterPlatform) {
        if (options.filterPlatform === Platform.LC_SECOPS) {
          // Filter for LC_SecOps: any platform ID that's not Windows/macOS/Linux
          sensors = sensors.filter(
            (s) =>
              s.plat !== PlatformID.WINDOWS &&
              s.plat !== PlatformID.MACOS &&
              s.plat !== PlatformID.LINUX
          );
        } else {
          const platformId = this.getPlatformId(options.filterPlatform);
          sensors = sensors.filter((s) => s.plat === platformId);
        }
      }

      if (options.filterTag) {
        sensors = sensors.filter(
          (s) => s.tags && s.tags.includes(options.filterTag!)
        );
      }

      // Store total before pagination
      const total = sensors.length;

      // Apply pagination
      const offset = options.offset || 0;
      const limit = options.limit || 50;
      const paginatedSensors = sensors.slice(offset, offset + limit);

      return { sensors: paginatedSensors, total };
    } catch (error) {
      if (authService.isAuthError(error)) {
        // Clear token and retry once
        authService.clearToken(credentials);
        return this.listSensors(credentials, options);
      }
      throw this.handleError(error, 'Failed to list sensors');
    }
  }

  /**
   * Get online status for sensors
   */
  async getOnlineStatus(
    credentials: Credentials,
    sensorIds: string[]
  ): Promise<OnlineStatusResponse> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/sensors/${credentials.oid}/online`;

      const response = await axios.post<OnlineStatusResponse>(
        url,
        { sensor_ids: sensorIds },
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.getOnlineStatus(credentials, sensorIds);
      }
      throw this.handleError(error, 'Failed to get online status');
    }
  }

  /**
   * Add tag to sensor
   */
  async tagSensor(
    credentials: Credentials,
    sensorId: string,
    tag: string,
    ttl?: number
  ): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const params = new URLSearchParams();
      params.set('tags', tag);
      if (ttl) params.set('ttl', ttl.toString());

      const url = `${API_BASE_URL}/v1/${sensorId}/tags?${params.toString()}`;

      await axios.post(url, null, {
        headers: {
          Authorization: authHeader,
        },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.tagSensor(credentials, sensorId, tag, ttl);
      }
      throw this.handleError(error, 'Failed to tag sensor');
    }
  }

  /**
   * Remove tag from sensor
   */
  async untagSensor(
    credentials: Credentials,
    sensorId: string,
    tag: string
  ): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const params = new URLSearchParams();
      params.set('tags', tag);

      const url = `${API_BASE_URL}/v1/${sensorId}/tags?${params.toString()}`;

      await axios.delete(url, {
        headers: {
          Authorization: authHeader,
        },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.untagSensor(credentials, sensorId, tag);
      }
      throw this.handleError(error, 'Failed to untag sensor');
    }
  }

  /**
   * Isolate sensor from network (segregate_network)
   */
  async isolateSensor(credentials: Credentials, sensorId: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/${sensorId}`;

      await axios.post(
        url,
        new URLSearchParams({
          tasks: 'segregate_network',
        }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.isolateSensor(credentials, sensorId);
      }
      throw this.handleError(error, 'Failed to isolate sensor');
    }
  }

  /**
   * Remove network isolation from sensor (rejoin_network)
   */
  async rejoinSensor(credentials: Credentials, sensorId: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/${sensorId}`;

      await axios.post(
        url,
        new URLSearchParams({
          tasks: 'rejoin_network',
        }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.rejoinSensor(credentials, sensorId);
      }
      throw this.handleError(error, 'Failed to rejoin sensor');
    }
  }

  /**
   * Get sensor by ID
   */
  async getSensor(credentials: Credentials, sensorId: string): Promise<Sensor | null> {
    try {
      const result = await this.listSensors(credentials);
      return result.sensors.find((s) => s.sid === sensorId) || null;
    } catch (error) {
      throw this.handleError(error, 'Failed to get sensor');
    }
  }

  /**
   * Filter sensors by hostname (supports wildcards)
   */
  private filterByHostname(sensors: Sensor[], pattern: string): Sensor[] {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*') // Replace * with .*
      .replace(/\?/g, '.'); // Replace ? with .

    const regex = new RegExp(`^${regexPattern}$`, 'i');

    return sensors.filter((s) => regex.test(s.hostname));
  }

  /**
   * Get platform ID from platform name (BUG FIX #3)
   */
  private getPlatformId(platform: string): number {
    switch (platform.toLowerCase()) {
      case Platform.WINDOWS:
        return PlatformID.WINDOWS;
      case Platform.MACOS:
        return PlatformID.MACOS;
      case Platform.LINUX:
        return PlatformID.LINUX;
      case Platform.LC_SECOPS:
        // LC_SecOps is handled separately in filterPlatform
        throw new Error('LC_SecOps platform should be handled separately');
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
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
export const sensorsService = new SensorsService();
