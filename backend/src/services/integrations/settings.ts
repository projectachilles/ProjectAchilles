// Settings service for external integration credentials (Azure / Entra ID).
// Follows the same AES-256-GCM encryption pattern as analytics/settings.ts.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encrypt as sharedEncrypt, decrypt as sharedDecrypt } from '../shared/encryption.js';
import type { AzureIntegrationSettings, DefenderIntegrationSettings, AlertSettings, IntegrationsSettings, OrgIntegrationSettings } from '../../types/integrations.js';

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'integrations.json');

export class IntegrationsSettingsService {
  /**
   * Optional Clerk org_id for per-org settings isolation (PA-018).
   * When set, reads/writes under `orgs[orgId]` with fallback to legacy top-level.
   * When unset, uses legacy top-level (backward compatible for single-org deploys).
   */
  private orgId?: string;

  constructor(orgId?: string) {
    this.orgId = orgId;
  }

  // ---------------------------------------------------------------------------
  // Encryption (delegates to shared/encryption.ts)
  // ---------------------------------------------------------------------------

  private encrypt(text: string): string { return sharedEncrypt(text); }
  private decrypt(encryptedText: string): string { return sharedDecrypt(encryptedText); }

  /**
   * Returns org-specific settings section if orgId is set, otherwise null.
   * Falls through to legacy top-level in callers.
   */
  private getOrgSection(settings: IntegrationsSettings | null): OrgIntegrationSettings | null {
    if (!this.orgId || !settings?.orgs?.[this.orgId]) return null;
    return settings.orgs[this.orgId];
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

      // Decrypt auth provider fields
      if (settings.auth_providers) {
        for (const provider of Object.values(settings.auth_providers) as Record<string, unknown>[]) {
          if (provider) {
            for (const key of Object.keys(provider)) {
              const val = provider[key];
              if (typeof val === 'string' && val.startsWith('enc:')) {
                provider[key] = this.decrypt(val.slice(4));
              }
            }
          }
        }
      }

      // Decrypt sensitive Alert channel fields
      if (settings.alerts) {
        if (settings.alerts.slack?.webhook_url?.startsWith('enc:')) {
          settings.alerts.slack.webhook_url = this.decrypt(settings.alerts.slack.webhook_url.slice(4));
        }
        if (settings.alerts.email?.smtp_user?.startsWith('enc:')) {
          settings.alerts.email.smtp_user = this.decrypt(settings.alerts.email.smtp_user.slice(4));
        }
        if (settings.alerts.email?.smtp_pass?.startsWith('enc:')) {
          settings.alerts.email.smtp_pass = this.decrypt(settings.alerts.email.smtp_pass.slice(4));
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

  /** Returns decrypted Azure settings. Org-specific > legacy file > env vars. */
  getAzureSettings(): AzureIntegrationSettings | null {
    const fileSettings = this.getFileSettings();

    // PA-018: Check org-specific settings first
    const orgSection = this.getOrgSection(fileSettings);
    if (orgSection?.azure?.configured) {
      return orgSection.azure;
    }

    // Fall back to legacy top-level
    if (fileSettings?.azure?.configured) {
      return fileSettings.azure;
    }

    return this.getEnvAzureSettings();
  }

  /** Save Azure credentials (encrypts sensitive fields). Supports partial update. */
  saveAzureSettings(settings: Partial<AzureIntegrationSettings>): void {
    this.ensureSettingsDir();

    const existing = this.getRawFileSettings() ?? {};

    // Resolve current values (from org section or legacy)
    const decrypted = this.getFileSettings() ?? {};
    const orgSection = this.getOrgSection(decrypted);
    const current = orgSection?.azure ?? decrypted.azure ?? {
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

    const encrypted = {
      ...merged,
      tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
      client_id: 'enc:' + this.encrypt(merged.client_id),
      client_secret: 'enc:' + this.encrypt(merged.client_secret),
    };

    // PA-018: Write to org section when orgId is set
    if (this.orgId) {
      existing.orgs ??= {};
      existing.orgs[this.orgId] ??= {};
      existing.orgs[this.orgId].azure = encrypted;
    } else {
      existing.azure = encrypted;
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
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

  /** Returns decrypted Defender settings. Org-specific > legacy file > env vars. */
  getDefenderSettings(): DefenderIntegrationSettings | null {
    const fileSettings = this.getFileSettings();

    const orgSection = this.getOrgSection(fileSettings);
    if (orgSection?.defender?.configured) {
      return orgSection.defender;
    }

    if (fileSettings?.defender?.configured) {
      return fileSettings.defender;
    }

    return this.getEnvDefenderSettings();
  }

  /** Save Defender credentials (encrypts sensitive fields). Supports partial update. */
  saveDefenderSettings(settings: Partial<DefenderIntegrationSettings>): void {
    this.ensureSettingsDir();

    const existing = this.getRawFileSettings() ?? {};
    const decrypted = this.getFileSettings() ?? {};
    const orgSection = this.getOrgSection(decrypted);
    const current = orgSection?.defender ?? decrypted.defender ?? {
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

    const encrypted = {
      ...merged,
      tenant_id: 'enc:' + this.encrypt(merged.tenant_id),
      client_id: 'enc:' + this.encrypt(merged.client_id),
      client_secret: 'enc:' + this.encrypt(merged.client_secret),
    };

    if (this.orgId) {
      existing.orgs ??= {};
      existing.orgs[this.orgId] ??= {};
      existing.orgs[this.orgId].defender = encrypted;
    } else {
      existing.defender = encrypted;
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
  }

  /**
   * Read persisted Defender sync timestamps from either the defender settings
   * section (file-based credentials) or the standalone defender_sync key (env var credentials).
   */
  getDefenderSyncTimestamps(): { last_alert_sync?: string; last_score_sync?: string; sync_version?: number } {
    // Check file-based defender settings first
    const settings = this.getDefenderSettings() as Record<string, any> | null;
    if (settings?.last_alert_sync || settings?.last_score_sync) {
      return {
        last_alert_sync: settings.last_alert_sync,
        last_score_sync: settings.last_score_sync,
        sync_version: settings.sync_version,
      };
    }
    // Fallback: standalone key (used when credentials come from env vars)
    const raw = this.getRawFileSettings() as Record<string, any> | null;
    const syncSection = raw?.defender_sync;
    if (syncSection) {
      return {
        last_alert_sync: syncSection.last_alert_sync,
        last_score_sync: syncSection.last_score_sync,
        sync_version: syncSection.sync_version,
      };
    }
    return {};
  }

  /**
   * Save only Defender sync timestamps without touching credentials.
   * Writes directly to the raw file to avoid the read-decrypt-merge-encrypt
   * cycle that would clobber env-var-based credentials with empty file entries.
   */
  saveDefenderSyncTimestamps(timestamps: { last_alert_sync?: string; last_score_sync?: string; sync_version?: number }): void {
    this.ensureSettingsDir();
    const existing = this.getRawFileSettings() ?? {};

    // Write timestamps into the correct section (org-specific or top-level)
    // but ONLY if that section already exists — never create a defender entry
    // just for timestamps, as that would shadow env var credentials.
    if (this.orgId && existing.orgs?.[this.orgId]?.defender) {
      const orgDefender = existing.orgs![this.orgId]!.defender!;
      if (timestamps.last_alert_sync !== undefined) orgDefender.last_alert_sync = timestamps.last_alert_sync;
      if (timestamps.last_score_sync !== undefined) orgDefender.last_score_sync = timestamps.last_score_sync;
    } else if (existing.defender) {
      if (timestamps.last_alert_sync !== undefined) existing.defender.last_alert_sync = timestamps.last_alert_sync;
      if (timestamps.last_score_sync !== undefined) existing.defender.last_score_sync = timestamps.last_score_sync;
    } else {
      // No existing defender section in file — credentials come from env vars.
      // Store timestamps in a lightweight top-level key that won't shadow env vars.
      (existing as any).defender_sync = {
        ...(existing as any).defender_sync,
        ...timestamps,
      };
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
  }

  /** Check if Defender integration is configured (file or env). */
  isDefenderConfigured(): boolean {
    const settings = this.getDefenderSettings();
    if (!settings?.configured) return false;
    return !!(settings.tenant_id && settings.client_id && settings.client_secret);
  }

  /** Read raw (still-encrypted) JSON without decrypting any fields. */
  private getRawFileSettings(): IntegrationsSettings | null {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch { return null; }
  }

  /** Remove Defender integration credentials from settings file. */
  deleteDefenderSettings(): void {
    const raw = this.getRawFileSettings();
    if (!raw) return;
    if (this.orgId && raw.orgs?.[this.orgId]) {
      delete raw.orgs[this.orgId].defender;
    } else if (raw.defender) {
      delete raw.defender;
    } else {
      return;
    }
    this.ensureSettingsDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 });
  }

  /** Remove Azure integration credentials from settings file. */
  deleteAzureSettings(): void {
    const raw = this.getRawFileSettings();
    if (!raw) return;
    if (this.orgId && raw.orgs?.[this.orgId]) {
      delete raw.orgs[this.orgId].azure;
    } else if (raw.azure) {
      delete raw.azure;
    } else {
      return;
    }
    this.ensureSettingsDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 });
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

  // ---------------------------------------------------------------------------
  // Trend Alerting
  // ---------------------------------------------------------------------------

  /** Returns decrypted alert settings. Org-specific > legacy. */
  getAlertSettings(): AlertSettings | null {
    const fileSettings = this.getFileSettings();

    const orgSection = this.getOrgSection(fileSettings);
    if (orgSection?.alerts) return orgSection.alerts;

    if (!fileSettings?.alerts) return null;
    return fileSettings.alerts;
  }

  /** Save alert settings (encrypts sensitive channel fields). Supports partial update. */
  saveAlertSettings(settings: Partial<AlertSettings>): void {
    this.ensureSettingsDir();

    // Load existing to support partial update
    const decrypted = this.getFileSettings() ?? {};
    const orgSection = this.getOrgSection(decrypted);
    const current: AlertSettings = orgSection?.alerts ?? decrypted.alerts ?? {
      thresholds: { enabled: false },
      cooldown_minutes: 15,
    };

    // Deep merge
    const merged: AlertSettings = {
      thresholds: settings.thresholds
        ? { ...current.thresholds, ...settings.thresholds }
        : current.thresholds,
      cooldown_minutes: settings.cooldown_minutes ?? current.cooldown_minutes,
      last_alert_at: settings.last_alert_at !== undefined
        ? settings.last_alert_at
        : current.last_alert_at,
    };

    // Merge Slack channel
    if (settings.slack || current.slack) {
      const currentSlack = current.slack;
      const newSlack = settings.slack;
      merged.slack = {
        webhook_url: newSlack?.webhook_url || currentSlack?.webhook_url || '',
        configured: newSlack?.configured ?? currentSlack?.configured ?? false,
        enabled: newSlack?.enabled ?? currentSlack?.enabled ?? false,
      };
    }

    // Merge Email channel
    if (settings.email || current.email) {
      const currentEmail = current.email;
      const newEmail = settings.email;
      merged.email = {
        smtp_host: newEmail?.smtp_host || currentEmail?.smtp_host || '',
        smtp_port: newEmail?.smtp_port ?? currentEmail?.smtp_port ?? 587,
        smtp_secure: newEmail?.smtp_secure ?? currentEmail?.smtp_secure ?? false,
        smtp_user: newEmail?.smtp_user || currentEmail?.smtp_user || '',
        smtp_pass: newEmail?.smtp_pass || currentEmail?.smtp_pass || '',
        from_address: newEmail?.from_address || currentEmail?.from_address || '',
        recipients: newEmail?.recipients ?? currentEmail?.recipients ?? [],
        configured: newEmail?.configured ?? currentEmail?.configured ?? false,
        enabled: newEmail?.enabled ?? currentEmail?.enabled ?? false,
      };
    }

    // Merge Agent Alerts
    if (settings.agent_alerts || current.agent_alerts) {
      const currentAgent = current.agent_alerts;
      const newAgent = settings.agent_alerts;
      merged.agent_alerts = {
        enabled: newAgent?.enabled ?? currentAgent?.enabled ?? false,
        offline_hours_threshold: newAgent?.offline_hours_threshold ?? currentAgent?.offline_hours_threshold,
        flapping_threshold: newAgent?.flapping_threshold ?? currentAgent?.flapping_threshold,
        fleet_online_percent_min: newAgent?.fleet_online_percent_min ?? currentAgent?.fleet_online_percent_min,
        cooldown_minutes: newAgent?.cooldown_minutes ?? currentAgent?.cooldown_minutes,
        last_alert_at: newAgent?.last_alert_at !== undefined ? newAgent.last_alert_at : currentAgent?.last_alert_at,
      };
    }

    // Encrypt sensitive channel fields
    const alertsToSave: AlertSettings = { ...merged };

    if (alertsToSave.slack) {
      alertsToSave.slack = {
        ...alertsToSave.slack,
        webhook_url: alertsToSave.slack.webhook_url
          ? 'enc:' + this.encrypt(alertsToSave.slack.webhook_url)
          : '',
      };
    }

    if (alertsToSave.email) {
      alertsToSave.email = {
        ...alertsToSave.email,
        smtp_user: alertsToSave.email.smtp_user
          ? 'enc:' + this.encrypt(alertsToSave.email.smtp_user)
          : '',
        smtp_pass: alertsToSave.email.smtp_pass
          ? 'enc:' + this.encrypt(alertsToSave.email.smtp_pass)
          : '',
      };
    }

    // PA-018: Write to org section when orgId is set
    const raw = this.getRawFileSettings() ?? {};
    if (this.orgId) {
      raw.orgs ??= {};
      raw.orgs[this.orgId] ??= {};
      raw.orgs[this.orgId].alerts = alertsToSave;
    } else {
      raw.alerts = alertsToSave;
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 });
  }

  /** Check if alerting is configured: thresholds enabled + at least one channel configured & enabled. */
  isAlertingConfigured(): boolean {
    const settings = this.getAlertSettings();
    if (!settings?.thresholds?.enabled) return false;

    const slackReady = !!(settings.slack?.configured && settings.slack?.enabled);
    const emailReady = !!(settings.email?.configured && settings.email?.enabled);

    return slackReady || emailReady;
  }

  /** Convenience: update the last_alert_at timestamp. */
  updateLastAlertTimestamp(timestamp: string): void {
    this.saveAlertSettings({ last_alert_at: timestamp });
  }

  // ---------------------------------------------------------------------------
  // Authentication Providers (Azure AD, Google, Clerk)
  // ---------------------------------------------------------------------------

  getAuthProviders(): import('../../types/integrations.js').AuthProvidersSettings | null {
    const fileSettings = this.getFileSettings();
    return fileSettings?.auth_providers ?? null;
  }

  getAuthProvider(provider: 'azuread' | 'google' | 'clerk'): Record<string, unknown> | null {
    const providers = this.getAuthProviders();
    if (!providers) return null;
    const p = providers[provider];
    return p?.configured ? p as unknown as Record<string, unknown> : null;
  }

  saveAuthProvider(provider: 'azuread' | 'google' | 'clerk', settings: Record<string, unknown>): void {
    this.ensureSettingsDir();
    const existing = this.getRawFileSettings() ?? {} as any;
    existing.auth_providers ??= {};

    // Encrypt all string values
    const encrypted: Record<string, unknown> = { configured: true };
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'configured') continue;
      if (typeof value === 'string' && value) {
        encrypted[key] = 'enc:' + this.encrypt(value);
      } else {
        encrypted[key] = value;
      }
    }

    (existing.auth_providers as any)[provider] = encrypted;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
  }

  deleteAuthProvider(provider: 'azuread' | 'google' | 'clerk'): void {
    this.ensureSettingsDir();
    const existing = this.getRawFileSettings() ?? {};
    if (existing.auth_providers) {
      delete existing.auth_providers[provider];
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
    }
  }

  isAuthProviderConfigured(provider: 'azuread' | 'google' | 'clerk'): boolean {
    return !!this.getAuthProvider(provider);
  }

  /** Returns a list of configured auth provider names. */
  getConfiguredAuthProviders(): string[] {
    const providers = this.getAuthProviders();
    if (!providers) return [];
    const result: string[] = [];
    if (providers.azuread?.configured) result.push('azuread');
    if (providers.google?.configured) result.push('google');
    if (providers.clerk?.configured) result.push('clerk');
    return result;
  }
}
