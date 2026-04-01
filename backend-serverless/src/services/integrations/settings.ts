// Settings service for external integration credentials — Vercel Blob storage version

import * as crypto from 'crypto';
import type { AzureIntegrationSettings, DefenderIntegrationSettings, IntegrationsSettings } from '../../types/integrations.js';
import { blobReadText, blobWrite } from '../storage.js';

const SETTINGS_KEY = 'settings/integrations.json';

export class IntegrationsSettingsService {
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

  isEnvConfigured(): boolean {
    return this.getEnvAzureSettings() !== null;
  }

  private async getFileSettings(): Promise<IntegrationsSettings | null> {
    try {
      const data = await blobReadText(SETTINGS_KEY);
      if (!data) return null;
      const settings = JSON.parse(data) as IntegrationsSettings;
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

  async getAzureSettings(): Promise<AzureIntegrationSettings | null> {
    const fileSettings = await this.getFileSettings();
    if (fileSettings?.azure?.configured) {
      return fileSettings.azure;
    }
    return this.getEnvAzureSettings();
  }

  async saveAzureSettings(settings: Partial<AzureIntegrationSettings>): Promise<void> {
    const existing = await this.getFileSettings() ?? {};
    const current = existing.azure ?? {
      tenant_id: '',
      client_id: '',
      client_secret: '',
      configured: false,
    };
    const merged: AzureIntegrationSettings = {
      tenant_id: settings.tenant_id || current.tenant_id,
      client_id: settings.client_id || current.client_id,
      client_secret: settings.client_secret || current.client_secret,
      configured: true,
      label: settings.label !== undefined ? settings.label : current.label,
    };
    const toSave: IntegrationsSettings = {
      ...existing,
      azure: {
        ...merged,
        tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
        client_id: 'enc:' + this.encrypt(merged.client_id),
        client_secret: 'enc:' + this.encrypt(merged.client_secret),
      },
    };
    await blobWrite(SETTINGS_KEY, JSON.stringify(toSave, null, 2));
  }

  async isAzureConfigured(): Promise<boolean> {
    const settings = await this.getAzureSettings();
    if (!settings?.configured) return false;
    return !!(settings.tenant_id && settings.client_id && settings.client_secret);
  }

  async getAzureCredentials(): Promise<{ tenant_id: string; client_id: string; client_secret: string } | null> {
    const settings = await this.getAzureSettings();
    if (!settings?.configured) return null;
    if (!settings.tenant_id || !settings.client_id || !settings.client_secret) return null;
    return {
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }

  // ── Defender (Microsoft Graph Security) ──────────────────────────────

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

  isEnvDefenderConfigured(): boolean {
    return this.getEnvDefenderSettings() !== null;
  }

  async getDefenderSettings(): Promise<DefenderIntegrationSettings | null> {
    const fileSettings = await this.getFileSettings();
    if (fileSettings?.defender?.configured) {
      return fileSettings.defender;
    }
    return this.getEnvDefenderSettings();
  }

  async saveDefenderSettings(settings: Partial<DefenderIntegrationSettings>): Promise<void> {
    const existing = await this.getFileSettings() ?? {};
    const current = existing.defender ?? {
      tenant_id: '',
      client_id: '',
      client_secret: '',
      configured: false,
    };
    const merged: DefenderIntegrationSettings = {
      tenant_id: settings.tenant_id || current.tenant_id,
      client_id: settings.client_id || current.client_id,
      client_secret: settings.client_secret || current.client_secret,
      configured: true,
      label: settings.label !== undefined ? settings.label : current.label,
      last_alert_sync: settings.last_alert_sync !== undefined ? settings.last_alert_sync : current.last_alert_sync,
      last_score_sync: settings.last_score_sync !== undefined ? settings.last_score_sync : current.last_score_sync,
    };
    const toSave: IntegrationsSettings = {
      ...existing,
      defender: {
        ...merged,
        tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
        client_id: 'enc:' + this.encrypt(merged.client_id),
        client_secret: 'enc:' + this.encrypt(merged.client_secret),
      },
    };
    await blobWrite(SETTINGS_KEY, JSON.stringify(toSave, null, 2));
  }

  /**
   * Read persisted Defender sync timestamps from either the defender settings
   * section (file-based credentials) or the standalone defender_sync key (env var credentials).
   */
  async getDefenderSyncTimestamps(): Promise<{ last_alert_sync?: string; last_score_sync?: string }> {
    const settings = await this.getDefenderSettings();
    if (settings?.last_alert_sync || settings?.last_score_sync) {
      return { last_alert_sync: settings.last_alert_sync, last_score_sync: settings.last_score_sync };
    }
    const raw = await this.getRawFileSettings() as Record<string, any> | null;
    const syncSection = raw?.defender_sync;
    if (syncSection) {
      return { last_alert_sync: syncSection.last_alert_sync, last_score_sync: syncSection.last_score_sync };
    }
    return {};
  }

  /**
   * Save only Defender sync timestamps without touching credentials.
   * Uses a standalone defender_sync key when no file-based defender section exists,
   * preventing env-var credentials from being clobbered.
   */
  async saveDefenderSyncTimestamps(timestamps: { last_alert_sync?: string; last_score_sync?: string }): Promise<void> {
    const existing = await this.getRawFileSettings() as Record<string, any> ?? {};

    if (existing.defender) {
      if (timestamps.last_alert_sync !== undefined) existing.defender.last_alert_sync = timestamps.last_alert_sync;
      if (timestamps.last_score_sync !== undefined) existing.defender.last_score_sync = timestamps.last_score_sync;
    } else {
      existing.defender_sync = { ...existing.defender_sync, ...timestamps };
    }

    await blobWrite(SETTINGS_KEY, JSON.stringify(existing, null, 2));
  }

  async isDefenderConfigured(): Promise<boolean> {
    const settings = await this.getDefenderSettings();
    if (!settings?.configured) return false;
    return !!(settings.tenant_id && settings.client_id && settings.client_secret);
  }

  /** Read raw (still-encrypted) JSON from blob without decrypting any fields. */
  private async getRawFileSettings(): Promise<IntegrationsSettings | null> {
    try {
      const data = await blobReadText(SETTINGS_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch { return null; }
  }

  /** Remove Defender integration credentials from blob settings. */
  async deleteDefenderSettings(): Promise<void> {
    const raw = await this.getRawFileSettings();
    if (!raw || !raw.defender) return;
    delete raw.defender;
    await blobWrite(SETTINGS_KEY, JSON.stringify(raw, null, 2));
  }

  /** Remove Azure integration credentials from blob settings. */
  async deleteAzureSettings(): Promise<void> {
    const raw = await this.getRawFileSettings();
    if (!raw || !raw.azure) return;
    delete raw.azure;
    await blobWrite(SETTINGS_KEY, JSON.stringify(raw, null, 2));
  }

  async getDefenderCredentials(): Promise<{ tenant_id: string; client_id: string; client_secret: string } | null> {
    const settings = await this.getDefenderSettings();
    if (!settings?.configured) return null;
    if (!settings.tenant_id || !settings.client_id || !settings.client_secret) return null;
    return {
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }
}
