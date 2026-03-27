// Settings service for tests module (platform + certificate management) — Vercel Blob version
// Uses node-forge for pure-JS certificate generation and PFX parsing.

import * as crypto from 'crypto';
import type { PlatformSettings, CertificateSubject, CertificateInfo, CertificateMetadata, CertificateListResponse } from '../../types/tests.js';
import { blobReadText, blobWrite, blobDelete, blobList, blobUrl } from '../storage.js';
import { validateSubject, generateCertificate as forgeCertGenerate, parsePfxCertificate } from './certificate.js';

const SETTINGS_KEY = 'settings/tests.json';
const CERTS_PREFIX = 'certs/';
const ACTIVE_CERT_KEY = 'certs/active-cert.txt';
const MAX_CERTIFICATES = 5;
const CERT_DIR_REGEX = /^cert-\d+$/;

const defaultPlatform: PlatformSettings = {
  os: 'windows',
  arch: 'amd64',
};

// Invalid combinations
const INVALID_COMBOS: Array<{ os: string; arch: string }> = [
  { os: 'darwin', arch: '386' },
];

export class TestsSettingsService {
  // Derive encryption key from ENCRYPTION_SECRET env var
  private getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      throw new Error('ENCRYPTION_SECRET environment variable is required for serverless deployment');
    }
    if (secret.length < 32) {
      throw new Error('ENCRYPTION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32');
    }
    return Buffer.from(crypto.hkdfSync('sha256', secret, 'projectachilles-settings-v1', 'encryption', 32));
  }

  private encrypt(text: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const key = this.getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private generateCertDirName(): string {
    return `cert-${Date.now()}`;
  }

  private async getCertSubdirs(): Promise<string[]> {
    const blobs = await blobList(CERTS_PREFIX);
    // Extract unique cert-* directory names from blob keys like certs/cert-12345/cert-meta.json
    const dirs = new Set<string>();
    for (const blob of blobs) {
      const match = blob.key.match(/^certs\/(cert-\d+)\//);
      if (match) dirs.add(match[1]);
    }
    return Array.from(dirs).sort();
  }

  private async readMetadata(certDir: string): Promise<CertificateMetadata | null> {
    try {
      const data = await blobReadText(`${CERTS_PREFIX}${certDir}/cert-meta.json`);
      if (!data) return null;
      return JSON.parse(data) as CertificateMetadata;
    } catch {
      return null;
    }
  }

  private metadataToInfo(meta: CertificateMetadata): CertificateInfo {
    return {
      id: meta.id,
      exists: true,
      label: meta.label,
      source: meta.source,
      subject: meta.subject,
      expiry: meta.expiresAt,
      fingerprint: meta.fingerprint,
      createdAt: meta.createdAt,
    };
  }

  // ── Platform Settings ──────────────────────────────────────

  async getPlatformSettings(): Promise<PlatformSettings> {
    try {
      const data = await blobReadText(SETTINGS_KEY);
      if (!data) return { ...defaultPlatform };
      const parsed = JSON.parse(data) as { platform?: PlatformSettings };
      return parsed.platform || { ...defaultPlatform };
    } catch {
      return { ...defaultPlatform };
    }
  }

  async savePlatformSettings(settings: PlatformSettings): Promise<void> {
    // Validate combination
    const invalid = INVALID_COMBOS.find(
      (c) => c.os === settings.os && c.arch === settings.arch
    );
    if (invalid) {
      throw new Error(`Invalid platform combination: ${settings.os}/${settings.arch}`);
    }

    // Read existing to preserve other fields
    let existing: Record<string, unknown> = {};
    try {
      const data = await blobReadText(SETTINGS_KEY);
      if (data) existing = JSON.parse(data);
    } catch {
      // ignore
    }

    existing.platform = settings;
    await blobWrite(SETTINGS_KEY, JSON.stringify(existing, null, 2));
  }

  // ── Active Certificate ──────────────────────────────────────

  async getActiveCertificateId(): Promise<string | null> {
    try {
      const id = await blobReadText(ACTIVE_CERT_KEY);
      if (!id) return null;
      const trimmed = id.trim();
      // Verify the cert still exists
      const meta = await this.readMetadata(trimmed);
      if (!meta) {
        await blobDelete(ACTIVE_CERT_KEY);
        return null;
      }
      return trimmed;
    } catch {
      return null;
    }
  }

  async setActiveCertificateId(id: string): Promise<void> {
    if (!CERT_DIR_REGEX.test(id)) {
      throw new Error('Invalid certificate ID format');
    }
    const meta = await this.readMetadata(id);
    if (!meta) {
      throw new Error('Certificate not found');
    }
    await blobWrite(ACTIVE_CERT_KEY, id);
  }

  // ── Certificate List ────────────────────────────────────────

  async listCertificates(): Promise<CertificateListResponse> {
    const dirs = await this.getCertSubdirs();
    const certificates: CertificateInfo[] = [];

    for (const dir of dirs) {
      const meta = await this.readMetadata(dir);
      if (meta) {
        certificates.push(this.metadataToInfo(meta));
      }
    }

    const activeCertId = await this.getActiveCertificateId();

    return { certificates, activeCertId };
  }

  // ── Certificate Info (single) ───────────────────────────────

  async getCertificateInfo(id?: string): Promise<CertificateInfo> {
    const certId = id || await this.getActiveCertificateId();
    if (!certId) {
      return { id: '', exists: false, source: 'generated' };
    }

    const meta = await this.readMetadata(certId);
    if (!meta) {
      return { id: certId, exists: false, source: 'generated' };
    }

    return this.metadataToInfo(meta);
  }

  // ── Certificate Password ────────────────────────────────────

  async getCertificatePassword(id?: string): Promise<string | null> {
    const certId = id || await this.getActiveCertificateId();
    if (!certId) return null;

    const meta = await this.readMetadata(certId);
    if (!meta) return null;

    try {
      if (meta.password.startsWith('enc:')) {
        return this.decrypt(meta.password.slice(4));
      }
      return meta.password;
    } catch {
      return null;
    }
  }

  // ── Certificate Download URL ────────────────────────────────

  async getCertDownloadUrl(id: string): Promise<{ url: string; filename: string } | null> {
    if (!CERT_DIR_REGEX.test(id)) return null;

    const pfxKey = `${CERTS_PREFIX}${id}/cert.pfx`;
    const url = await blobUrl(pfxKey);
    if (!url) return null;

    const meta = await this.readMetadata(id);
    const baseName = meta?.label || meta?.subject?.commonName || id;
    const safeName = baseName.replace(/[^a-zA-Z0-9 .\-_()]/g, '').trim() || id;
    return { url, filename: `${safeName}.pfx` };
  }

  // ── Generate Certificate (pure-JS via node-forge) ──────────────

  async generateCertificate(subject: CertificateSubject, label?: string, password?: string): Promise<CertificateInfo> {
    // Check max limit
    const existing = await this.getCertSubdirs();
    if (existing.length >= MAX_CERTIFICATES) {
      throw new Error(`Maximum of ${MAX_CERTIFICATES} certificates reached. Delete one before generating a new one.`);
    }

    validateSubject(subject);

    const dirName = this.generateCertDirName();
    const pfxKey = `${CERTS_PREFIX}${dirName}/cert.pfx`;
    const metaKey = `${CERTS_PREFIX}${dirName}/cert-meta.json`;

    const result = await forgeCertGenerate(subject, password);

    try {
      // Store PFX in Blob
      await blobWrite(pfxKey, result.pfxBuffer);

      // Write metadata with encrypted password
      const meta: CertificateMetadata = {
        id: dirName,
        label,
        source: 'generated',
        subject: result.subject,
        password: 'enc:' + this.encrypt(result.password),
        createdAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
        fingerprint: result.fingerprint,
      };
      await blobWrite(metaKey, JSON.stringify(meta, null, 2));

      // Auto-set as active if no active cert
      const activeId = await this.getActiveCertificateId();
      if (!activeId) {
        await blobWrite(ACTIVE_CERT_KEY, dirName);
      }

      return this.metadataToInfo(meta);
    } catch (err) {
      // Clean up partial writes on failure
      try { await blobDelete(pfxKey); } catch { /* ignore */ }
      try { await blobDelete(metaKey); } catch { /* ignore */ }
      throw err;
    }
  }

  // ── Upload Certificate ────────────────────────────────────────

  async uploadCertificate(pfxBuffer: Buffer, password: string, label?: string): Promise<CertificateInfo> {
    // Check max limit
    const existing = await this.getCertSubdirs();
    if (existing.length >= MAX_CERTIFICATES) {
      throw new Error(`Maximum of ${MAX_CERTIFICATES} certificates reached. Delete one before uploading a new one.`);
    }

    const dirName = this.generateCertDirName();
    const pfxKey = `${CERTS_PREFIX}${dirName}/cert.pfx`;
    const metaKey = `${CERTS_PREFIX}${dirName}/cert-meta.json`;

    // Store PFX in Blob
    await blobWrite(pfxKey, pfxBuffer);

    // Try to extract real metadata from the PFX using node-forge
    let subject: CertificateSubject;
    let fingerprint: string;
    let expiresAt: string;

    try {
      const parsed = parsePfxCertificate(pfxBuffer, password);
      subject = parsed.subject;
      fingerprint = parsed.fingerprint;
      expiresAt = parsed.expiresAt;
    } catch {
      // Fallback: PFX uses algorithms node-forge can't parse
      subject = {
        commonName: label || 'Uploaded Certificate',
        organization: 'Unknown',
        country: 'XX',
      };
      fingerprint = crypto.createHash('sha256').update(pfxBuffer).digest('hex')
        .match(/.{2}/g)!.join(':').toUpperCase();
      expiresAt = '';
    }

    const meta: CertificateMetadata = {
      id: dirName,
      label,
      source: 'uploaded',
      subject,
      password: 'enc:' + this.encrypt(password),
      createdAt: new Date().toISOString(),
      expiresAt,
      fingerprint,
    };
    await blobWrite(metaKey, JSON.stringify(meta, null, 2));

    // Auto-set as active if no active cert
    const activeId = await this.getActiveCertificateId();
    if (!activeId) {
      await blobWrite(ACTIVE_CERT_KEY, dirName);
    }

    return this.metadataToInfo(meta);
  }

  // ── Update Certificate Label ────────────────────────────────

  async updateCertificateLabel(id: string, label: string): Promise<CertificateInfo> {
    if (!CERT_DIR_REGEX.test(id)) {
      throw new Error('Invalid certificate ID format');
    }

    const metaKey = `${CERTS_PREFIX}${id}/cert-meta.json`;
    const data = await blobReadText(metaKey);
    if (!data) {
      throw new Error('Certificate not found');
    }

    const meta = JSON.parse(data) as CertificateMetadata;
    meta.label = label;
    await blobWrite(metaKey, JSON.stringify(meta, null, 2));

    return this.metadataToInfo(meta);
  }

  // ── Delete Certificate ──────────────────────────────────────

  async deleteCertificate(id: string): Promise<void> {
    if (!CERT_DIR_REGEX.test(id)) {
      throw new Error('Invalid certificate ID format');
    }

    // Delete all blobs in the cert directory
    const blobs = await blobList(`${CERTS_PREFIX}${id}/`);
    for (const blob of blobs) {
      await blobDelete(blob.key);
    }

    // Clear active if this was the active cert
    const activeId = await this.getActiveCertificateId();
    if (activeId === id) {
      await blobDelete(ACTIVE_CERT_KEY);
    }
  }
}
