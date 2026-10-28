/**
 * Advance notice digest: a 09:00 (digest timezone) email per schedule org
 * listing the scheduled tests that start tomorrow.
 *
 * Runs outside processNotices with its own in-flight guard, so a slow or hung
 * SMTP server can never delay the pre-execution notice gate. Never reads or
 * writes run_notices or tasks, and never shows per-machine slot times
 * (agent_next_runs). State per (org, day) lives in notice_digests.
 *
 * Import rule: must not import services/agent/tasks.service.ts or
 * services/agent/schedules.service.ts.
 */
import crypto from 'crypto';
import { addDays, safeTimezone, toUTCDate, todayInTimezone } from '../agent/scheduleTime.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { sendMail } from '../alerts/email.service.js';
import type { OutgoingMail } from '../alerts/email.service.js';
import { isSmtpUsable } from './channels.js';
import { buildIcsEvents } from './ics.js';
import { MAX_INLINE_HOSTS, buildDigestEmail, buildHostsCsv } from './render.js';
import type { DigestEmailData, HostRowData } from './render.js';
import { occurrencesForDigestDay } from './digestOccurrences.js';
import type { DigestScheduleInput } from './digestOccurrences.js';
import { isOnline, retryBackoffMs, stagesText, tasksUiUrl } from './notices.service.js';
import * as repo from './digest.repo.js';
import type { ScheduleConfig, ScheduleType, TaskTestMetadata } from '../../types/agent.js';
import type { PreExecutionNoticeSettings } from '../../types/integrations.js';

const MIN = 60_000;
/** Local send time in the digest timezone. */
const SEND_TIME = '09:00';
/** A 'sending' claim older than this belongs to a crashed or hung pass and may be taken over. */
const STALE_CLAIM_MS = 10 * MIN;

export interface DigestPassResult {
  sent: number;
  empty: number;
  failed: number;
  skipped: number;
}

type Outcome = keyof DigestPassResult;
type Claim = { id: string; claimAt: string };
type Entry = DigestEmailData['entries'][number];
type IcsEvent = Parameters<typeof buildIcsEvents>[0][number];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseTime(s: string | null): number | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Take today's row for the org: insert it, or take over a failed row whose
 * backoff has elapsed or a stale 'sending' row. Null when the day is done
 * (sent / empty), still backing off, owned by a live pass, or the race was lost.
 */
function claimDigest(orgId: string, today: string, runDate: string, tz: string, now: Date): Claim | null {
  const nowIso = now.toISOString();
  const row = repo.getDigest(orgId, today);
  if (!row) {
    const id = crypto.randomUUID();
    return repo.insertClaim({ id, orgId, digestDate: today, runDate, timezone: tz, nowIso })
      ? { id, claimAt: nowIso }
      : null;
  }
  if (row.state === 'failed') {
    const last = parseTime(row.last_attempt_at);
    // abs(): a timestamp in the future (clock change) must not block retries all day.
    if (last !== null && Math.abs(now.getTime() - last) < retryBackoffMs(row.attempts)) return null;
    return repo.reclaim(row.id, { state: 'failed', claimAt: row.claim_at }, nowIso) ? { id: row.id, claimAt: nowIso } : null;
  }
  if (row.state === 'sending') {
    const claimed = parseTime(row.claim_at);
    // A claim in the future (clock stepped back) is stale too.
    if (claimed !== null && Math.abs(now.getTime() - claimed) <= STALE_CLAIM_MS) return null;
    return repo.reclaim(row.id, { state: 'sending', claimAt: row.claim_at }, nowIso) ? { id: row.id, claimAt: nowIso } : null;
  }
  return null;
}

function parseJson<T>(s: string, what: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new Error(`invalid ${what} JSON`);
  }
}

interface DigestContent {
  entries: Entry[];
  events: IcsEvent[];
  hosts: HostRowData[];
}

/** Tomorrow's occurrences with at least one listed host. A malformed schedule is logged and skipped. */
function buildContent(
  orgId: string,
  runDate: string,
  tz: string,
  settings: PreExecutionNoticeSettings,
  now: Date,
): DigestContent {
  const entries: Entry[] = [];
  const events: IcsEvent[] = [];
  const hostsByName = new Map<string, HostRowData>();

  for (const s of repo.getActiveSchedules(orgId)) {
    let occurrences: ReturnType<typeof occurrencesForDigestDay>;
    let agentIds: string[];
    let metadata: Partial<TaskTestMetadata>;
    try {
      const input: DigestScheduleInput = {
        id: s.id,
        name: s.name,
        schedule_type: s.schedule_type as ScheduleType,
        schedule_config: parseJson<ScheduleConfig>(s.schedule_config, 'schedule_config'),
        timezone: s.timezone,
      };
      occurrences = occurrencesForDigestDay(input, runDate, tz, settings);
      const ids = parseJson<unknown>(s.agent_ids, 'agent_ids');
      agentIds = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
      metadata = (parseJson<Partial<TaskTestMetadata> | null>(s.metadata || '{}', 'metadata') ?? {});
    } catch (err) {
      console.error(`[Digest] Skipping schedule ${s.id} for org ${orgId}:`, err);
      continue;
    }
    if (occurrences.length === 0) continue;

    const hostRows = repo.getListedAgentHosts(agentIds);
    if (hostRows.length === 0) continue;
    const hosts = hostRows.map((a) => ({ hostname: a.hostname, os: a.os, online: isOnline(a.last_heartbeat, now) }));
    hostRows.forEach((a, i) => hostsByName.set(a.hostname, hosts[i]));

    const scheduleName = s.name || s.test_name;
    const test = {
      name: s.test_name,
      uuid: s.test_uuid,
      stages: stagesText(s.test_uuid, s.org_id),
      techniques: Array.isArray(metadata.techniques) ? metadata.techniques : [],
      tactics: Array.isArray(metadata.tactics) ? metadata.tactics : [],
    };
    for (const o of occurrences) {
      entries.push({ scheduleName, mode: o.mode, timezone: s.timezone, start: o.start, end: o.end, test, hosts });
      events.push({
        uid: `digest-${s.id}-${o.runDay}@projectachilles`,
        sequence: 0,
        start: o.start,
        end: o.end,
        summary: `Security testing: ${scheduleName}`,
        description: `${test.name} (${test.uuid}) on ${hosts.length} host(s). Advance heads-up: the pre-execution notice sent on the day is authoritative. In your security tools, look for files and processes named after the test UUID under C:\\F0\\tasks or /opt/f0/tasks on those hosts.`,
        stamp: now,
      });
    }
  }

  entries.sort((a, b) => a.start.getTime() - b.start.getTime() || a.scheduleName.localeCompare(b.scheduleName));
  return { entries, events, hosts: [...hostsByName.values()] };
}

