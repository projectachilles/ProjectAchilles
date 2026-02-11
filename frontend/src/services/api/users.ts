import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { AppRole } from '@/types/roles';

export interface UserInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  imageUrl: string;
  role: AppRole | null;
  lastActiveAt: number | null;
  createdAt: number;
}

export const usersApi = {
  async listUsers(): Promise<UserInfo[]> {
    const res = await apiClient.get<{ success: boolean; data: UserInfo[] }>('/users');
    return res.data.data;
  },

  async setRole(userId: string, role: AppRole): Promise<void> {
    await apiClient.put(`/users/${userId}/role`, { role });
  },

  async removeRole(userId: string): Promise<void> {
    await apiClient.delete(`/users/${userId}/role`);
  },
};
