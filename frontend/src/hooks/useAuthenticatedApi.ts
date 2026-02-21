import { useAuth } from '@clerk/clerk-react';
import { useEffect } from 'react';
import axios from 'axios';

// Resolve API base URL: runtime env (Docker/PaaS entrypoint) → build-time env → relative path
const apiBaseUrl = window.__env__?.VITE_API_URL || import.meta.env.VITE_API_URL || '';

// Create axios instance
export const apiClient = axios.create({
  baseURL: `${apiBaseUrl}/api`,
  withCredentials: true,
});

// Module-level token getter reference — updated synchronously during render
// so it's available before any child useEffect fires (eliminates the race
// condition where child effects called the API before the parent's useEffect
// registered the interceptor).
let tokenGetter: (() => Promise<string | null>) | null = null;

// Register the request interceptor once at module load. It always exists, but
// only attaches a JWT when tokenGetter has been set by useAuthenticatedApi().
apiClient.interceptors.request.use(async (config) => {
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response error interceptor: surface the backend's error message so catch
// blocks that read err.message get the real detail instead of "Request failed
// with status code 400".
apiClient.interceptors.response.use(undefined, (error) => {
  const serverMsg = error?.response?.data?.error;
  if (serverMsg && typeof serverMsg === 'string') {
    error.message = serverMsg;
  }
  return Promise.reject(error);
});

// Response interceptor: catch auth redirects (302) that axios follows silently.
// When Clerk returns a redirect, the final response is often HTML — detect this
// and throw a clear error instead of letting callers parse undefined fields.
apiClient.interceptors.response.use((response) => {
  const ct = response.headers['content-type'] || '';
  if (response.config.responseType !== 'blob' && !ct.includes('application/json') && response.config.url) {
    throw new axios.AxiosError(
      'Session expired or authentication failed',
      'ERR_AUTH_REDIRECT',
      response.config,
      response.request,
      response,
    );
  }
  return response;
});

export function useAuthenticatedApi() {
  const { getToken } = useAuth();

  // Set synchronously during render — runs in AppContent's render pass,
  // which completes before any child useEffect fires.
  tokenGetter = getToken;

  // Clear on unmount so stale getToken refs aren't called after sign-out.
  useEffect(() => {
    return () => { tokenGetter = null; };
  }, []);
}
