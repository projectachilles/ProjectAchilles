// Settings service for external integration credentials — Vercel Blob storage version

import * as crypto from 'crypto';
import type { AzureIntegrationSettings, AzureCredentials, DefenderIntegrationSettings, DefenderCredentials, CrowdStrikeIntegrationSettings, CrowdStrikeCredentials, IntegrationsSettings } from '../../types/integrations.js';
import type { AutoResolveMode } from '../../types/defender.js';
import type { CrowdStrikeRegion, CrowdStrikeZtaStatus } from '../../types/crowdstrike.js';
import { CROWDSTRIKE_REGION_BASE_URLS, DEFAULT_CROWDSTRIKE_REGION } from '../crowdstrike/falcon-client.js';
import { blobReadText, blobWrite } from '../storage.js';

const SETTINGS_KEY = 'settings/integrations.json';

const AUTO_RESOLVE_MODES: ReadonlyArray<AutoResolveMode> = ['disabled', 'dry_run', 'enabled'] as const;
const DEFAULT_AUTO_RESOLVE_MODE: AutoResolveMode = 'disabled';

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
    if (!tenantId || !clientId) return null;

    const certThumbprint = process.env.AZURE_CERT_THUMBPRINT;
    const privateKeyPem = process.env.AZURE_PRIVATE_KEY_PEM;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (certThumbprint && privateKeyPem) {
      return {
        tenant_id: tenantId,
        client_id: clientId,
        client_secret: '',
        auth_method: 'certificate',
        cert_thumbprint: certThumbprint,
        private_key_pem: privateKeyPem,
        configured: true,
        label: process.env.AZURE_TENANT_LABEL || undefined,
      };
    }

    if (!clientSecret) return null;
    return {
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
      auth_method: 'client_secret',
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
        if (settings.azure.cert_thumbprint?.startsWith('enc:')) {
          settings.azure.cert_thumbprint = this.decrypt(settings.azure.cert_thumbprint.slice(4));
        }
        if (settings.azure.private_key_pem?.startsWith('enc:')) {
          settings.azure.private_key_pem = this.decrypt(settings.azure.private_key_pem.slice(4));
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
        if (settings.defender.cert_thumbprint?.startsWith('enc:')) {
          settings.defender.cert_thumbprint = this.decrypt(settings.defender.cert_thumbprint.slice(4));
        }
        if (settings.defender.private_key_pem?.startsWith('enc:')) {
          settings.defender.private_key_pem = this.decrypt(settings.defender.private_key_pem.slice(4));
        }
      }
      if (settings.crowdstrike) {
        if (settings.crowdstrike.client_id?.startsWith('enc:')) {
          settings.crowdstrike.client_id = this.decrypt(settings.crowdstrike.client_id.slice(4));
        }
        if (settings.crowdstrike.client_secret?.startsWith('enc:')) {
          settings.crowdstrike.client_secret = this.decrypt(settings.crowdstrike.client_secret.slice(4));
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
      auth_method: settings.auth_method !== undefined ? settings.auth_method : current.auth_method,
      cert_thumbprint: settings.cert_thumbprint !== undefined ? settings.cert_thumbprint : current.cert_thumbprint,
      private_key_pem: settings.private_key_pem !== undefined ? settings.private_key_pem : current.private_key_pem,
      label: settings.label !== undefined ? settings.label : current.label,
    };
    const encryptedAzure: Record<string, unknown> = {
      ...merged,
      tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
      client_id: 'enc:' + this.encrypt(merged.client_id),
      client_secret: 'enc:' + this.encrypt(merged.client_secret),
    };
    if (merged.cert_thumbprint) {
      encryptedAzure.cert_thumbprint = 'enc:' + this.encrypt(merged.cert_thumbprint);
    }
    if (merged.private_key_pem) {
      encryptedAzure.private_key_pem = 'enc:' + this.encrypt(merged.private_key_pem);
    }
    const toSave: IntegrationsSettings = { ...existing, azure: encryptedAzure as unknown as AzureIntegrationSettings };
    await blobWrite(SETTINGS_KEY, JSON.stringify(toSave, null, 2));
  }

  async isAzureConfigured(): Promise<boolean> {
    const settings = await this.getAzureSettings();
    if (!settings?.configured) return false;
    if (!settings.tenant_id || !settings.client_id) return false;
    const authMethod = settings.auth_method ?? 'client_secret';
    if (authMethod === 'certificate') {
      return !!(settings.cert_thumbprint && settings.private_key_pem);
    }
    return !!settings.client_secret;
  }

  async getAzureCredentials(): Promise<AzureCredentials | null> {
    const settings = await this.getAzureSettings();
    if (!settings?.configured) return null;
    if (!settings.tenant_id || !settings.client_id) return null;

    const authMethod = settings.auth_method ?? 'client_secret';
    if (authMethod === 'certificate') {
      if (!settings.cert_thumbprint || !settings.private_key_pem) return null;
      return {
        authMethod: 'certificate',
        tenant_id: settings.tenant_id,
        client_id: settings.client_id,
        cert_thumbprint: settings.cert_thumbprint,
        private_key_pem: settings.private_key_pem,
      };
    }

    if (!settings.client_secret) return null;
    return {
      authMethod: 'client_secret',
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }

  // ── Defender (Microsoft Graph Security) ──────────────────────────────

  private getEnvDefenderSettings(): DefenderIntegrationSettings | null {
    const tenantId = process.env.DEFENDER_TENANT_ID;
    const clientId = process.env.DEFENDER_CLIENT_ID;
    if (!tenantId || !clientId) return null;

    const certThumbprint = process.env.DEFENDER_CERT_THUMBPRINT;
    const privateKeyPem = process.env.DEFENDER_PRIVATE_KEY_PEM;
    const clientSecret = process.env.DEFENDER_CLIENT_SECRET;

    if (certThumbprint && privateKeyPem) {
      return {
        tenant_id: tenantId,
        client_id: clientId,
        client_secret: '',
        auth_method: 'certificate',
        cert_thumbprint: certThumbprint,
        private_key_pem: privateKeyPem,
        configured: true,
        label: process.env.DEFENDER_TENANT_LABEL || undefined,
      };
    }

    if (!clientSecret) return null;
    return {
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
      auth_method: 'client_secret',
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
      auth_method: settings.auth_method !== undefined ? settings.auth_method : current.auth_method,
      cert_thumbprint: settings.cert_thumbprint !== undefined ? settings.cert_thumbprint : current.cert_thumbprint,
      private_key_pem: settings.private_key_pem !== undefined ? settings.private_key_pem : current.private_key_pem,
      label: settings.label !== undefined ? settings.label : current.label,
      last_alert_sync: settings.last_alert_sync !== undefined ? settings.last_alert_sync : current.last_alert_sync,
      last_score_sync: settings.last_score_sync !== undefined ? settings.last_score_sync : current.last_score_sync,
      sync_version: settings.sync_version !== undefined ? settings.sync_version : current.sync_version,
      auto_resolve_mode: settings.auto_resolve_mode !== undefined ? settings.auto_resolve_mode : current.auto_resolve_mode,
    };
    const encryptedDefender: Record<string, unknown> = {
      ...merged,
      tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
      client_id: 'enc:' + this.encrypt(merged.client_id),
      client_secret: 'enc:' + this.encrypt(merged.client_secret),
    };
    if (merged.cert_thumbprint) {
      encryptedDefender.cert_thumbprint = 'enc:' + this.encrypt(merged.cert_thumbprint);
    }
    if (merged.private_key_pem) {
      encryptedDefender.private_key_pem = 'enc:' + this.encrypt(merged.private_key_pem);
    }
    const toSave: IntegrationsSettings = { ...existing, defender: encryptedDefender as unknown as DefenderIntegrationSettings };
    await blobWrite(SETTINGS_KEY, JSON.stringify(toSave, null, 2));
  }

  /**
   * Read persisted Defender sync timestamps from either the defender settings
   * section (file-based credentials) or the standalone defender_sync key (env var credentials).
   */
  async getDefenderSyncTimestamps(): Promise<{ last_alert_sync?: string; last_score_sync?: string; sync_version?: number }> {
    const settings = await this.getDefenderSettings() as Record<string, any> | null;
    if (settings?.last_alert_sync || settings?.last_score_sync) {
      return { last_alert_sync: settings.last_alert_sync, last_score_sync: settings.last_score_sync, sync_version: settings.sync_version };
    }
    const raw = await this.getRawFileSettings() as Record<string, any> | null;
    const syncSection = raw?.defender_sync;
    if (syncSection) {
      return { last_alert_sync: syncSection.last_alert_sync, last_score_sync: syncSection.last_score_sync, sync_version: syncSection.sync_version };
    }
    return {};
  }

  /**
   * Save only Defender sync timestamps without touching credentials.
   * Uses a standalone defender_sync key when no file-based defender section exists,
   * preventing env-var credentials from being clobbered.
   */
  async saveDefenderSyncTimestamps(timestamps: { last_alert_sync?: string; last_score_sync?: string; sync_version?: number }): Promise<void> {
    const existing = await this.getRawFileSettings() as Record<string, any> ?? {};

    if (existing.defender) {
      if (timestamps.last_alert_sync !== undefined) existing.defender.last_alert_sync = timestamps.last_alert_sync;
      if (timestamps.last_score_sync !== undefined) existing.defender.last_score_sync = timestamps.last_score_sync;
      if (timestamps.sync_version !== undefined) existing.defender.sync_version = timestamps.sync_version;
    } else {
      existing.defender_sync = { ...existing.defender_sync, ...timestamps };
    }

    await blobWrite(SETTINGS_KEY, JSON.stringify(existing, null, 2));
  }

  async isDefenderConfigured(): Promise<boolean> {
    const settings = await this.getDefenderSettings();
    if (!settings?.configured) return false;
    if (!settings.tenant_id || !settings.client_id) return false;
    const authMethod = settings.auth_method ?? 'client_secret';
    if (authMethod === 'certificate') {
      return !!(settings.cert_thumbprint && settings.private_key_pem);
    }
    return !!settings.client_secret;
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

  async getDefenderCredentials(): Promise<DefenderCredentials | null> {
    const settings = await this.getDefenderSettings();
    if (!settings?.configured) return null;
    if (!settings.tenant_id || !settings.client_id) return null;

    const authMethod = settings.auth_method ?? 'client_secret';
    if (authMethod === 'certificate') {
      if (!settings.cert_thumbprint || !settings.private_key_pem) return null;
      return {
        authMethod: 'certificate',
        tenant_id: settings.tenant_id,
        client_id: settings.client_id,
        cert_thumbprint: settings.cert_thumbprint,
        private_key_pem: settings.private_key_pem,
      };
    }

    if (!settings.client_secret) return null;
    return {
      authMethod: 'client_secret',
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }

  // ── Defender Auto-Resolve mode ─────────────────────────────────────

  /**
   * Read the current auto-resolve mode. Defaults to 'disabled' when the
   * field is missing, Defender isn't configured, or disk holds an unknown
   * string (forward-compat).
   */
  async getAutoResolveMode(): Promise<AutoResolveMode> {
    const settings = await this.getDefenderSettings();
    const mode = settings?.auto_resolve_mode;
    if (mode && AUTO_RESOLVE_MODES.includes(mode)) return mode;
    return DEFAULT_AUTO_RESOLVE_MODE;
  }

  /**
   * Persist a new auto-resolve mode without touching credentials. Throws
   * when the mode is invalid or when Defender isn't configured yet.
   */
  async setAutoResolveMode(mode: AutoResolveMode): Promise<void> {
    if (!AUTO_RESOLVE_MODES.includes(mode)) {
      throw new Error(`Invalid auto_resolve_mode: ${mode}. Must be one of: ${AUTO_RESOLVE_MODES.join(', ')}`);
    }
    const current = await this.getDefenderSettings();
    if (!current?.configured) {
      throw new Error('Cannot set auto_resolve_mode: Defender integration is not configured');
    }
    await this.saveDefenderSettings({ auto_resolve_mode: mode });
  }

  // ── CrowdStrike Falcon ────────────────────────────────────────────

  /**
   * Read and validate CROWDSTRIKE_REGION from the environment. An invalid
   * value is IGNORED with a clear warning (falls back to the us-1 default) —
   * the region feeds the constant region map in falcon-client.ts, and a
   * garbage value must never influence a fetch target.
   */
  private getEnvCrowdStrikeRegion(): CrowdStrikeRegion | undefined {
    const region = process.env.CROWDSTRIKE_REGION;
    if (!region) return undefined;
    if (region in CROWDSTRIKE_REGION_BASE_URLS) return region as CrowdStrikeRegion;
    console.warn(
      `[integrations] Ignoring invalid CROWDSTRIKE_REGION='${region}' — must be one of: ${Object.keys(CROWDSTRIKE_REGION_BASE_URLS).join(', ')}. Falling back to '${DEFAULT_CROWDSTRIKE_REGION}'.`,
    );
    return undefined;
  }

  private getEnvCrowdStrikeSettings(): CrowdStrikeIntegrationSettings | null {
    const clientId = process.env.CROWDSTRIKE_CLIENT_ID;
    const clientSecret = process.env.CROWDSTRIKE_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;

    return {
      region: this.getEnvCrowdStrikeRegion(),
      client_id: clientId,
      client_secret: clientSecret,
      configured: true,
      label: process.env.CROWDSTRIKE_LABEL || undefined,
    };
  }

  /** Check if CrowdStrike credentials are provided via environment variables. */
  isEnvCrowdStrikeConfigured(): boolean {
    return this.getEnvCrowdStrikeSettings() !== null;
  }

  async getCrowdStrikeSettings(): Promise<CrowdStrikeIntegrationSettings | null> {
    const fileSettings = await this.getFileSettings();
    if (fileSettings?.crowdstrike?.configured) {
      return fileSettings.crowdstrike;
    }
    return this.getEnvCrowdStrikeSettings();
  }

  async saveCrowdStrikeSettings(settings: Partial<CrowdStrikeIntegrationSettings>): Promise<void> {
    const existing = await this.getFileSettings() ?? {};
    const current = existing.crowdstrike ?? {
      client_id: '',
      client_secret: '',
      configured: false,
    };
    const merged: CrowdStrikeIntegrationSettings = {
      // Region only — the API base URL is derived from the constant region
      // map at use time, never stored.
      region: settings.region !== undefined ? settings.region : (current.region ?? DEFAULT_CROWDSTRIKE_REGION),
      client_id: settings.client_id || current.client_id,
      client_secret: settings.client_secret || current.client_secret,
      configured: true,
      label: settings.label !== undefined ? settings.label : current.label,
      last_alert_sync: settings.last_alert_sync !== undefined ? settings.last_alert_sync : current.last_alert_sync,
      last_zta_sync: settings.last_zta_sync !== undefined ? settings.last_zta_sync : current.last_zta_sync,
      zta_status: settings.zta_status !== undefined ? settings.zta_status : current.zta_status,
      auto_resolve_mode: settings.auto_resolve_mode !== undefined ? settings.auto_resolve_mode : current.auto_resolve_mode,
    };
    const toSave: IntegrationsSettings = {
      ...existing,
      crowdstrike: {
        ...merged,
        client_id: 'enc:' + this.encrypt(merged.client_id),
        client_secret: 'enc:' + this.encrypt(merged.client_secret),
      },
    };
    await blobWrite(SETTINGS_KEY, JSON.stringify(toSave, null, 2));
  }

  async isCrowdStrikeConfigured(): Promise<boolean> {
    const settings = await this.getCrowdStrikeSettings();
    if (!settings?.configured) return false;
    if (!settings.client_id) return false;
    return !!settings.client_secret;
  }

  /** Returns raw decrypted credentials for the Falcon OAuth2 client (region only — the client resolves the base URL from its constant map). */
  async getCrowdStrikeCredentials(): Promise<CrowdStrikeCredentials | null> {
    const settings = await this.getCrowdStrikeSettings();
    if (!settings?.configured) return null;
    if (!settings.client_id || !settings.client_secret) return null;
    return {
      region: settings.region ?? DEFAULT_CROWDSTRIKE_REGION,
      client_id: settings.client_id,
      client_secret: settings.client_secret,
    };
  }

  /** Remove CrowdStrike integration credentials from blob settings. */
  async deleteCrowdStrikeSettings(): Promise<void> {
    const raw = await this.getRawFileSettings();
    if (!raw || !raw.crowdstrike) return;
    delete raw.crowdstrike;
    await blobWrite(SETTINGS_KEY, JSON.stringify(raw, null, 2));
  }

  /**
   * Read persisted CrowdStrike sync timestamps from either the crowdstrike
   * settings section (blob-based credentials) or the standalone
   * crowdstrike_sync key (env var credentials).
   */
  async getCrowdStrikeSyncTimestamps(): Promise<{ last_alert_sync?: string; last_zta_sync?: string; zta_status?: CrowdStrikeZtaStatus; sync_version?: number }> {
    const settings = await this.getCrowdStrikeSettings();
    if (settings?.last_alert_sync || settings?.last_zta_sync) {
      return {
        last_alert_sync: settings.last_alert_sync,
        last_zta_sync: settings.last_zta_sync,
        zta_status: settings.zta_status,
        sync_version: settings.sync_version,
      };
    }
    const raw = await this.getRawFileSettings() as Record<string, any> | null;
    const syncSection = raw?.crowdstrike_sync;
    if (syncSection) {
      return {
        last_alert_sync: syncSection.last_alert_sync,
        last_zta_sync: syncSection.last_zta_sync,
        zta_status: syncSection.zta_status,
        sync_version: syncSection.sync_version,
      };
    }
    return {};
  }

  /**
   * Save only CrowdStrike sync timestamps without touching credentials.
   * Uses a standalone crowdstrike_sync key when no blob-based crowdstrike
   * section exists, preventing env-var credentials from being clobbered.
   */
  async saveCrowdStrikeSyncTimestamps(timestamps: { last_alert_sync?: string; last_zta_sync?: string; zta_status?: CrowdStrikeZtaStatus; sync_version?: number }): Promise<void> {
    const existing = await this.getRawFileSettings() as Record<string, any> ?? {};

    if (existing.crowdstrike) {
      if (timestamps.last_alert_sync !== undefined) existing.crowdstrike.last_alert_sync = timestamps.last_alert_sync;
      if (timestamps.last_zta_sync !== undefined) existing.crowdstrike.last_zta_sync = timestamps.last_zta_sync;
      if (timestamps.zta_status !== undefined) existing.crowdstrike.zta_status = timestamps.zta_status;
      if (timestamps.sync_version !== undefined) existing.crowdstrike.sync_version = timestamps.sync_version;
    } else {
      existing.crowdstrike_sync = { ...existing.crowdstrike_sync, ...timestamps };
    }

    await blobWrite(SETTINGS_KEY, JSON.stringify(existing, null, 2));
  }

  // ── CrowdStrike Auto-Resolve mode ──────────────────────────────

  /**
   * Read the current CrowdStrike auto-resolve mode. Defaults to 'disabled'
   * when the field is missing, CrowdStrike isn't configured, or the blob
   * holds an unknown string (forward-compat).
   */
  async getCrowdStrikeAutoResolveMode(): Promise<AutoResolveMode> {
    const settings = await this.getCrowdStrikeSettings();
    const mode = settings?.auto_resolve_mode;
    if (mode && AUTO_RESOLVE_MODES.includes(mode)) return mode;
    return DEFAULT_AUTO_RESOLVE_MODE;
  }

  /**
   * Persist a new auto-resolve mode without touching credentials. Throws
   * when the mode is invalid or when CrowdStrike isn't configured yet.
   */
  async setCrowdStrikeAutoResolveMode(mode: AutoResolveMode): Promise<void> {
    if (!AUTO_RESOLVE_MODES.includes(mode)) {
      throw new Error(`Invalid auto_resolve_mode: ${mode}. Must be one of: ${AUTO_RESOLVE_MODES.join(', ')}`);
    }
    const current = await this.getCrowdStrikeSettings();
    if (!current?.configured) {
      throw new Error('Cannot set auto_resolve_mode: CrowdStrike integration is not configured');
    }
    await this.saveCrowdStrikeSettings({ auto_resolve_mode: mode });
  }
}
