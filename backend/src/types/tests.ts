import type { BuildVersionStamp } from './testVersion.js';

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
  id: string;
  exists: boolean;
  label?: string;
  source: 'generated' | 'uploaded';
  subject?: CertificateSubject;
  expiry?: string;
  fingerprint?: string;
  createdAt?: string;
}

export interface CertificateMetadata {
  id: string;
  label?: string;
  source: 'generated' | 'uploaded';
  subject: CertificateSubject;
  password: string;
  createdAt: string;
  expiresAt: string;
  fingerprint: string;
}

export interface CertificateListResponse {
  certificates: CertificateInfo[];
  activeCertId: string | null;
}

export type BuildJobStatus = 'running' | 'succeeded' | 'failed';

/** Latest build attempt for a test, tracked in memory by BuildService. */
export interface BuildJob {
  status: BuildJobStatus;
  startedAt: string;
  finishedAt?: string;
  /** The thrown error's message, when status is 'failed'. */
  error?: string;
}

export interface BuildInfo {
  exists: boolean;
  platform?: { os: string; arch: string };
  detectedPlatform?: { os: string; arch: string };
  signed?: boolean;
  fileSize?: number;
  builtAt?: string;
  filename?: string;
  source?: 'built' | 'uploaded';
  job?: BuildJob;
  /** Source version this binary was built from; absent on uploads and older builds. */
  version?: BuildVersionStamp;
}

/** One built artifact for a single OS, within a BuildMetadata.binaries map. */
export interface BuildArtifact {
  filename: string;
  fileSize: number;
  signed: boolean;
}

export interface BuildMetadata {
  platform: { os: string; arch: string };
  builtAt: string;
  signed: boolean;
  fileSize: number;
  filename: string;
  /**
   * Per-OS artifacts for cross-platform tests. Task dispatch selects the entry
   * matching each agent's OS. Absent on older single-binary builds, in which
   * case dispatch falls back to `filename`/`binary_name`. `platform`/`filename`
   * continue to describe the primary artifact for backward compatibility.
   */
  binaries?: Partial<Record<'windows' | 'linux' | 'darwin', BuildArtifact>>;
  source?: 'built' | 'uploaded';
  version?: BuildVersionStamp;
}

export interface EmbedDependency {
  filename: string;
  sourceFile: string;
  exists: boolean;
  sourceBuilt: boolean;
}
