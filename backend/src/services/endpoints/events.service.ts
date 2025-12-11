/**
 * Events Service
 * Handles LimaCharlie event queries using LCQL
 */

import axios from 'axios';
import { Credentials } from '../../types/endpoints.js';
import { authService } from './auth.service.js';

const API_BASE_URL = process.env.LC_API_BASE_URL || 'https://api.limacharlie.io';
const MAX_AUTH_RETRIES = 1; // Only retry authentication once to prevent infinite loops

interface ReplayRequest {
  oid: string;
  query: string;
  limit_event: number;
  limit_eval: number;
  is_dry_run: boolean;
  event_source: {
    stream: string;
    sensor_events: {
      cursor: string;
    };
  };
}

interface Event {
  data: Record<string, any>;
  event_type?: string;
  ts?: string;
  sid?: string;
  routing?: Record<string, any>;
  receipt?: Record<string, any>;
}

interface ReplayResponse {
  results: Event[];
  stats?: Record<string, any>;
}

export class EventsService {
  /**
   * Get organization-specific URLs
   */
  private async getOrgURLs(
    credentials: Credentials,
    retryCount: number = 0
  ): Promise<Record<string, string>> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/orgs/${credentials.oid}/url`;

      const response = await axios.get<{ url: Record<string, string> }>(url, {
        headers: { Authorization: authHeader },
      });

      return response.data.url;
    } catch (error) {
      if (authService.isAuthError(error) && retryCount < MAX_AUTH_RETRIES) {
        authService.clearToken(credentials);
        // Retry with incremented counter
        return this.getOrgURLs(credentials, retryCount + 1);
      }
      throw this.handleError(error, 'Failed to get organization URLs');
    }
  }

  /**
   * Query events using LCQL
   */
  async queryEvents(
    credentials: Credentials,
    query: string,
    limit: number = 100,
    timeout: number = 300,
    retryCount: number = 0
  ): Promise<ReplayResponse> {
    try {
      // Get organization URLs
      const orgURLs = await this.getOrgURLs(credentials);

      if (!orgURLs.replay) {
        throw new Error('Replay URL not found in organization URLs');
      }

      // Ensure URL has protocol
      let replayURL = orgURLs.replay;
      if (!replayURL.startsWith('http://') && !replayURL.startsWith('https://')) {
        replayURL = `https://${replayURL}`;
      }

      // Build request
      const requestBody: ReplayRequest = {
        oid: credentials.oid,
        query: query,
        limit_event: limit,
        limit_eval: 0,
        is_dry_run: false,
        event_source: {
          stream: 'event',
          sensor_events: {
            cursor: '',
          },
        },
      };

      const authHeader = await authService.getAuthHeader(credentials);

      // Execute query
      const response = await axios.post<ReplayResponse>(
        replayURL,
        requestBody,
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          timeout: timeout * 1000, // Convert to milliseconds
        }
      );

      // Transform results: extract 'data' from each result item
      const transformedResponse = {
        ...response.data,
        results: response.data.results?.map((result: any) => result.data || result) || []
      };

      return transformedResponse;
    } catch (error) {
      if (authService.isAuthError(error) && retryCount < MAX_AUTH_RETRIES) {
        authService.clearToken(credentials);
        // Retry with incremented counter and exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        return this.queryEvents(credentials, query, limit, timeout, retryCount + 1);
      }
      throw this.handleError(error, 'Failed to query events');
    }
  }

  /**
   * Query events by investigation ID
   */
  async queryEventsByInvestigation(
    credentials: Credentials,
    investigationId: string,
    startTime?: Date,
    endTime?: Date,
    limit: number = 100
  ): Promise<ReplayResponse> {
    // Build time range filter
    let timeFilter = '';
    if (startTime && endTime) {
      const startTs = Math.floor(startTime.getTime() / 1000);
      const endTs = Math.floor(endTime.getTime() / 1000);
      timeFilter = ` AND ts > ${startTs} AND ts < ${endTs}`;
    }

    // Build query
    const query = `event/investigation_id = "${investigationId}"${timeFilter}`;

    return this.queryEvents(credentials, query, limit);
  }

  /**
   * Query events by sensor ID
   */
  async queryEventsBySensor(
    credentials: Credentials,
    sensorId: string,
    eventType?: string,
    startTime?: Date,
    endTime?: Date,
    limit: number = 100
  ): Promise<ReplayResponse> {
    // Build query parts
    const parts: string[] = [`routing/sid = "${sensorId}"`];

    if (eventType) {
      parts.push(`event_type = "${eventType}"`);
    }

    if (startTime && endTime) {
      const startTs = Math.floor(startTime.getTime() / 1000);
      const endTs = Math.floor(endTime.getTime() / 1000);
      parts.push(`ts > ${startTs}`);
      parts.push(`ts < ${endTs}`);
    }

    const query = parts.join(' AND ');

    return this.queryEvents(credentials, query, limit);
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
export const eventsService = new EventsService();
