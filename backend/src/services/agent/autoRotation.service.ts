import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDatabase } from './database.js';
import { rotateAgentKey } from './enrollment.service.js';

// ---------------------------------------------------------------------------
// Settings persistence — stored in ~/.projectachilles/agent-settings.json
// ---------------------------------------------------------------------------

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'agent-settings.json');

export interface AutoRotationSettings {
  enabled: boolean;
  intervalDays: number;
}

const DEFAULTS: AutoRotationSettings = { enabled: false, intervalDays: 90 };

function ensureDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function getAutoRotationSettings(): AutoRotationSettings {
  ensureDir();
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS };

  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Record<string, unknown>;
    const raw = data.autoRotation as Partial<AutoRotationSettings> | undefined;
    if (!raw) return { ...DEFAULTS };

    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
      intervalDays: typeof raw.intervalDays === 'number' ? raw.intervalDays : DEFAULTS.intervalDays,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAutoRotationSettings(settings: AutoRotationSettings): void {
  ensureDir();

  if (typeof settings.intervalDays !== 'number' || settings.intervalDays < 30 || settings.intervalDays > 365) {
    throw new Error('intervalDays must be between 30 and 365');
  }

  // Preserve other top-level keys in the file
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
      // ignore corrupt file
    }
  }

  existing.autoRotation = {
    enabled: !!settings.enabled,
    intervalDays: settings.intervalDays,
  };

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Background job — called on a 60 s interval from server.ts
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  hostname: string;
}

export async function processAutoRotation(): Promise<void> {
  try {
    const settings = getAutoRotationSettings();
    if (!settings.enabled) return;

    const db = getDatabase();
    const days = settings.intervalDays;

    // Find active agents whose key is older than the configured interval
    // and that don't already have a pending rotation in progress.
    const agents = db.prepare(`
      SELECT id, hostname FROM agents
      WHERE status = 'active'
        AND key_rotation_initiated_at IS NULL
        AND (
          (api_key_rotated_at IS NULL AND julianday('now') - julianday(created_at) > ?)
          OR (api_key_rotated_at IS NOT NULL AND julianday('now') - julianday(api_key_rotated_at) > ?)
        )
      LIMIT 5
    `).all(days, days) as AgentRow[];

    for (const agent of agents) {
      try {
        await rotateAgentKey(agent.id);
        console.log(`auto-rotation: rotated key for agent ${agent.id} (${agent.hostname})`);
      } catch (err) {
        console.error(`auto-rotation: failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('auto-rotation: unexpected error:', err instanceof Error ? err.message : err);
  }
}
