import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { AboutResponse } from '@/types/about';

export const aboutApi = {
  /** What this install is running. Backend-only: check `capabilities.about` first. */
  async get(): Promise<AboutResponse> {
    const response = await apiClient.get('/about');
    return response.data.data;
  },
};
