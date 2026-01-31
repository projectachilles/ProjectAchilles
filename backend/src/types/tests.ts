// Tests module types

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

export interface CertificateMetadata {
  subject: CertificateSubject;
  password: string;
  createdAt: string;
  expiresAt: string;
  fingerprint: string;
}
