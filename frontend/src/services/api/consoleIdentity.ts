import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { ConsoleIdentity, ConsoleIdentityInput } from '@/types/consoleIdentity';

export const consoleIdentityApi = {
  async get(): Promise<ConsoleIdentity> {
    const response = await apiClient.get('/settings/identity');
    return response.data.data;
  },

  async save(input: ConsoleIdentityInput): Promise<ConsoleIdentity> {
    const response = await apiClient.put('/settings/identity', input);
    return response.data.data;
  },

  async reset(): Promise<ConsoleIdentity> {
    const response = await apiClient.delete('/settings/identity');
    return response.data.data;
  },
};
