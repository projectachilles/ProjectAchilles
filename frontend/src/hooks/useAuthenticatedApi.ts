import { useAuth } from '@clerk/clerk-react';
import { useEffect } from 'react';
import axios from 'axios';

// Create axios instance
export const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`,
  withCredentials: true,
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
