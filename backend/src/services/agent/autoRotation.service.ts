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

/**
 * How recently an agent must have checked in to be eligible for rotation.
 *
 * Rotation is only safe for an agent that will heartbeat again inside the
 * 300 s grace period — that heartbeat is how the new key is delivered. Agents
 * beat every 60 s, so one seen within 120 s has roughly three more chances to
 * collect the key before the window closes. Anything staler is skipped and
 * picked up on a later sweep, once it is genuinely back.
 */
const ROTATION_ELIGIBILITY_HEARTBEAT_SECONDS = 120;

export async function processAutoRotation(): Promise<void> {
  try {
    const settings = getAutoRotationSettings();
    if (!settings.enabled) return;

    const db = getDatabase();
    const days = settings.intervalDays;

    // Find agents whose key is older than the configured interval, that don't
    // already have a pending rotation, AND that are currently online.
    //
    // The liveness gate is a safety requirement, not an optimisation: arming a
    // rotation on an offline agent means the new key is never delivered. Before
    // this gate a sleeping laptop could have a rotation armed, and older builds
    // then promoted the undelivered key on grace expiry — locking the agent out
    // permanently. Cancel-on-expiry now makes that recoverable, but not arming
    // it in the first place avoids the churn entirely.
    // The cutoff is built in JS as an ISO string, matching how last_heartbeat
    // is written. Comparing against SQLite's datetime('now', …) would be a
    // silent bug: that returns 'YYYY-MM-DD HH:MM:SS' while last_heartbeat is
    // 'YYYY-MM-DDTHH:MM:SS.sssZ', and 'T' (0x54) sorts above ' ' (0x20) — so
    // *any* heartbeat from the same UTC day would compare as newer than the
    // cutoff, letting a laptop that checked in twelve hours ago through the
    // gate. Every other liveness query in this codebase uses the ISO form.
    const heartbeatCutoff = new Date(
      Date.now() - ROTATION_ELIGIBILITY_HEARTBEAT_SECONDS * 1000,
    ).toISOString();

    const agents = db.prepare(`
      SELECT id, hostname FROM agents
      WHERE status = 'active'
        AND key_rotation_initiated_at IS NULL
        AND last_heartbeat IS NOT NULL
        AND last_heartbeat > ?
        AND (
          (api_key_rotated_at IS NULL AND julianday('now') - julianday(created_at) > ?)
          OR (api_key_rotated_at IS NOT NULL AND julianday('now') - julianday(api_key_rotated_at) > ?)
        )
      LIMIT 5
    `).all(heartbeatCutoff, days, days) as AgentRow[];

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
