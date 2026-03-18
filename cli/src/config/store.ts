import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
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

export interface CliConfig {
  server_url: string;
  org_id?: string;
  ai?: AIConfig;
  defaults: {
    output: 'pretty' | 'json';
    page_size: number;
  };
}

const DEFAULT_CONFIG: CliConfig = {
  server_url: DEFAULT_SERVER_URL,
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
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getConfigValue(key: string): unknown {
  const config = loadConfig();
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
  const parts = key.split('.');
  let current: Record<string, unknown> = config as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalKey = parts[parts.length - 1];
  // Auto-detect number values
  const numValue = Number(value);
  current[finalKey] = !isNaN(numValue) && value.trim() !== '' ? numValue : value;

  saveConfig(config);
}
