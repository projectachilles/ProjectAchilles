// Settings service for external integration credentials (Azure / Entra ID).
// Follows the same AES-256-GCM encryption pattern as analytics/settings.ts.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import type { AzureIntegrationSettings, DefenderIntegrationSettings, IntegrationsSettings } from '../../types/integrations.js';

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'integrations.json');

export class IntegrationsSettingsService {
  // ---------------------------------------------------------------------------
  // Encryption (identical to analytics/settings.ts)
  // ---------------------------------------------------------------------------

  private getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      console.warn('');
      console.warn('WARNING: ENCRYPTION_SECRET not set — using weak machine-derived key.');
      console.warn('  Set ENCRYPTION_SECRET in .env: openssl rand -base64 32');
      console.warn('');
      const machineId = os.hostname() + os.userInfo().username;
      return crypto.createHash('sha256').update(machineId).digest();
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

  private ensureSettingsDir(): void {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Environment variable override
  // ---------------------------------------------------------------------------

  private getEnvAzureSettings(): AzureIntegrationSettings | null {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) return null;

    return {
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
      configured: true,
      label: process.env.AZURE_TENANT_LABEL || undefined,
    };
  }

  /** Check if Azure credentials are provided via environment variables. */
  isEnvConfigured(): boolean {
    return this.getEnvAzureSettings() !== null;
  }

  // ---------------------------------------------------------------------------
  // File-based settings
  // ---------------------------------------------------------------------------

  private getFileSettings(): IntegrationsSettings | null {
    this.ensureSettingsDir();

    if (!fs.existsSync(SETTINGS_FILE)) return null;

    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const settings = JSON.parse(data) as IntegrationsSettings;

      // Decrypt sensitive Azure fields
      if (settings.azure) {
        if (settings.azure.tenant_id?.startsWith('enc:')) {
          settings.azure.tenant_id = this.decrypt(settings.azure.tenant_id.slice(4));
        }
        if (settings.azure.client_id?.startsWith('enc:')) {
          settings.azure.client_id = this.decrypt(settings.azure.client_id.slice(4));
        }
        if (settings.azure.client_secret?.startsWith('enc:')) {
          settings.azure.client_secret = this.decrypt(settings.azure.client_secret.slice(4));
        }
      }

      // Decrypt sensitive Defender fields
      if (settings.defender) {
        if (settings.defender.tenant_id?.startsWith('enc:')) {
          settings.defender.tenant_id = this.decrypt(settings.defender.tenant_id.slice(4));
        }
        if (settings.defender.client_id?.startsWith('enc:')) {
          settings.defender.client_id = this.decrypt(settings.defender.client_id.slice(4));
        }
        if (settings.defender.client_secret?.startsWith('enc:')) {
          settings.defender.client_secret = this.decrypt(settings.defender.client_secret.slice(4));
        }
      }

      return settings;
    } catch (error) {
      console.error('Error loading integrations settings:', error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns decrypted Azure settings. File settings take priority over env vars. */
  getAzureSettings(): AzureIntegrationSettings | null {
    const fileSettings = this.getFileSettings();

    if (fileSettings?.azure?.configured) {
      return fileSettings.azure;
    }

    return this.getEnvAzureSettings();
  }

  /** Save Azure credentials (encrypts sensitive fields). Supports partial update. */
  saveAzureSettings(settings: Partial<AzureIntegrationSettings>): void {
    this.ensureSettingsDir();

    // Load existing to support partial update
    const existing = this.getFileSettings() ?? {};
    const current = existing.azure ?? {
      tenant_id: '',
      client_id: '',
      client_secret: '',
      configured: false,
    };

    // Merge: only overwrite non-empty fields
    const merged: AzureIntegrationSettings = {
      tenant_id: settings.tenant_id || current.tenant_id,
      client_id: settings.client_id || current.client_id,
      client_secret: settings.client_secret || current.client_secret,
      configured: true,
      label: settings.label !== undefined ? settings.label : current.label,
    };

    // Encrypt sensitive fields
    const toSave: IntegrationsSettings = {
      ...existing,
      azure: {
        ...merged,
        tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
        client_id: 'enc:' + this.encrypt(merged.client_id),
        client_secret: 'enc:' + this.encrypt(merged.client_secret),
      },
    };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
  }

  /** Check if Azure integration is configured (file or env). */
  isAzureConfigured(): boolean {
    const settings = this.getAzureSettings();
    if (!settings?.configured) return false;
    return !!(settings.tenant_id && settings.client_id && settings.client_secret);
  }

  /** Returns raw decrypted credentials for injection into task payloads. */
  getAzureCredentials(): { tenant_id: string; client_id: string; client_secret: string } | null {
    const settings = this.getAzureSettings();
    if (!settings?.configured) return null;
    if (!settings.tenant_id || !settings.client_id || !settings.client_secret) return null;
    return {
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }

  // ---------------------------------------------------------------------------
  // Microsoft Defender (Graph Security API)
  // ---------------------------------------------------------------------------

  private getEnvDefenderSettings(): DefenderIntegrationSettings | null {
    const tenantId = process.env.DEFENDER_TENANT_ID;
    const clientId = process.env.DEFENDER_CLIENT_ID;
    const clientSecret = process.env.DEFENDER_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) return null;

    return {
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
      configured: true,
      label: process.env.DEFENDER_TENANT_LABEL || undefined,
    };
  }

  /** Check if Defender credentials are provided via environment variables. */
  isEnvDefenderConfigured(): boolean {
    return this.getEnvDefenderSettings() !== null;
  }

  /** Returns decrypted Defender settings. File settings take priority over env vars. */
  getDefenderSettings(): DefenderIntegrationSettings | null {
    const fileSettings = this.getFileSettings();

    if (fileSettings?.defender?.configured) {
      return fileSettings.defender;
    }

    return this.getEnvDefenderSettings();
  }

  /** Save Defender credentials (encrypts sensitive fields). Supports partial update. */
  saveDefenderSettings(settings: Partial<DefenderIntegrationSettings>): void {
    this.ensureSettingsDir();

    // Load existing to support partial update
    const existing = this.getFileSettings() ?? {};
    const current = existing.defender ?? {
      tenant_id: '',
      client_id: '',
      client_secret: '',
      configured: false,
    };

    // Merge: only overwrite non-empty fields
    const merged: DefenderIntegrationSettings = {
      tenant_id: settings.tenant_id || current.tenant_id,
      client_id: settings.client_id || current.client_id,
      client_secret: settings.client_secret || current.client_secret,
      configured: true,
      label: settings.label !== undefined ? settings.label : current.label,
    };

    // Encrypt sensitive fields
    const toSave: IntegrationsSettings = {
      ...existing,
      defender: {
        ...merged,
        tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
        client_id: 'enc:' + this.encrypt(merged.client_id),
        client_secret: 'enc:' + this.encrypt(merged.client_secret),
      },
    };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
  }

  /** Check if Defender integration is configured (file or env). */
  isDefenderConfigured(): boolean {
    const settings = this.getDefenderSettings();
    if (!settings?.configured) return false;
    return !!(settings.tenant_id && settings.client_id && settings.client_secret);
  }

  /** Returns raw decrypted Defender credentials. */
  getDefenderCredentials(): { tenant_id: string; client_id: string; client_secret: string } | null {
    const settings = this.getDefenderSettings();
    if (!settings?.configured) return null;
    if (!settings.tenant_id || !settings.client_id || !settings.client_secret) return null;
    return {
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }
}
