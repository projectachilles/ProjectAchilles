/**
 * Config store with named profile support.
 *
 * Profiles let users switch between deployments:
 *   achilles config add-profile railway --url https://app.projectachilles.io
 *   achilles config add-profile fly --url https://rga.agent.projectachilles.io
 *   achilles config use fly
 *
 * Config stored at ~/.achilles/config.json
 * Auth tokens stored per-profile at ~/.achilles/auth-{profile}.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_SERVER_URL,
  DEFAULT_PAGE_SIZE,
  DEFAULT_OUTPUT,
} from './constants.js';

export interface AIConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  api_key?: string;
  base_url?: string;
}

export interface ProfileConfig {
  server_url: string;
  label?: string;
}

export interface CliConfig {
  active_profile: string;
  profiles: Record<string, ProfileConfig>;
  /** Legacy: direct server_url (migrated to profiles.default on load) */
  server_url?: string;
  org_id?: string;
  ai?: AIConfig;
  defaults: {
    output: 'pretty' | 'json';
    page_size: number;
  };
}

const DEFAULT_CONFIG: CliConfig = {
  active_profile: 'default',
  profiles: {
    default: { server_url: DEFAULT_SERVER_URL, label: 'Local' },
  },
  defaults: {
    output: DEFAULT_OUTPUT,
    page_size: DEFAULT_PAGE_SIZE,
  },
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): CliConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    // Migrate legacy config (no profiles key) to profile-based
    if (!parsed.profiles) {
      parsed.profiles = {
        default: { server_url: parsed.server_url || DEFAULT_SERVER_URL },
      };
      parsed.active_profile = 'default';
    }

    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Get the active profile's config */
export function getActiveProfile(): ProfileConfig & { name: string } {
  const config = loadConfig();
  const name = config.active_profile || 'default';
  const profile = config.profiles[name] ?? { server_url: DEFAULT_SERVER_URL };
  return { ...profile, name };
}

/** Get server URL from active profile */
export function getServerUrl(): string {
  return getActiveProfile().server_url;
}

/** Get the auth file path for the active profile */
export function getAuthFilePath(): string {
  const profile = getActiveProfile();
  if (profile.name === 'default') return join(CONFIG_DIR, 'auth.json');
  return join(CONFIG_DIR, `auth-${profile.name}.json`);
}

/** List all profiles */
export function listProfiles(): Array<{ name: string; server_url: string; label?: string; active: boolean }> {
  const config = loadConfig();
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    server_url: profile.server_url,
    label: profile.label,
    active: name === config.active_profile,
  }));
}

/** Add or update a profile */
export function addProfile(name: string, serverUrl: string, label?: string): void {
  const config = loadConfig();
  config.profiles[name] = { server_url: serverUrl, label };
  saveConfig(config);
}

/** Remove a profile */
export function removeProfile(name: string): boolean {
  if (name === 'default') return false;
  const config = loadConfig();
  if (!config.profiles[name]) return false;
  delete config.profiles[name];
  if (config.active_profile === name) config.active_profile = 'default';
  saveConfig(config);
  return true;
}

/** Switch active profile */
export function useProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.profiles[name]) return false;
  config.active_profile = name;
  saveConfig(config);
  return true;
}

export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  // Special case: server_url returns active profile's URL
  if (key === 'server_url') return getServerUrl();

  const parts = key.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig();

  // Special case: server_url sets the active profile's URL
  if (key === 'server_url') {
    const profileName = config.active_profile || 'default';
    if (!config.profiles[profileName]) config.profiles[profileName] = { server_url: value };
    else config.profiles[profileName].server_url = value;
    saveConfig(config);
    return;
  }

  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const parts = key.split('.');
  if (parts.some(p => DANGEROUS_KEYS.has(p))) {
    throw new Error(`Invalid config key: ${key}`);
  }

  let current: Record<string, unknown> = config as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalKey = parts[parts.length - 1];
  const numValue = Number(value);
  current[finalKey] = !isNaN(numValue) && value.trim() !== '' ? numValue : value;

  saveConfig(config);
}