function buildMail(runDate: string, tz: string, recipients: string[], c: DigestContent): OutgoingMail {
  const { subject, html } = buildDigestEmail({ runDate, digestTz: tz, uiUrl: tasksUiUrl(), entries: c.entries });
  const base = `projectachilles-digest-${runDate}`;
  const attachments: NonNullable<OutgoingMail['attachments']> = [
    { filename: `${base}.ics`, content: buildIcsEvents(c.events), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' },
  ];
  if (c.hosts.length > MAX_INLINE_HOSTS) {
    attachments.push({ filename: `${base}-hosts.csv`, content: buildHostsCsv(c.hosts), contentType: 'text/csv; charset=utf-8' });
  }
  return { to: recipients, subject, html, attachments };
}

/** Build and send the claimed digest; records the outcome on the row. */
async function sendClaimed(
  orgId: string,
  claim: Claim,
  runDate: string,
  tz: string,
  svc: IntegrationsSettingsService,
  settings: PreExecutionNoticeSettings,
  now: Date,
): Promise<Outcome> {
  const nowIso = now.toISOString();
  const failed = (error: string): Outcome => {
    console.warn(`[Digest] Digest for org ${orgId} not sent: ${error}`);
    return repo.markFailed(claim.id, claim.claimAt, error, nowIso) ? 'failed' : 'skipped';
  };

  const content = buildContent(orgId, runDate, tz, settings, now);
  if (content.entries.length === 0) return repo.markEmpty(claim.id, claim.claimAt) ? 'empty' : 'skipped';

  const email = svc.getAlertSettings()?.email;
  if (!email || !isSmtpUsable(email)) return failed('SMTP email is not configured');
  const recipients = [...settings.recipients];
  if (recipients.length === 0) return failed('No recipients configured');

  const result = await sendMail(email, buildMail(runDate, tz, recipients, content));
  const rejected = result.rejected.length > 0 ? `rejected: ${result.rejected.join(', ')}` : null;
  if (result.accepted.length === 0) return failed(rejected ?? 'no recipients accepted');

  // Any acceptance counts: the digest is a heads-up, not a gate.
  const applied = repo.markSent(claim.id, claim.claimAt, {
    sentAt: nowIso,
    recipients,
    occurrenceCount: content.entries.length,
    hostCount: content.hosts.length,
    note: rejected,
  });
  return applied ? 'sent' : 'skipped';
}

async function processOrg(orgId: string, now: Date): Promise<Outcome> {
  const svc = new IntegrationsSettingsService(orgId);
  const settings = svc.getPreExecutionNoticeSettings();
  if (!settings.enabled || !settings.advance_digest_enabled) return 'skipped';

  const tz = safeTimezone(settings.digest_timezone);
  const today = todayInTimezone(tz, now);
  if (now.getTime() < toUTCDate(today, SEND_TIME, tz).getTime()) return 'skipped';
  const runDate = addDays(today, 1);

  const claim = claimDigest(orgId, today, runDate, tz, now);
  if (!claim) return 'skipped';
  try {
    return await sendClaimed(orgId, claim, runDate, tz, svc, settings, now);
  } catch (err) {
    console.error(`[Digest] Digest for org ${orgId} failed:`, err);
    return repo.markFailed(claim.id, claim.claimAt, errorMessage(err), now.toISOString()) ? 'failed' : 'skipped';
  }
}

async function runPass(now: Date): Promise<DigestPassResult> {
  const out: DigestPassResult = { sent: 0, empty: 0, failed: 0, skipped: 0 };
  for (const orgId of repo.listActiveScheduleOrgs()) {
    try {
      out[await processOrg(orgId, now)]++;
    } catch (err) {
      console.error(`[Digest] Org ${orgId} failed:`, err);
      out.failed++;
    }
  }
  return out;
}

let inFlight: Promise<DigestPassResult> | null = null;

/**
 * One digest pass per scheduler tick. A call made while a pass is still
 * running (a slow SMTP server can outlast the 60s tick) shares that pass.
 */
export function processAdvanceDigests(now?: Date): Promise<DigestPassResult> {
  if (inFlight) return inFlight;
  inFlight = runPass(now ?? new Date()).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
