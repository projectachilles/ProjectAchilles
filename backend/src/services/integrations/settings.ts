// Settings service for external integration credentials (Azure / Entra ID).
// Follows the same AES-256-GCM encryption pattern as analytics/settings.ts.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encrypt as sharedEncrypt, decrypt as sharedDecrypt } from '../shared/encryption.js';
import type { AzureIntegrationSettings, DefenderIntegrationSettings, SophosIntegrationSettings, AlertSettings, IntegrationsSettings, OrgIntegrationSettings } from '../../types/integrations.js';
import type { AutoResolveMode } from '../../types/defender.js';

const AUTO_RESOLVE_MODES: ReadonlyArray<AutoResolveMode> = ['disabled', 'dry_run', 'enabled'] as const;
const DEFAULT_AUTO_RESOLVE_MODE: AutoResolveMode = 'disabled';

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

      // Decrypt sensitive Sophos fields. Note that tenant_id, data_region,
      // and tier are NOT encrypted — they're discovered via whoami (not
      // operator-supplied) and don't carry credential material.
      if (settings.sophos) {
        if (settings.sophos.client_id?.startsWith('enc:')) {
          settings.sophos.client_id = this.decrypt(settings.sophos.client_id.slice(4));
        }
        if (settings.sophos.client_secret?.startsWith('enc:')) {
          settings.sophos.client_secret = this.decrypt(settings.sophos.client_secret.slice(4));
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
      auto_resolve_mode: settings.auto_resolve_mode !== undefined ? settings.auto_resolve_mode : current.auto_resolve_mode,
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
  // Defender Auto-Resolve mode
  // ---------------------------------------------------------------------------

  /**
   * Read the current auto-resolve mode for the Defender integration.
   * Defaults to 'disabled' when the field is missing or the integration is
   * not yet configured — the auto-resolve pillar is opt-in.
   */
  getAutoResolveMode(): AutoResolveMode {
    const settings = this.getDefenderSettings();
    const mode = settings?.auto_resolve_mode;
    if (mode && AUTO_RESOLVE_MODES.includes(mode)) return mode;
    return DEFAULT_AUTO_RESOLVE_MODE;
  }

  /**
   * Persist a new auto-resolve mode without touching any other Defender
   * credentials. Throws if the mode string is not one of the valid values.
   * Does nothing (and throws) if Defender is not yet configured — we never
   * want to create a defender settings entry with empty credentials just to
   * hold a mode, since that would shadow env var credentials.
   */
  setAutoResolveMode(mode: AutoResolveMode): void {
    if (!AUTO_RESOLVE_MODES.includes(mode)) {
      throw new Error(`Invalid auto_resolve_mode: ${mode}. Must be one of: ${AUTO_RESOLVE_MODES.join(', ')}`);
    }

    const current = this.getDefenderSettings();
    if (!current?.configured) {
      throw new Error('Cannot set auto_resolve_mode: Defender integration is not configured');
    }

    // Partial update preserves credentials (encrypted) and existing sync timestamps.
    this.saveDefenderSettings({ auto_resolve_mode: mode });
  }

  // ---------------------------------------------------------------------------
  // Sophos Central
  // ---------------------------------------------------------------------------
  //
  // Sophos differs from Defender / Azure in three ways worth noting:
  //   1. Only client_id + client_secret come from the operator. tenant_id,
  //      data_region, and tier are *discovered* via the Sophos whoami
  //      endpoint and never sourced from env vars.
  //   2. Because of (1), the env-var override only sets credentials —
  //      whoami fills in the rest at bootstrap time.
  //   3. The shape of partial-update merging is therefore subtly different:
  //      "discovered" fields can be cleared by Phase 2 sync code re-discovering
  //      them, but Phase 1 leaves them alone.

  private getEnvSophosSettings(): SophosIntegrationSettings | null {
    const clientId = process.env.SOPHOS_CLIENT_ID;
    const clientSecret = process.env.SOPHOS_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;

    return {
      client_id: clientId,
      client_secret: clientSecret,
      configured: true,
      label: process.env.SOPHOS_TENANT_LABEL || undefined,
      // tenant_id, data_region, tier intentionally NOT read from env —
      // they only ever come from a successful whoami call.
    };
  }

  /** Check if Sophos credentials are provided via environment variables. */
  isEnvSophosConfigured(): boolean {
    return this.getEnvSophosSettings() !== null;
  }

  /** Returns decrypted Sophos settings. Org-specific > legacy file > env vars. */
  getSophosSettings(): SophosIntegrationSettings | null {
    const fileSettings = this.getFileSettings();

    const orgSection = this.getOrgSection(fileSettings);
    if (orgSection?.sophos?.configured) {
      return orgSection.sophos;
    }

    if (fileSettings?.sophos?.configured) {
      return fileSettings.sophos;
    }

    return this.getEnvSophosSettings();
  }

  /** Save Sophos credentials (encrypts client_id + client_secret). Partial update supported. */
  saveSophosSettings(settings: Partial<SophosIntegrationSettings>): void {
    this.ensureSettingsDir();

    const existing = this.getRawFileSettings() ?? {};
    const decrypted = this.getFileSettings() ?? {};
    const orgSection = this.getOrgSection(decrypted);
    const current = orgSection?.sophos ?? decrypted.sophos ?? {
      client_id: '',
      client_secret: '',
      configured: false,
    };

    const merged: SophosIntegrationSettings = {
      client_id: settings.client_id || current.client_id,
      client_secret: settings.client_secret || current.client_secret,
      configured: true,
      label: settings.label !== undefined ? settings.label : current.label,
      // Discovered fields — only overwrite if the caller explicitly provided them.
      tenant_id: settings.tenant_id !== undefined ? settings.tenant_id : current.tenant_id,
      data_region: settings.data_region !== undefined ? settings.data_region : current.data_region,
      tier: settings.tier !== undefined ? settings.tier : current.tier,
      // Phase 2+ fields
      last_alert_sync: settings.last_alert_sync !== undefined ? settings.last_alert_sync : current.last_alert_sync,
      last_score_sync: settings.last_score_sync !== undefined ? settings.last_score_sync : current.last_score_sync,
      auto_resolve_mode: settings.auto_resolve_mode !== undefined ? settings.auto_resolve_mode : current.auto_resolve_mode,
    };

    const encrypted = {
      ...merged,
      client_id: 'enc:' + this.encrypt(merged.client_id),
      client_secret: 'enc:' + this.encrypt(merged.client_secret),
    };

    if (this.orgId) {
      existing.orgs ??= {};
      existing.orgs[this.orgId] ??= {};
      existing.orgs[this.orgId].sophos = encrypted;
    } else {
      existing.sophos = encrypted;
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
  }

  /** Check if Sophos integration is configured (file or env). */
  isSophosConfigured(): boolean {
    const settings = this.getSophosSettings();
    if (!settings?.configured) return false;
    return !!(settings.client_id && settings.client_secret);
  }

  /** Returns raw decrypted Sophos credentials for injection into the client. */
  getSophosCredentials(): { client_id: string; client_secret: string } | null {
    const settings = this.getSophosSettings();
    if (!settings?.configured) return null;
    if (!settings.client_id || !settings.client_secret) return null;
    return { client_id: settings.client_id, client_secret: settings.client_secret };
  }

  /** Remove Sophos integration credentials from settings file. */
  deleteSophosSettings(): void {
    const raw = this.getRawFileSettings();
    if (!raw) return;
    if (this.orgId && raw.orgs?.[this.orgId]) {
      delete raw.orgs[this.orgId].sophos;
    } else if (raw.sophos) {
      delete raw.sophos;
    } else {
      return;
    }
    this.ensureSettingsDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 });
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
}
