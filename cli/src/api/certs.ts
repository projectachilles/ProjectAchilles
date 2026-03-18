import { client } from './client.js';
import type { CertInfo } from './types.js';

export async function listCertificates(): Promise<{ certificates: CertInfo[]; activeCertId: string | null }> {
  return client.get('/api/tests/certificates');
}

export async function uploadCertificate(file: File | Blob, password: string, label?: string): Promise<CertInfo> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('password', password);
  if (label) formData.append('label', label);
  return client.post('/api/tests/certificates/upload', { body: formData });
}

export async function generateCertificate(params: {
  commonName: string;
  organization: string;
  country: string;
  label?: string;
  password?: string;
}): Promise<CertInfo> {
  return client.post('/api/tests/certificates/generate', { body: params });
}

export async function activateCertificate(id: string): Promise<void> {
  await client.put(`/api/tests/certificates/${id}/active`);
}

export async function renameCertificate(id: string, label: string): Promise<CertInfo> {
  return client.patch(`/api/tests/certificates/${id}`, { body: { label } });
}

export async function deleteCertificate(id: string): Promise<void> {
  await client.delete(`/api/tests/certificates/${id}`);
}

export async function downloadCertificate(id: string): Promise<Response> {
  return client.get(`/api/tests/certificates/${id}/download`, { raw: true });
}
