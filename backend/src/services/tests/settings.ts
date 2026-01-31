// Settings service for tests module (platform + certificate management)

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PlatformSettings, CertificateSubject, CertificateInfo, CertificateMetadata } from '../../types/tests.js';

const execFileAsync = promisify(execFile);

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'tests.json');
const CERTS_DIR = path.join(SETTINGS_DIR, 'certs');
const CERT_META_FILE = path.join(CERTS_DIR, 'cert-meta.json');

const defaultPlatform: PlatformSettings = {
  os: 'windows',
  arch: 'amd64',
};

// Invalid combinations
const INVALID_COMBOS: Array<{ os: string; arch: string }> = [
  { os: 'darwin', arch: '386' },
];

export class TestsSettingsService {
  // Derive encryption key from machine ID (same as analytics)
  private getEncryptionKey(): Buffer {
    const machineId = os.hostname() + os.userInfo().username;
    return crypto.createHash('sha256').update(machineId).digest();
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

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
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

  // ── Certificate Management ─────────────────────────────────

  getCertificatePassword(): string | null {
    if (!fs.existsSync(CERT_META_FILE)) return null;
    try {
      const data = fs.readFileSync(CERT_META_FILE, 'utf8');
      const meta = JSON.parse(data) as CertificateMetadata;
      if (meta.password.startsWith('enc:')) {
        return this.decrypt(meta.password.slice(4));
      }
      return meta.password;
    } catch {
      return null;
    }
  }

  getCertificateInfo(): CertificateInfo {
    this.ensureDir(CERTS_DIR);

    if (!fs.existsSync(CERT_META_FILE)) {
      return { exists: false };
    }

    try {
      const data = fs.readFileSync(CERT_META_FILE, 'utf8');
      const meta = JSON.parse(data) as CertificateMetadata;

      return {
        exists: true,
        subject: meta.subject,
        expiry: meta.expiresAt,
        fingerprint: meta.fingerprint,
        createdAt: meta.createdAt,
      };
    } catch {
      return { exists: false };
    }
  }

  async generateCertificate(subject: CertificateSubject): Promise<CertificateInfo> {
    this.ensureDir(CERTS_DIR);

    const keyPath = path.join(CERTS_DIR, 'key.pem');
    const certPath = path.join(CERTS_DIR, 'cert.crt');
    const pfxPath = path.join(CERTS_DIR, 'cert.pfx');
    const cerPath = path.join(CERTS_DIR, 'cert.cer');

    const subjectStr = `/CN=${subject.commonName}/O=${subject.organization}/C=${subject.country}`;

    // 1. Generate self-signed certificate + key
    await execFileAsync('openssl', [
      'req', '-x509', '-newkey', 'rsa:4096',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '1825',
      '-nodes',
      '-subj', subjectStr,
    ]);

    // 2. Generate random password
    const { stdout: passwordRaw } = await execFileAsync('openssl', [
      'rand', '-base64', '32',
    ]);
    const password = passwordRaw.trim();

    // 3. Create PFX (PKCS#12) with -legacy for OpenSSL 3.x compat
    await execFileAsync('openssl', [
      'pkcs12', '-export',
      '-out', pfxPath,
      '-inkey', keyPath,
      '-in', certPath,
      '-passout', `pass:${password}`,
      '-legacy',
    ]);

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

    // 7. Set key.pem to mode 0600
    fs.chmodSync(keyPath, 0o600);

    // 8. Write metadata with encrypted password
    const meta: CertificateMetadata = {
      subject,
      password: 'enc:' + this.encrypt(password),
      createdAt: new Date().toISOString(),
      expiresAt,
      fingerprint,
    };
    fs.writeFileSync(CERT_META_FILE, JSON.stringify(meta, null, 2));

    return {
      exists: true,
      subject: meta.subject,
      expiry: meta.expiresAt,
      fingerprint: meta.fingerprint,
      createdAt: meta.createdAt,
    };
  }

  deleteCertificate(): void {
    const files = ['key.pem', 'cert.crt', 'cert.pfx', 'cert.cer', 'cert-meta.json'];
    for (const file of files) {
      const filePath = path.join(CERTS_DIR, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
