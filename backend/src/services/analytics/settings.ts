// Settings service for analytics module credentials

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import type { AnalyticsSettings } from '../../types/analytics.js';

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'analytics.json');

// Default settings
const defaultSettings: AnalyticsSettings = {
  connectionType: 'cloud',
  cloudId: '',
  apiKey: '',
  indexPattern: 'f0rtika-results-*',
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
      indexPattern: process.env.ELASTICSEARCH_INDEX_PATTERN || 'f0rtika-results-*',
      configured: true,
    };
  }

  // Check if using environment variable configuration
  isEnvConfigured(): boolean {
    return this.getEnvSettings() !== null;
  }

  // Derive encryption key from ENCRYPTION_SECRET env var, or fall back to machine ID
  private getEncryptionKey(): Buffer {
    const machineId = process.env.ENCRYPTION_SECRET || (os.hostname() + os.userInfo().username);
    return crypto.createHash('sha256').update(machineId).digest();
  }

  // Encrypt a string
  private encrypt(text: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  // Decrypt a string
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

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2));
  }

  // Check if settings are configured
  isConfigured(): boolean {
    const settings = this.getSettings();

    if (!settings.configured) return false;

    if (settings.connectionType === 'cloud') {
      return !!(settings.cloudId && settings.apiKey);
    } else {
      return !!(
        settings.node &&
        (settings.apiKey || (settings.username && settings.password))
      );
    }
  }
}
