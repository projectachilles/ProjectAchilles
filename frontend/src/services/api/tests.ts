import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { BuildInfo, EmbedDependency } from '@/types/test';

export interface PlatformSettings {
  os: 'windows' | 'linux' | 'darwin';
  arch: 'amd64' | '386' | 'arm64';
}

export interface CertificateSubject {
  commonName: string;
  organization: string;
  country: string;
}

export interface CertificateInfo {
  id: string;
  exists: boolean;
  label?: string;
  source: 'generated' | 'uploaded';
  subject?: CertificateSubject;
  expiry?: string;
  fingerprint?: string;
  createdAt?: string;
}

export interface CertificateListResponse {
  certificates: CertificateInfo[];
  activeCertId: string | null;
}

export const testsApi = {
  async getPlatform(): Promise<PlatformSettings> {
    const response = await apiClient.get('/tests/platform');
    return response.data.data;
  },

  async savePlatform(settings: PlatformSettings): Promise<{ success: boolean }> {
    const response = await apiClient.post('/tests/platform', settings);
    return response.data;
  },

  async getCertificate(): Promise<CertificateInfo> {
    const response = await apiClient.get('/tests/certificate');
    return response.data.data;
  },

  async generateCertificate(subject: CertificateSubject): Promise<CertificateInfo> {
    const response = await apiClient.post('/tests/certificate', subject);
    return response.data.data;
  },

  async deleteCertificate(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/tests/certificate');
    return response.data;
  },

  // ── Multi-Certificate API ──────────────────────────────────

  async listCertificates(): Promise<CertificateListResponse> {
    const response = await apiClient.get('/tests/certificates');
    return response.data.data;
  },

  async uploadCertificate(file: File, password: string, label?: string): Promise<CertificateInfo> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);
    if (label) formData.append('label', label);
    const response = await apiClient.post('/tests/certificates/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  },

  async generateCertificateWithLabel(
    subject: CertificateSubject,
    label?: string,
    password?: string,
  ): Promise<CertificateInfo> {
    const response = await apiClient.post('/tests/certificates/generate', {
      ...subject,
      label,
      password,
    });
    return response.data.data;
  },

  async setActiveCertificate(id: string): Promise<{ success: boolean }> {
    const response = await apiClient.put(`/tests/certificates/${id}/active`);
    return response.data;
  },

  async updateCertificateLabel(id: string, label: string): Promise<CertificateInfo> {
    const response = await apiClient.patch(`/tests/certificates/${id}`, { label });
    return response.data.data;
  },

  async deleteCertificateById(id: string): Promise<{ success: boolean }> {
    const response = await apiClient.delete(`/tests/certificates/${id}`);
    return response.data;
  },

  async downloadCertificate(id: string): Promise<void> {
    const response = await apiClient.get(`/tests/certificates/${id}/download`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data]);
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `${id}.pfx`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\s]+)"?/);
      if (match) filename = match[1];
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  // ── Build API ────────────────────────────────────────────

  async getBuildInfo(uuid: string): Promise<BuildInfo> {
    const response = await apiClient.get(`/tests/builds/${uuid}`);
    return response.data.data;
  },

  async buildTest(uuid: string): Promise<BuildInfo> {
    const response = await apiClient.post(`/tests/builds/${uuid}`);
    return response.data.data;
  },

  async deleteBuild(uuid: string): Promise<{ success: boolean }> {
    const response = await apiClient.delete(`/tests/builds/${uuid}`);
    return response.data;
  },

  async downloadBuild(uuid: string): Promise<void> {
    const response = await apiClient.get(`/tests/builds/${uuid}/download`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data]);
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = uuid;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\s]+)"?/);
      if (match) filename = match[1];
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  async getEmbedDependencies(uuid: string): Promise<EmbedDependency[]> {
    const response = await apiClient.get(`/tests/builds/${uuid}/dependencies`);
    return response.data.data;
  },

  async uploadEmbedFile(uuid: string, filename: string, file: File): Promise<{ success: boolean }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', filename);
    const response = await apiClient.post(`/tests/builds/${uuid}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async uploadBinary(uuid: string, file: File): Promise<BuildInfo> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/tests/builds/${uuid}/upload-binary`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  },

  // ── Client-side Blob Upload (Vercel) ────────────────────

  async getUploadToken(uuid: string, filename: string): Promise<{ token: string; pathname: string }> {
    const response = await apiClient.post(`/tests/builds/${uuid}/upload-token`, { filename });
    return response.data.data;
  },

  async completeUpload(uuid: string, filename: string): Promise<BuildInfo> {
    const response = await apiClient.post(`/tests/builds/${uuid}/upload-complete`, { filename });
    return response.data.data;
  },
};
