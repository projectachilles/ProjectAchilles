import { client } from './client.js';
import type { BuildInfo, EmbedDependency } from './types.js';

export async function getBuild(uuid: string): Promise<BuildInfo> {
  return client.get(`/api/tests/builds/${uuid}`);
}

export async function createBuild(uuid: string): Promise<BuildInfo> {
  return client.post(`/api/tests/builds/${uuid}`);
}

export async function deleteBuild(uuid: string): Promise<void> {
  await client.delete(`/api/tests/builds/${uuid}`);
}

export async function downloadBuild(uuid: string): Promise<Response> {
  return client.get(`/api/tests/builds/${uuid}/download`, { raw: true });
}

export async function getDependencies(uuid: string): Promise<EmbedDependency[]> {
  return client.get(`/api/tests/builds/${uuid}/dependencies`);
}

export async function uploadDependency(uuid: string, file: File | Blob, filename: string): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', filename);
  await client.post(`/api/tests/builds/${uuid}/upload`, { body: formData });
}

export async function uploadBinary(uuid: string, file: File | Blob): Promise<BuildInfo> {
  const formData = new FormData();
  formData.append('file', file);
  return client.post(`/api/tests/builds/${uuid}/upload-binary`, { body: formData });
}
