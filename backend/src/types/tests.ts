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

export interface BuildInfo {
  exists: boolean;
  platform?: { os: string; arch: string };
  signed?: boolean;
  fileSize?: number;
  builtAt?: string;
  filename?: string;
}

export interface BuildMetadata {
  platform: { os: string; arch: string };
  builtAt: string;
  signed: boolean;
  fileSize: number;
  filename: string;
}

export interface EmbedDependency {
  filename: string;
  sourceFile: string;
  exists: boolean;
}
