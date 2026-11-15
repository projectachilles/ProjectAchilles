import { client } from './client.js';
import type { User, Invitation } from './types.js';

// Reads only. Inviting, role changes and deletion need a signed-in browser
// session; the server answers 403 to a CLI token on every /api/users write.

export async function listUsers(): Promise<User[]> {
  return client.get('/api/users');
}

export async function listInvitations(): Promise<Invitation[]> {
  return client.get('/api/users/invitations');
}
