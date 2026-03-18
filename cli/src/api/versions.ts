import { client } from './client.js';
import type { AgentVersion, AgentOS, AgentArch } from './types.js';

export async function listVersions(): Promise<AgentVersion[]> {
  return client.get('/api/agent/admin/versions');
}

export async function uploadVersion(params: {
  version: string;
  os: AgentOS;
  arch: AgentArch;
  file: File | Blob;
  release_notes?: string;
  mandatory?: boolean;
}): Promise<AgentVersion> {
  const formData = new FormData();
  formData.append('version', params.version);
  formData.append('os', params.os);
  formData.append('arch', params.arch);
  formData.append('binary', params.file);
  if (params.release_notes) formData.append('release_notes', params.release_notes);
  if (params.mandatory !== undefined) formData.append('mandatory', String(params.mandatory));
  return client.post('/api/agent/admin/versions/upload', { body: formData });
}

export async function buildVersion(params: {
  version: string;
  os: AgentOS;
  arch: AgentArch;
}): Promise<AgentVersion> {
  return client.post('/api/agent/admin/versions/build', { body: params });
}

export async function deleteVersion(version: string, os: AgentOS, arch: AgentArch): Promise<void> {
  await client.delete(`/api/agent/admin/versions/${encodeURIComponent(version)}/${os}/${arch}`);
}
