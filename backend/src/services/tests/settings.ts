// Settings service for tests module (platform + certificate management)

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PlatformSettings, CertificateSubject, CertificateInfo, CertificateMetadata, CertificateListResponse } from '../../types/tests.js';

const execFileAsync = promisify(execFile);

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'tests.json');
const CERTS_DIR = path.join(SETTINGS_DIR, 'certs');
const ACTIVE_CERT_FILE = path.join(CERTS_DIR, 'active-cert.txt');
const MAX_CERTIFICATES = 5;
const CERT_DIR_REGEX = /^cert-\d+$/;

// Legacy flat file path (pre-migration)
const LEGACY_META_FILE = path.join(CERTS_DIR, 'cert-meta.json');

const defaultPlatform: PlatformSettings = {
  os: 'windows',
  arch: 'amd64',
};

// Invalid combinations
const INVALID_COMBOS: Array<{ os: string; arch: string }> = [
  { os: 'darwin', arch: '386' },
];

export class TestsSettingsService {
  // Derive encryption key from ENCRYPTION_SECRET env var (mandatory)
  private getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      throw new Error('ENCRYPTION_SECRET environment variable is required. Generate one with: openssl rand -base64 32');
    }
    if (secret.length < 16) {
      throw new Error('ENCRYPTION_SECRET must be at least 16 characters');
    }
    return crypto.createHash('sha256').update(secret).digest();
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

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private generateCertDirName(): string {
    return `cert-${Date.now()}`;
  }

  private getCertSubdirs(): string[] {
    this.ensureDir(CERTS_DIR);
    return fs.readdirSync(CERTS_DIR)
      .filter(name => CERT_DIR_REGEX.test(name))
      .filter(name => {
        const metaPath = path.join(CERTS_DIR, name, 'cert-meta.json');
        return fs.existsSync(metaPath);
      })
      .sort();
  }

  private readMetadata(certDir: string): CertificateMetadata | null {
    const metaPath = path.join(CERTS_DIR, certDir, 'cert-meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CertificateMetadata;
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

  getPlatformSettings(): PlatformSettings {
    this.ensureDir(SETTINGS_DIR);

    if (!fs.existsSync(SETTINGS_FILE)) {
      return { ...defaultPlatform };
    }

    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(data) as { platform?: PlatformSettings };
      return parsed.platform || { ...defaultPlatform };
    } catch {
      return { ...defaultPlatform };
    }
  }

  savePlatformSettings(settings: PlatformSettings): void {
    // Validate combination
    const invalid = INVALID_COMBOS.find(
      (c) => c.os === settings.os && c.arch === settings.arch
    );
    if (invalid) {
      throw new Error(`Invalid platform combination: ${settings.os}/${settings.arch}`);
    }

    this.ensureDir(SETTINGS_DIR);

    // Read existing file to preserve other fields
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      } catch {
        // ignore
      }
    }

    existing.platform = settings;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2));
  }

  // ── Legacy Migration ────────────────────────────────────────

  private migrateLegacyCerts(): void {
    // Check for legacy flat cert-meta.json at CERTS_DIR root (not inside a cert-* subdir)
    if (!fs.existsSync(LEGACY_META_FILE)) return;

    // Don't migrate if there are already cert subdirectories
    const existing = this.getCertSubdirs();
    if (existing.length > 0) {
      // Legacy file exists alongside new dirs — remove it to avoid re-migration
      fs.unlinkSync(LEGACY_META_FILE);
      return;
    }

    const dirName = this.generateCertDirName();
    const targetDir = path.join(CERTS_DIR, dirName);
    this.ensureDir(targetDir);

    const legacyFiles = ['key.pem', 'cert.crt', 'cert.pfx', 'cert.cer', 'cert.cer.b64', 'cert-meta.json'];
    for (const file of legacyFiles) {
      const src = path.join(CERTS_DIR, file);
      if (fs.existsSync(src)) {
        fs.renameSync(src, path.join(targetDir, file));
      }
    }

    // Patch metadata with new fields
    const metaPath = path.join(targetDir, 'cert-meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        meta.id = dirName;
        meta.source = 'generated';
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      } catch {
        // Best-effort migration
      }
    }

    // Set as active
    fs.writeFileSync(ACTIVE_CERT_FILE, dirName);
  }

  // ── Active Certificate ──────────────────────────────────────

  getActiveCertificateId(): string | null {
    if (!fs.existsSync(ACTIVE_CERT_FILE)) return null;
    try {
      const id = fs.readFileSync(ACTIVE_CERT_FILE, 'utf8').trim();
      // Verify the cert directory still exists
      const metaPath = path.join(CERTS_DIR, id, 'cert-meta.json');
      if (!fs.existsSync(metaPath)) {
        fs.unlinkSync(ACTIVE_CERT_FILE);
        return null;
      }
      return id;
    } catch {
      return null;
    }
  }

  setActiveCertificateId(id: string): void {
    if (!CERT_DIR_REGEX.test(id)) {
      throw new Error('Invalid certificate ID format');
    }
    const metaPath = path.join(CERTS_DIR, id, 'cert-meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error('Certificate not found');
    }
    fs.writeFileSync(ACTIVE_CERT_FILE, id);
  }

  // ── Certificate List ────────────────────────────────────────

  listCertificates(): CertificateListResponse {
    this.ensureDir(CERTS_DIR);
    this.migrateLegacyCerts();

    const dirs = this.getCertSubdirs();
    const certificates: CertificateInfo[] = [];

    for (const dir of dirs) {
      const meta = this.readMetadata(dir);
      if (meta) {
        certificates.push(this.metadataToInfo(meta));
      }
    }

    const activeCertId = this.getActiveCertificateId();

    return { certificates, activeCertId };
  }

  // ── Certificate Info (single) ───────────────────────────────

  getCertificateInfo(id?: string): CertificateInfo {
    this.ensureDir(CERTS_DIR);

    const certId = id || this.getActiveCertificateId();
    if (!certId) {
      return { id: '', exists: false, source: 'generated' };
    }

    const meta = this.readMetadata(certId);
    if (!meta) {
      return { id: certId, exists: false, source: 'generated' };
    }

    return this.metadataToInfo(meta);
  }

  // ── Certificate Password ────────────────────────────────────

  getCertificatePassword(id?: string): string | null {
    const certId = id || this.getActiveCertificateId();
    if (!certId) return null;

    const meta = this.readMetadata(certId);
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

  // ── Certificate Download Path ────────────────────────────────

  getCertDownloadPath(id: string): { pfxPath: string; filename: string } | null {
    if (!CERT_DIR_REGEX.test(id)) return null;

    const pfxPath = path.join(CERTS_DIR, id, 'cert.pfx');
    if (!fs.existsSync(pfxPath)) return null;

    const meta = this.readMetadata(id);
    const baseName = meta?.label || meta?.subject?.commonName || id;
    // Sanitize for use as a filename
    const safeName = baseName.replace(/[^a-zA-Z0-9 .\-_()]/g, '').trim() || id;
    return { pfxPath, filename: `${safeName}.pfx` };
  }

  // ── Active Cert PFX Path (for build service) ───────────────

  getActiveCertPfxPath(): { pfxPath: string; password: string } | null {
    const activeId = this.getActiveCertificateId();
    if (!activeId) return null;

    const pfxPath = path.join(CERTS_DIR, activeId, 'cert.pfx');
    if (!fs.existsSync(pfxPath)) return null;

    const password = this.getCertificatePassword(activeId);
    if (!password) return null;

    return { pfxPath, password };
  }

  // ── Generate Certificate ────────────────────────────────────

  async generateCertificate(subject: CertificateSubject, label?: string, password?: string): Promise<CertificateInfo> {
    this.ensureDir(CERTS_DIR);

    // Check max limit
    const existing = this.getCertSubdirs();
    if (existing.length >= MAX_CERTIFICATES) {
      throw new Error(`Maximum of ${MAX_CERTIFICATES} certificates reached. Delete one before generating a new one.`);
    }

    const dirName = this.generateCertDirName();
    const certDir = path.join(CERTS_DIR, dirName);
    this.ensureDir(certDir);

    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.crt');
    const pfxPath = path.join(certDir, 'cert.pfx');
    const cerPath = path.join(certDir, 'cert.cer');

    // M1: Validate subject fields to prevent injection into the openssl -subj string
    const SAFE_SUBJECT = /^[a-zA-Z0-9 .\-,&'()]+$/;
    if (!SAFE_SUBJECT.test(subject.commonName)) {
      throw new Error('commonName contains invalid characters');
    }
    if (!SAFE_SUBJECT.test(subject.organization)) {
      throw new Error('organization contains invalid characters');
    }
    if (!SAFE_SUBJECT.test(subject.country)) {
      throw new Error('country contains invalid characters');
    }

    const subjectStr = `/CN=${subject.commonName}/O=${subject.organization}/C=${subject.country}`;

    try {
      // 1. Generate self-signed code-signing certificate + key
      await execFileAsync('openssl', [
        'req', '-x509', '-newkey', 'rsa:4096',
        '-keyout', keyPath,
        '-out', certPath,
        '-days', '1825',
        '-nodes',
        '-subj', subjectStr,
        '-addext', 'extendedKeyUsage=codeSigning',
        '-addext', 'keyUsage=digitalSignature',
      ]);

      // 2. Use provided password or generate a random one
      let certPassword: string;
      if (password) {
        certPassword = password;
      } else {
        const { stdout: passwordRaw } = await execFileAsync('openssl', [
          'rand', '-base64', '32',
        ]);
        certPassword = passwordRaw.trim();
      }

      // 3. Create PFX (PKCS#12) with -legacy for OpenSSL 3.x compat
      // L1: Pass password via temp file to avoid /proc/PID/cmdline exposure
      const passFile = path.join(certDir, '.tmp-pass');
      fs.writeFileSync(passFile, certPassword, { mode: 0o600 });
      try {
        await execFileAsync('openssl', [
          'pkcs12', '-export',
          '-out', pfxPath,
          '-inkey', keyPath,
          '-in', certPath,
          '-passout', `file:${passFile}`,
          '-legacy',
        ]);
      } finally {
        if (fs.existsSync(passFile)) fs.unlinkSync(passFile);
      }

      // 4. Create DER-encoded .cer
      await execFileAsync('openssl', [
        'x509', '-outform', 'der',
        '-in', certPath,
        '-out', cerPath,
      ]);

      // 5. Extract fingerprint (SHA-256)
      const { stdout: fpRaw } = await execFileAsync('openssl', [
        'x509', '-in', certPath, '-noout', '-fingerprint', '-sha256',
      ]);
      const fingerprint = fpRaw.trim().split('=')[1] || fpRaw.trim();

      // 6. Extract expiry date
      const { stdout: expiryRaw } = await execFileAsync('openssl', [
        'x509', '-in', certPath, '-noout', '-enddate',
      ]);
      const expiryStr = expiryRaw.trim().split('=')[1] || expiryRaw.trim();
      const expiresAt = new Date(expiryStr).toISOString();

      // 7. Create base64-encoded DER certificate
      const cerB64Path = path.join(certDir, 'cert.cer.b64');
      const cerDer = fs.readFileSync(cerPath);
      fs.writeFileSync(cerB64Path, cerDer.toString('base64'));

      // 8. Clean up intermediate files (key + PEM cert) — only PFX, DER, and b64 are kept
      fs.unlinkSync(keyPath);
      fs.unlinkSync(certPath);

      // 9. Write metadata with encrypted password
      const meta: CertificateMetadata = {
        id: dirName,
        label,
        source: 'generated',
        subject,
        password: 'enc:' + this.encrypt(certPassword),
        createdAt: new Date().toISOString(),
        expiresAt,
        fingerprint,
      };
      fs.writeFileSync(path.join(certDir, 'cert-meta.json'), JSON.stringify(meta, null, 2));

      // 10. Auto-set as active if no active cert
      if (!this.getActiveCertificateId()) {
        fs.writeFileSync(ACTIVE_CERT_FILE, dirName);
      }

      return this.metadataToInfo(meta);
    } catch (err) {
      // Clean up on failure
      fs.rmSync(certDir, { recursive: true, force: true });
      throw err;
    }
  }

  // ── Upload Certificate ──────────────────────────────────────

  async uploadCertificate(pfxBuffer: Buffer, password: string, label?: string): Promise<CertificateInfo> {
    this.ensureDir(CERTS_DIR);

    // Check max limit
    const existing = this.getCertSubdirs();
    if (existing.length >= MAX_CERTIFICATES) {
      throw new Error(`Maximum of ${MAX_CERTIFICATES} certificates reached. Delete one before uploading a new one.`);
    }

    const dirName = this.generateCertDirName();
    const certDir = path.join(CERTS_DIR, dirName);
    this.ensureDir(certDir);

    const pfxPath = path.join(certDir, 'cert.pfx');
    const cerPath = path.join(certDir, 'cert.cer');

    try {
      // Write PFX to disk
      fs.writeFileSync(pfxPath, pfxBuffer);

      // L1: Pass password via temp file to avoid /proc/PID/cmdline exposure
      const passFile = path.join(certDir, '.tmp-pass');
      fs.writeFileSync(passFile, password, { mode: 0o600 });
      let pkcs12Info: string;
      const tempCertPem = path.join(certDir, '_temp_cert.pem');
      try {
        // Validate PFX by extracting info
        const { stdout } = await execFileAsync('openssl', [
          'pkcs12', '-info', '-in', pfxPath,
          '-passin', `file:${passFile}`,
          '-nokeys', '-legacy',
        ]);
        pkcs12Info = stdout;

        // Extract the certificate from PFX to a temp PEM for parsing
        await execFileAsync('openssl', [
          'pkcs12', '-in', pfxPath,
          '-passin', `file:${passFile}`,
          '-nokeys', '-clcerts',
          '-out', tempCertPem,
          '-legacy',
        ]);
      } finally {
        if (fs.existsSync(passFile)) fs.unlinkSync(passFile);
      }

      // Extract subject
      const { stdout: subjectRaw } = await execFileAsync('openssl', [
        'x509', '-in', tempCertPem, '-noout', '-subject',
      ]);
      const subjectLine = subjectRaw.trim();
      const cnMatch = subjectLine.match(/CN\s*=\s*([^,/\n]+)/);
      const oMatch = subjectLine.match(/O\s*=\s*([^,/\n]+)/);
      const cMatch = subjectLine.match(/C\s*=\s*([^,/\n]+)/);

      const subject: CertificateSubject = {
        commonName: cnMatch?.[1]?.trim() || 'Unknown',
        organization: oMatch?.[1]?.trim() || 'Unknown',
        country: cMatch?.[1]?.trim() || 'XX',
      };

      // Extract fingerprint
      const { stdout: fpRaw } = await execFileAsync('openssl', [
        'x509', '-in', tempCertPem, '-noout', '-fingerprint', '-sha256',
      ]);
      const fingerprint = fpRaw.trim().split('=')[1] || fpRaw.trim();

      // Extract expiry
      const { stdout: expiryRaw } = await execFileAsync('openssl', [
        'x509', '-in', tempCertPem, '-noout', '-enddate',
      ]);
      const expiryStr = expiryRaw.trim().split('=')[1] || expiryRaw.trim();
      const expiresAt = new Date(expiryStr).toISOString();

      // Create DER-encoded .cer
      await execFileAsync('openssl', [
        'x509', '-outform', 'der',
        '-in', tempCertPem,
        '-out', cerPath,
      ]);

      // Clean up temp file
      fs.unlinkSync(tempCertPem);

      // Suppress unused variable warning — pkcs12Info validated the PFX
      void pkcs12Info;

      // Write metadata
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
      fs.writeFileSync(path.join(certDir, 'cert-meta.json'), JSON.stringify(meta, null, 2));

      // Auto-set as active if no active cert
      if (!this.getActiveCertificateId()) {
        fs.writeFileSync(ACTIVE_CERT_FILE, dirName);
      }

      return this.metadataToInfo(meta);
    } catch (err) {
      // Clean up on failure
      fs.rmSync(certDir, { recursive: true, force: true });
      throw err;
    }
  }

  // ── Update Certificate Label ────────────────────────────────

  updateCertificateLabel(id: string, label: string): CertificateInfo {
    if (!CERT_DIR_REGEX.test(id)) {
      throw new Error('Invalid certificate ID format');
    }

    const metaPath = path.join(CERTS_DIR, id, 'cert-meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error('Certificate not found');
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CertificateMetadata;
    meta.label = label;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    return this.metadataToInfo(meta);
  }

  // ── Delete Certificate ──────────────────────────────────────

  deleteCertificate(id?: string): void {
    if (id) {
      if (!CERT_DIR_REGEX.test(id)) {
        throw new Error('Invalid certificate ID format');
      }
      const certDir = path.join(CERTS_DIR, id);
      if (fs.existsSync(certDir)) {
        fs.rmSync(certDir, { recursive: true, force: true });
      }
      // Clear active if this was the active cert
      const activeId = this.getActiveCertificateId();
      if (activeId === id && fs.existsSync(ACTIVE_CERT_FILE)) {
        fs.unlinkSync(ACTIVE_CERT_FILE);
      }
    } else {
      // Legacy: delete all cert files at root (backward compat)
      const files = ['key.pem', 'cert.crt', 'cert.pfx', 'cert.cer', 'cert.cer.b64', 'cert-meta.json'];
      for (const file of files) {
        const filePath = path.join(CERTS_DIR, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }
}
