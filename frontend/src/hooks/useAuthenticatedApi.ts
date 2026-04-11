import axios from 'axios';

// Resolve API base URL: runtime env (Docker/PaaS entrypoint) → build-time env → relative path
const apiBaseUrl = window.__env__?.VITE_API_URL || import.meta.env.VITE_API_URL || '';

// Create axios instance
export const apiClient = axios.create({
  baseURL: `${apiBaseUrl}/api`,
  withCredentials: true,
});

// Module-level token getter reference
let tokenGetter: (() => Promise<string | null>) | null = null;

// Register the request interceptor once at module load.
apiClient.interceptors.request.use(async (config) => {
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response error interceptor: surface the backend's error message
apiClient.interceptors.response.use(undefined, (error) => {
  const serverMsg = error?.response?.data?.error;
  if (serverMsg && typeof serverMsg === 'string') {
    error.message = serverMsg;
  }
  return Promise.reject(error);
});

// Response interceptor: catch auth redirects (302) that axios follows silently.
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

/**
 * Set the token getter for API requests.
 * Called from AuthContext when auth state changes.
 */
export function setTokenGetter(getter: (() => Promise<string | null>) | null) {
  tokenGetter = getter;
}
