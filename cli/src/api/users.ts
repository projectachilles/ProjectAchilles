import { client } from './client.js';
import type { User, Invitation, AppRole } from './types.js';

export async function listUsers(): Promise<User[]> {
  return client.get('/api/users');
}

export async function inviteUser(email: string, role: AppRole): Promise<Invitation> {
  return client.post('/api/users/invite', { body: { email, role } });
}

export async function listInvitations(): Promise<Invitation[]> {
  return client.get('/api/users/invitations');
}

export async function revokeInvitation(id: string): Promise<void> {
  await client.post(`/api/users/invitations/${id}/revoke`);
}

export async function setUserRole(userId: string, role: AppRole): Promise<{ userId: string; role: AppRole }> {
  return client.put(`/api/users/${userId}/role`, { body: { role } });
}

export async function removeUserRole(userId: string): Promise<{ userId: string; role: null }> {
  return client.delete(`/api/users/${userId}/role`);
}

export async function deleteUser(userId: string): Promise<void> {
  await client.delete(`/api/users/${userId}`);
}
