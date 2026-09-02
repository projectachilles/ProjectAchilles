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

/**
 * Auto-rotation is ON by default.
 *
 * It was off because the sweep could brick an endpoint: it armed rotations on
 * agents that were offline, so the new key was never delivered, and grace
 * expiry then promoted the undelivered key and locked the agent out for good.
 * That is fixed — the sweep only targets agents with a recent heartbeat, and a
 * rotation is resolved by which key the agent actually presents rather than by
 * a timer, so an unclaimed rotation is cancelled instead of promoted.
 *
 * A 90-day-old credential on every endpoint in a fleet is a real risk that
 * someone has to remember to act on; defaulting to on makes the safe behaviour
 * the one you get without deciding.
 *
 * An explicitly saved preference still wins — getAutoRotationSettings only
 * falls back to this when the settings file has no `autoRotation.enabled`, so
 * an operator who deliberately turned it off stays off across upgrades.
 */
const DEFAULTS: AutoRotationSettings = { enabled: true, intervalDays: 90 };

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

/**
 * How recently an agent must have checked in to be eligible for rotation.
 *
 * Rotation is only safe for an agent that will heartbeat again inside the
 * 300 s grace period — that heartbeat is how the new key is delivered. Agents
 * beat every 60 s, so one seen within 120 s has roughly three more chances to
 * collect the key before the window closes.
 */
const ROTATION_ELIGIBILITY_HEARTBEAT_SECONDS = 120;

export async function processAutoRotation(): Promise<void> {
  try {
    const settings = await getAutoRotationSettings();
    if (!settings.enabled) return;

    const db = await getDb();
    const days = settings.intervalDays;

    // Find agents whose key is older than the configured interval, that don't
    // already have a pending rotation, AND that are currently online.
    //
    // The liveness gate is a safety requirement, not an optimisation: arming a
    // rotation on an offline agent means the new key is never delivered.
    //
    // The cutoff is built in JS as an ISO string, matching how last_heartbeat
    // is written. Comparing against SQLite's datetime('now', …) would be a
    // silent bug: that returns 'YYYY-MM-DD HH:MM:SS' while last_heartbeat is
    // 'YYYY-MM-DDTHH:MM:SS.sssZ', and 'T' (0x54) sorts above ' ' (0x20) — so
    // *any* heartbeat from the same UTC day would compare as newer than the
    // cutoff, letting a laptop that checked in twelve hours ago through.
    const heartbeatCutoff = new Date(
      Date.now() - ROTATION_ELIGIBILITY_HEARTBEAT_SECONDS * 1000,
    ).toISOString();

    const agents = await db.all(`
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
    `, [heartbeatCutoff, days, days]) as unknown as AgentRow[];

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
