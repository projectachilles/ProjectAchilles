// Settings service for analytics module credentials — Vercel Blob storage version

import * as crypto from 'crypto';
import type { AnalyticsSettings } from '../../types/analytics.js';
import { blobReadText, blobWrite } from '../storage.js';

const SETTINGS_KEY = 'settings/analytics.json';

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
    };
  }

  // Check if using environment variable configuration
  isEnvConfigured(): boolean {
    return this.getEnvSettings() !== null;
  }

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

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // Load Blob-based settings
  private async getFileSettings(): Promise<AnalyticsSettings | null> {
    try {
      const data = await blobReadText(SETTINGS_KEY);
      if (!data) return null;

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
  async getSettings(): Promise<AnalyticsSettings> {
    const fileSettings = await this.getFileSettings();

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

  // Save settings to Blob storage
  async saveSettings(settings: AnalyticsSettings): Promise<void> {
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

    await blobWrite(SETTINGS_KEY, JSON.stringify(settingsToSave, null, 2));
  }

  // Check if settings are configured
  async isConfigured(): Promise<boolean> {
    const settings = await this.getSettings();

    if (!settings.configured) return false;

    if (settings.connectionType === 'cloud') {
      return !!(settings.cloudId && settings.apiKey);
    } else {
      // Direct connections only require a node URL; auth is optional
      return !!settings.node;
    }
  }
}
