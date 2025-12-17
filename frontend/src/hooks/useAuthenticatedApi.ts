import { useAuth } from '@clerk/clerk-react';
import { useEffect } from 'react';
import axios from 'axios';

// Helper to get CSRF token from cookie
function getCsrfToken(): string | null {
  const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  return match ? match[1] : null;
}

// Create axios instance
export const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api`,
  withCredentials: true,
});

// Add CSRF token to all state-changing requests
apiClient.interceptors.request.use((config) => {
  const csrfMethods = ['post', 'put', 'delete', 'patch'];
  if (config.method && csrfMethods.includes(config.method.toLowerCase())) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }
  }
  return config;
});

export function useAuthenticatedApi() {
  const { getToken } = useAuth();

  useEffect(() => {
    const interceptor = apiClient.interceptors.request.use(
      async (config) => {
        const token = await getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      }
    );

    return () => {
      apiClient.interceptors.request.eject(interceptor);
    };
  }, [getToken]);
}
