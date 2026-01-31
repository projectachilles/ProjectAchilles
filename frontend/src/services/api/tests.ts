import { apiClient } from '@/hooks/useAuthenticatedApi';

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
  exists: boolean;
  subject?: CertificateSubject;
  expiry?: string;
  fingerprint?: string;
  createdAt?: string;
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
};
