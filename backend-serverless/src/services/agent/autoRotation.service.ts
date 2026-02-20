import { getDb } from './database.js';
import { rotateAgentKey } from './enrollment.service.js';
import { blobReadText, blobWrite } from '../storage.js';

// ---------------------------------------------------------------------------
// Settings persistence — stored in Vercel Blob
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'settings/agent-settings.json';

export interface AutoRotationSettings {
  enabled: boolean;
  intervalDays: number;
}

const DEFAULTS: AutoRotationSettings = { enabled: false, intervalDays: 90 };

export async function getAutoRotationSettings(): Promise<AutoRotationSettings> {
  try {
    const data = await blobReadText(SETTINGS_KEY);
    if (!data) return { ...DEFAULTS };

    const parsed = JSON.parse(data) as Record<string, unknown>;
    const raw = parsed.autoRotation as Partial<AutoRotationSettings> | undefined;
    if (!raw) return { ...DEFAULTS };

    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
      intervalDays: typeof raw.intervalDays === 'number' ? raw.intervalDays : DEFAULTS.intervalDays,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveAutoRotationSettings(settings: AutoRotationSettings): Promise<void> {
  if (typeof settings.intervalDays !== 'number' || settings.intervalDays < 30 || settings.intervalDays > 365) {
    throw new Error('intervalDays must be between 30 and 365');
  }

  // Preserve other top-level keys in the file
  let existing: Record<string, unknown> = {};
  try {
    const data = await blobReadText(SETTINGS_KEY);
    if (data) existing = JSON.parse(data);
  } catch {
    // ignore corrupt file
  }

  existing.autoRotation = {
    enabled: !!settings.enabled,
    intervalDays: settings.intervalDays,
  };

  await blobWrite(SETTINGS_KEY, JSON.stringify(existing, null, 2));
}

// ---------------------------------------------------------------------------
// Background job — called via Vercel Cron
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  hostname: string;
}

export async function processAutoRotation(): Promise<void> {
  try {
    const settings = await getAutoRotationSettings();
    if (!settings.enabled) return;

    const db = await getDb();
    const days = settings.intervalDays;

    // Find active agents whose key is older than the configured interval
    // and that don't already have a pending rotation in progress.
    const agents = await db.all(`
      SELECT id, hostname FROM agents
      WHERE status = 'active'
        AND key_rotation_initiated_at IS NULL
        AND (
          (api_key_rotated_at IS NULL AND julianday('now') - julianday(created_at) > ?)
          OR (api_key_rotated_at IS NOT NULL AND julianday('now') - julianday(api_key_rotated_at) > ?)
        )
      LIMIT 5
    `, [days, days]) as unknown as AgentRow[];

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
