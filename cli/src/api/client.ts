/**
 * Base HTTP client for the ProjectAchilles API.
 *
 * Uses Bun's native fetch. Handles:
 * - Auth header injection from token store
 * - Token refresh on 401
 * - { success, data } envelope unwrapping
 * - Typed error propagation
 * - Query parameter serialization
 * - AbortController support
 */

import { getServerUrl } from '../config/store.js';
import { getAccessToken, loadTokens, saveTokens, isTokenExpired } from '../auth/token-store.js';
import { USER_AGENT } from '../config/constants.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends ApiError {
  constructor(message = 'Not authenticated. Run `achilles login` first.') {
    super(message, 401);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip auth header (for public endpoints) */
  noAuth?: boolean;
  /** Return raw Response (for binary downloads) */
  raw?: boolean;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

class HttpClient {
  private get baseUrl(): string {
    return getServerUrl();
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = getAccessToken();
    if (!token) {
      // Try refresh
      const stored = loadTokens();
      if (stored && stored.refresh_token && isTokenExpired(stored)) {
        const refreshed = await this.refreshToken(stored.refresh_token);
        if (refreshed) return { Authorization: `Bearer ${refreshed}` };
      }
      throw new AuthError();
    }
    return { Authorization: `Bearer ${token}` };
  }

  private async refreshToken(refreshToken: string): Promise<string | null> {
    try {
      const resp = await fetch(this.buildUrl('/api/cli/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        success: boolean;
        data: { access_token: string; expires_at: string };
      };
      if (!data.success) return null;
      const stored = loadTokens();
      if (stored) {
        saveTokens({
          ...stored,
          access_token: data.data.access_token,
          expires_at: data.data.expires_at,
        });
      }
      return data.data.access_token;
    } catch {
      return null;
    }
  }

  private async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.params);

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      ...opts.headers,
    };

    if (!opts.noAuth) {
      Object.assign(headers, await this.getAuthHeaders());
    }

    if (opts.body !== undefined && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: opts.body instanceof FormData
          ? opts.body
          : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined,
        signal: opts.signal,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError') throw error;
      throw new NetworkError(
        `Cannot connect to ${this.baseUrl}. Is the backend running?`,
        error,
      );
    }

    // Binary/raw response
    if (opts.raw) return response as unknown as T;

    // Parse JSON body
    let body: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    // Handle HTTP errors
    if (!response.ok) {
      const errMsg = typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: string }).error)
        : `HTTP ${response.status}: ${response.statusText}`;

      if (response.status === 401) throw new AuthError(errMsg);
      throw new ApiError(errMsg, response.status, body);
    }

    // Unwrap { success: true, data: T } envelope
    if (typeof body === 'object' && body !== null && 'success' in body) {
      const envelope = body as { success: boolean; data?: T; error?: string };
      if (!envelope.success) {
        throw new ApiError(envelope.error ?? 'Unknown error', response.status, body);
      }
      // Some endpoints return { success: true } with no data field
      if ('data' in envelope) return envelope.data as T;
      return body as T;
    }

    return body as T;
  }

  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  async post<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, opts);
  }

  async put<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, opts);
  }

  async patch<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, opts);
  }

  async delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, opts);
  }
}

/** Singleton API client */
export const client = new HttpClient();
