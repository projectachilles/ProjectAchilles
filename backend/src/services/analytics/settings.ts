// Settings service for analytics module credentials

import * as fs from 'fs';
import * as path from 'path';
import { encrypt as sharedEncrypt, decrypt as sharedDecrypt } from '../shared/encryption.js';
import * as os from 'os';
import type { AnalyticsSettings } from '../../types/analytics.js';

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'analytics.json');

// Default settings
const defaultSettings: AnalyticsSettings = {
  connectionType: 'cloud',
  cloudId: '',
  apiKey: '',
  indexPattern: 'achilles-results-*',
  configured: false,
};

export class SettingsService {
  // Check if environment variables are configured for Elasticsearch
  private getEnvSettings(): AnalyticsSettings | null {
    const cloudId = process.env.ELASTICSEARCH_CLOUD_ID;
    const node = process.env.ELASTICSEARCH_NODE;

    // If neither is set, env config is not active
    if (!cloudId && !node) return null;

    return {
      connectionType: cloudId ? 'cloud' : 'direct',
      cloudId: cloudId || '',
      node: node || '',
      apiKey: process.env.ELASTICSEARCH_API_KEY || '',
      username: process.env.ELASTICSEARCH_USERNAME || '',
      password: process.env.ELASTICSEARCH_PASSWORD || '',
      indexPattern: process.env.ELASTICSEARCH_INDEX_PATTERN || 'achilles-results-*',
      configured: true,
      caCert: process.env.ELASTICSEARCH_CA_CERT || undefined,
      tlsInsecureSkipVerify: process.env.ELASTICSEARCH_TLS_INSECURE_SKIP_VERIFY === 'true',
    };
  }

  // Check if using environment variable configuration
  isEnvConfigured(): boolean {
    return this.getEnvSettings() !== null;
  }

  // Encryption delegates to shared/encryption.ts (single implementation for all services)
  private encrypt(text: string): string { return sharedEncrypt(text); }
  private decrypt(encryptedText: string): string { return sharedDecrypt(encryptedText); }

  // Ensure settings directory exists
  private ensureSettingsDir(): void {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
  }

  // Load file-based settings (without env override)
  private getFileSettings(): AnalyticsSettings | null {
    this.ensureSettingsDir();

    if (!fs.existsSync(SETTINGS_FILE)) {
      return null;
    }

    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const settings = JSON.parse(data) as AnalyticsSettings;

      // Decrypt sensitive fields
      if (settings.cloudId?.startsWith('enc:')) {
        settings.cloudId = this.decrypt(settings.cloudId.slice(4));
      }
      if (settings.apiKey?.startsWith('enc:')) {
        settings.apiKey = this.decrypt(settings.apiKey.slice(4));
      }
      if (settings.password?.startsWith('enc:')) {
        settings.password = this.decrypt(settings.password.slice(4));
      }

      return settings;
    } catch (error) {
      console.error('Error loading analytics settings:', error);
      return null;
    }
  }

  // Load settings - file settings (user-configured) take priority over env vars
  getSettings(): AnalyticsSettings {
    const fileSettings = this.getFileSettings();

    // If user has configured settings via UI, those take priority
    if (fileSettings?.configured) {
      return fileSettings;
    }

    // Fall back to env vars if no user-configured settings
    const envSettings = this.getEnvSettings();
    if (envSettings) {
      return envSettings;
    }

    return defaultSettings;
  }

  // Save settings to file
  saveSettings(settings: AnalyticsSettings): void {
    this.ensureSettingsDir();

    // Create a copy with encrypted sensitive fields
    const settingsToSave: AnalyticsSettings = {
      ...settings,
    };

    // Encrypt sensitive fields
    if (settingsToSave.cloudId) {
      settingsToSave.cloudId = 'enc:' + this.encrypt(settingsToSave.cloudId);
    }
    if (settingsToSave.apiKey) {
      settingsToSave.apiKey = 'enc:' + this.encrypt(settingsToSave.apiKey);
    }
    if (settingsToSave.password) {
      settingsToSave.password = 'enc:' + this.encrypt(settingsToSave.password);
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2), { mode: 0o600 });
  }

  // Check if settings are configured
  isConfigured(): boolean {
    const settings = this.getSettings();

    if (!settings.configured) return false;

    if (settings.connectionType === 'cloud') {
      return !!(settings.cloudId && settings.apiKey);
    } else {
      // Direct connections only require a node URL; auth is optional
      // (e.g. local ES with xpack.security.enabled=false)
      return !!settings.node;
    }
  }
}
