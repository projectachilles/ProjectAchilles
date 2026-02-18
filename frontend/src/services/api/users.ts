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

export interface InvitationInfo {
  id: string;
  emailAddress: string;
  role: string | null;
  status: string;
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

  async inviteUser(email: string, role: AppRole): Promise<InvitationInfo> {
    const res = await apiClient.post<{ success: boolean; data: InvitationInfo }>('/users/invite', { email, role });
    return res.data.data;
  },

  async listInvitations(): Promise<InvitationInfo[]> {
    const res = await apiClient.get<{ success: boolean; data: InvitationInfo[] }>('/users/invitations');
    return res.data.data;
  },

  async revokeInvitation(invitationId: string): Promise<void> {
    await apiClient.post(`/users/invitations/${invitationId}/revoke`);
  },

  async deleteUser(userId: string): Promise<void> {
    await apiClient.delete(`/users/${userId}`);
  },
};
