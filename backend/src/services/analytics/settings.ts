// Settings service for analytics module credentials

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homedir } from 'os';
import type { AnalyticsSettings } from '../../types/analytics.js';

const SETTINGS_DIR = path.join(homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'analytics.json');
const MASTER_KEY_FILE = path.join(SETTINGS_DIR, '.master.key');
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha256';

// Default settings
const defaultSettings: AnalyticsSettings = {
  connectionType: 'cloud',
  cloudId: '',
  apiKey: '',
  indexPattern: 'f0rtika-results-*',
  configured: false,
};

export class SettingsService {
  private masterKeyCache: Buffer | null = null;

  // Get or create master key (random, stored securely)
  private getMasterKey(): Buffer {
    if (this.masterKeyCache) {
      return this.masterKeyCache;
    }

    this.ensureSettingsDir();

    if (fs.existsSync(MASTER_KEY_FILE)) {
      // Read existing master key
      this.masterKeyCache = fs.readFileSync(MASTER_KEY_FILE);
      return this.masterKeyCache;
    }

    // Generate new random master key
    const masterKey = crypto.randomBytes(32);

    // Write with restricted permissions (owner read/write only)
    fs.writeFileSync(MASTER_KEY_FILE, masterKey, { mode: 0o600 });

    this.masterKeyCache = masterKey;
    return masterKey;
  }

  // Derive encryption key using PBKDF2 with salt
  private getEncryptionKey(salt: Buffer): Buffer {
    const masterKey = this.getMasterKey();
    return crypto.pbkdf2Sync(
      masterKey,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_LENGTH,
      PBKDF2_DIGEST
    );
  }

  // Encrypt a string (includes salt in output for key derivation)
  private encrypt(text: string): string {
    const salt = crypto.randomBytes(16);
    const key = this.getEncryptionKey(salt);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: salt:iv:authTag:encrypted
    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  // Decrypt a string
  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');

    // Handle legacy format (iv:authTag:encrypted) - 3 parts
    // New format (salt:iv:authTag:encrypted) - 4 parts
    if (parts.length === 3) {
      // Legacy format - use empty salt for backwards compatibility
      const [ivHex, authTagHex, encrypted] = parts;
      const salt = Buffer.alloc(16, 0); // Empty salt for legacy
      const key = this.getEncryptionKey(salt);
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    // New format with salt
    const [saltHex, ivHex, authTagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const key = this.getEncryptionKey(salt);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // Ensure settings directory exists with secure permissions
  private ensureSettingsDir(): void {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
    } else {
      // Ensure existing directory has correct permissions
      try {
        fs.chmodSync(SETTINGS_DIR, 0o700);
      } catch {
        // Ignore permission errors (may not be owner)
      }
    }
  }

  // Load settings from file
  getSettings(): AnalyticsSettings {
    this.ensureSettingsDir();

    if (!fs.existsSync(SETTINGS_FILE)) {
      return defaultSettings;
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
      return defaultSettings;
    }
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

    // Write with restricted permissions (owner read/write only)
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2), { mode: 0o600 });
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
