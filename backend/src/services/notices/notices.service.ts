/**
 * Pre-execution notices: creation (Run Now / retry / scheduler tick), the send
 * pass, the per-tick sweeps (processNotices: bounded wait, pickup deadline,
 * Finished email, daily SMTP check), admin release and the status read model.
 * All SQL is in notices.repo.ts.
 *
 * Import rule (Ruling R2): this module must not import
 * services/agent/tasks.service.ts.
 */
import crypto from 'crypto';
import { getDatabase } from '../agent/database.js';
import { randomWindowForDate, safeTimezone, todayInTimezone } from '../agent/scheduleTime.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { sendMail, testEmailConnection } from '../alerts/email.service.js';
import type { OutgoingMail } from '../alerts/email.service.js';
import { sendSlackText } from '../alerts/slack.service.js';
import { AppError } from '../../middleware/error.middleware.js';
import { isFullyAccepted } from './acceptance.js';
import { isSlackUsable, isSmtpUsable } from './channels.js';
import { buildIcs } from './ics.js';
import { MAX_INLINE_HOSTS, buildFinishedEmail, buildHostsCsv, buildNoticeEmail, classifyOutcome } from './render.js';
import type { FinishedEmailData, NoticeEmailData } from './render.js';
import { computeDayRelease, computeRunRelease, runTag } from './window.js';
import * as repo from './notices.repo.js';
import { latestDigests } from './digest.repo.js';
import type { DigestState } from './digest.repo.js';
import { resolveUserLabel } from './userLabel.js';
import { getTestMetadata } from '../agent/test-catalog.service.js';
import { fetchEdrDocs } from '../outcomes/edr.js';
import { cellVerdict, controlsOf, edrTerminatedReason, edrTerminatedVerdict, resultDocIds } from '../outcomes/verdict.js';
import { isAnyEdrConfigured } from '../edr/edr-configured.js';
import type { NoticeRow, NoticeScope, NoticeSourceType, NoticeState } from './types.js';
import type { TaskPayload, TaskResult, TaskStatus } from '../../types/agent.js';
import type { EdrVendorKey } from '../edr/agent-kill-evidence.js';
import type { PreExecutionNoticeSettings } from '../../types/integrations.js';
import { noticeEdrContext } from './edrContext.js';

export { getNoticeSummaries } from './notices.repo.js';

/** Notices newest first, optionally one state, each with its run tag and held-task count. */
export function listNotices(limit: number, offset: number, scope: NoticeScope, state?: NoticeState) {
  const rows = repo.listNotices(limit, offset, scope, state);
  const held = repo.countHeldTasks(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, run_tag: runTag(r.id), held_tasks: held.get(r.id) ?? 0 }));
}
export type { NoticeScope } from './types.js';

const MIN = 60_000;
/** A claim older than this belongs to a crashed or hung sender and may be taken over. */
const STALE_CLAIM_MS = 5 * MIN;
/** Matches the heartbeat service's online/offline threshold. */
const ONLINE_THRESHOLD_MS = 180_000;
/** Used for window_end when no linked task carries an execution_timeout. */
const DEFAULT_EXECUTION_TIMEOUT_SEC = 300;

/**
 * Ruling R23: a per-machine run that comes due when today's day notice is
 * already announced with less than this left before its pickup deadline gets
 * its own run notice (fresh email, normal run window). An announced notice's
 * deadline is never extended, so joining it would leave too little time to be
 * picked up and expire the task as "host offline".
 */
export const LATE_LINK_MIN_PICKUP_MS = 10 * MIN;

const SKIP_NO_TASKS = 'no tasks were created';
const SKIP_NONE_HELD = 'all linked tasks were cancelled or completed';
const SKIP_COLLISION = 'previous run still waiting for notice delivery';

export type SendOutcome = 'sent' | 'failed' | 'skipped' | 'not_claimed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Settings for an org (Ruling R20): `orgs[orgId]` sections with the legacy top
 * level as the fallback. `null`/`undefined` (and org ids with no section, such
 * as 'default') resolve to the legacy top level.
 */
function settingsFor(orgId: string | null | undefined): IntegrationsSettingsService {
  return new IntegrationsSettingsService(orgId ?? undefined);
}

/** Settings of the org that owns a notice. */
function noticeSettings(n: Pick<NoticeRow, 'org_id'>): IntegrationsSettingsService {
  return settingsFor(n.org_id);
}

export { safeTimezone };

function serverTimezone(): string {
  return safeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Base UI link (Ruling R3): first CORS_ORIGIN entry, else the Vite dev origin. */
export function tasksUiUrl(): string {
  const first = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const base = (first ?? 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/endpoints/tasks`;
}

/** Parses ISO strings and SQLite `YYYY-MM-DD HH:MM:SS` (UTC) timestamps. */
function parseTimestamp(s: string | null | undefined): number | null {
  if (!s) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : ms;
}

export function isOnline(lastHeartbeat: string | null, now: Date): boolean {
  const ms = parseTimestamp(lastHeartbeat);
  return ms !== null && now.getTime() - ms <= ONLINE_THRESHOLD_MS;
}

function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * The gate applies to new runs whenever notices are enabled. It does not
 * depend on SMTP: if SMTP becomes unusable later, notices are still created
 * and fail to send (recorded on the notice, banner + Slack), so tests are held
 * and never run unannounced. Enabling requires usable SMTP (settings route).
 */
export function isNoticeGateEnabled(orgId: string | null): boolean {
  return settingsFor(orgId).getPreExecutionNoticeSettings().enabled;
}

function recipientsSnapshot(orgId: string | null): string[] {
  return [...settingsFor(orgId).getPreExecutionNoticeSettings().recipients];
}

/**
 * Recipients for a send attempt: the current settings, so fixing a typo takes
 * effect on the next attempt. Falls back to the notice's own list if settings
 * have none (notices can be disabled with recipients cleared).
 */
function attemptRecipients(n: NoticeRow): string[] {
  const current = recipientsSnapshot(n.org_id);
  return current.length > 0 ? current : parseJsonArray(n.recipients);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

function fireSend(id: string): void {
  // Deferred so the caller's response is never blocked or failed by SMTP.
  void Promise.resolve()
    .then(() => sendNotice(id))
    .catch((err: unknown) => {
      console.error(`[Notices] send of ${runTag(id)} failed:`, err);
    });
}

/**
 * Run `fn` with a fresh pending run notice when `source.orgId`'s gate is
 * enabled. `orgId` is the org of the tasks `fn` creates (the notice's owner).
 * The notice insert and whatever `fn` writes share one transaction, so an
 * error in `fn` leaves no notice behind. After commit the first send attempt
 * is fired in the background; its errors are logged, never thrown to the
 * caller.
 */
export function runWithNotice<T>(
  source: { type: NoticeSourceType; createdBy: string; orgId: string | null; timezone?: string },
  fn: (noticeId: string | null) => T,
): T {
  if (!isNoticeGateEnabled(source.orgId)) return fn(null);

  const db = getDatabase();
  const id = crypto.randomUUID();
  const recipients = recipientsSnapshot(source.orgId);
  const timezone = source.timezone ? safeTimezone(source.timezone) : serverTimezone();

  const result = db.transaction(() => {
    repo.insertNotice({
      id,
      kind: 'run',
      state: 'pending',
      sourceType: source.type,
      scheduleIds: [],
      timezone,
      createdBy: source.createdBy,
      createdAt: new Date().toISOString(),
      recipients,
      orgId: source.orgId,
    });
    return fn(id);
  })();

  fireSend(id);
  return result;
}

export interface DayNoticeSchedule {
  id: string;
  /** The schedule's org: owns the day notice. */
  org_id: string | null;
  timezone: string;
  created_by: string;
  agent_next_runs: Record<string, string>;
  execution_timeout: number;
}

export interface SchedulerTick {
  /**
   * `orgId`'s shared run notice for this tick (created on first use; one per
   * org per tick). Does not list the schedule on it: call confirmRunSchedule
   * once its tasks were created.
   */
  runNoticeFor(scheduleId: string, timezone: string, createdBy: string, orgId: string | null): string | null;
  /** List a schedule on its org's run notice for this tick, after its createTasks succeeded. */
  confirmRunSchedule(scheduleId: string, orgId: string | null): void;
  dayNoticeFor(schedule: DayNoticeSchedule): string | null;
  /**
   * Rulings R23/R24: today's day notice for `schedule` when it is already
   * announced (`sent`/`overridden`) with less than LATE_LINK_MIN_PICKUP_MS
   * before its pickup deadline, as `{ dayWindowEnd }`. The caller then links
   * this tick's due tasks, plus every remaining agent slotted before
   * `dayWindowEnd`, to runNoticeFor instead of dayNoticeFor. Null when the
   * gate is off or there is no such notice.
   */
  closedDayNotice(schedule: Pick<DayNoticeSchedule, 'id' | 'org_id' | 'timezone'>): { dayWindowEnd: Date } | null;
  hasPendingRunNotice(scheduleId: string, orgId: string | null): boolean;
  recordSkippedOccurrence(scheduleId: string, createdBy: string, timezone: string, orgId: string | null): void;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

/**
 * Per-tick notice factory for processSchedules. All non-per-machine batches of
 * one org created in one tick share that org's run notice; per-machine
 * schedules get one day notice per schedule per calendar day (schedule
 * timezone). Each schedule's gate and recipients are its org's (Ruling R20).
 */
export function createSchedulerTick(now: Date): SchedulerTick {
  const nowIso = now.toISOString();
  // Keyed by org id ('' for null: legacy). Map keys can't collide with a real
  // org id because Clerk org ids are never empty.
  const key = (orgId: string | null): string => orgId ?? '';
  const gates = new Map<string, boolean>();
  const gateEnabled = (orgId: string | null): boolean => {
    const k = key(orgId);
    let g = gates.get(k);
    if (g === undefined) {
      g = isNoticeGateEnabled(orgId);
      gates.set(k, g);
    }
    return g;
  };
  const runNoticeIds = new Map<string, string>();

  return {
    runNoticeFor(_scheduleId, timezone, createdBy, orgId) {
      if (!gateEnabled(orgId)) return null;
      const cached = runNoticeIds.get(key(orgId));
      if (cached) return cached;
      // Not wrapped in a transaction with createTasks: the id is cached for the
      // whole tick, so a rollback would leave the cache pointing at nothing.
      // A notice whose createTasks all failed is an orphan the send pass skips.
      const id = crypto.randomUUID();
      repo.insertNotice({
        id,
        kind: 'run',
        state: 'pending',
        sourceType: 'schedule',
        scheduleIds: [],
        timezone: safeTimezone(timezone),
        createdBy,
        createdAt: nowIso,
        recipients: recipientsSnapshot(orgId),
        orgId,
      });
      runNoticeIds.set(key(orgId), id);
      return id;
    },

    confirmRunSchedule(scheduleId, orgId) {
      const id = runNoticeIds.get(key(orgId));
      if (id) repo.appendScheduleId(id, scheduleId);
    },

    dayNoticeFor(schedule) {
      if (!gateEnabled(schedule.org_id)) return null;
      const tz = safeTimezone(schedule.timezone);
      const windowDate = todayInTimezone(tz, now);
      const existing = repo.getDayNotice(schedule.id, windowDate);
      if (existing) return existing.id;

      const window = randomWindowForDate(windowDate, tz);
      const startMs = window.start.getTime();
      const endMs = window.end.getTime();
      const announced = Object.entries(schedule.agent_next_runs ?? {})
        .filter(([, at]) => {
          const ms = parseTimestamp(at);
          return ms !== null && ms >= startMs && ms <= endMs;
        })
        .map(([agentId]) => agentId);

      const id = crypto.randomUUID();
      try {
        repo.insertNotice({
          id,
          kind: 'day',
          state: 'pending',
          sourceType: 'schedule',
          scheduleIds: [schedule.id],
          scheduleId: schedule.id,
          windowDate,
          timezone: tz,
          announcedAgentIds: announced,
          dayWindowStart: window.start.toISOString(),
          dayWindowEnd: window.end.toISOString(),
          createdBy: schedule.created_by,
          createdAt: nowIso,
          recipients: recipientsSnapshot(schedule.org_id),
          orgId: schedule.org_id,
        });
        return id;
      } catch (err) {
        // Another writer created today's notice first (idx_run_notices_day).
        if (!isUniqueViolation(err)) throw err;
        const raced = repo.getDayNotice(schedule.id, windowDate);
        if (!raced) throw err;
        return raced.id;
      }
    },

    closedDayNotice(schedule) {
      if (!gateEnabled(schedule.org_id)) return null;
      const tz = safeTimezone(schedule.timezone);
      const existing = repo.getDayNotice(schedule.id, todayInTimezone(tz, now));
      // Pending: its deadline is computed at acceptance (R7). not_delivered /
      // skipped keep their own rules (R5/R18/R19).
      if (!existing || (existing.state !== 'sent' && existing.state !== 'overridden')) return null;
      const deadline = parseTimestamp(existing.pickup_deadline);
      // A released notice with no deadline would never serve a task.
      const closed = deadline === null || deadline - now.getTime() < LATE_LINK_MIN_PICKUP_MS;
      if (!closed) return null;
      // Without a stored window end, sweep nothing beyond the agents due now.
      return { dayWindowEnd: new Date(parseTimestamp(existing.day_window_end) ?? now.getTime()) };
    },

    hasPendingRunNotice(scheduleId, orgId) {
      // With the gate off nothing is held, so a leftover pending notice must not skip runs.
      return gateEnabled(orgId) && repo.hasPendingRunNoticeForSchedule(scheduleId);
    },

    recordSkippedOccurrence(scheduleId, createdBy, timezone, orgId) {
      repo.insertNotice({
        id: crypto.randomUUID(),
        kind: 'run',
        state: 'skipped',
        sourceType: 'schedule',
        scheduleIds: [scheduleId],
        timezone: safeTimezone(timezone),
        createdBy,
        createdAt: nowIso,
        recipients: recipientsSnapshot(orgId),
        skipReason: SKIP_COLLISION,
        orgId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Send pass
// ---------------------------------------------------------------------------

/** `user` is the display label for `n.created_by` (see resolveUserLabel). */
function triggerText(n: NoticeRow, user: string = n.created_by): string {
  switch (n.source_type) {
    case 'run_now':
      return `Run Now by ${user}`;
    case 'manual_retry':
      return `Manual retry by ${user}`;
    case 'schedule': {
      const ids = parseJsonArray(n.schedule_ids);
      if (ids.length === 0 && n.schedule_id) ids.push(n.schedule_id);
      const names = repo.getScheduleNames(ids);
      return ids.map((id) => `Schedule "${names.get(id) ?? id}"`).join(', ');
    }
    default:
      return user;
  }
}

/**
 * The Stages cell: the library's stage count (a single-binary test is 1),
 * a bundle's control count from its last completed run, "bundle" before it
 * has run, or a dash when the test is no longer in the library.
 */
export function stagesText(testUuid: string, orgId: string | null): string {
  const meta = getTestMetadata(testUuid);
  if (!meta) return '—';
  if (meta.category === 'cyber-hygiene') {
    const controls = repo.getLastBundleControlCount(testUuid, orgId);
    return controls ? `${controls} controls` : 'bundle';
  }
  return String(meta.stages?.length || 1);
}

function parsePayload(s: string): TaskPayload | null {
  try {
    return JSON.parse(s) as TaskPayload;
  } catch {
    return null;
  }
}

type ReleaseTimes = { releaseAt: Date; pickupDeadline: Date; windowEnd: Date };

/** Longest `execution_timeout` across the linked tasks' payloads (default 300s). */
function maxExecutionTimeoutSec(linked: Array<{ payload: string }>): number {
  let max = 0;
  for (const t of linked) {
    const p = parsePayload(t.payload);
    if (p && typeof p.execution_timeout === 'number' && p.execution_timeout > max) max = p.execution_timeout;
  }
  return max > 0 ? max : DEFAULT_EXECUTION_TIMEOUT_SEC;
}

/** The window `n` gets if accepted at `at`: day rules for day notices, run rules otherwise. */
function releaseTimesFor(
  n: NoticeRow,
  at: Date,
  settings: PreExecutionNoticeSettings,
  maxTimeoutSec: number,
): ReleaseTimes {
  if (n.kind === 'day' && n.day_window_start && n.day_window_end) {
    return computeDayRelease(at, settings, new Date(n.day_window_end), maxTimeoutSec);
  }
  return computeRunRelease(at, settings, maxTimeoutSec);
}

function buildNoticeMail(
  n: NoticeRow,
  linked: repo.LinkedTaskRow[],
  recipients: string[],
  now: Date,
  userLabel: string,
): OutgoingMail {
  const svc = noticeSettings(n);
  const settings = svc.getPreExecutionNoticeSettings();
  const timezone = safeTimezone(n.timezone);
  const tag = runTag(n.id);

  // Tests: one entry per test_uuid, from the task payload metadata.
  const tests = new Map<string, NoticeEmailData['tests'][number]>();
  for (const t of linked) {
    const p = parsePayload(t.payload);
    if (!p) continue;
    const key = p.test_uuid || p.test_name;
    if (tests.has(key)) continue;
    tests.set(key, {
      name: p.test_name || key,
      uuid: p.test_uuid ?? '',
      stages: p.test_uuid ? stagesText(p.test_uuid, n.org_id) : '—',
      techniques: p.metadata?.techniques ?? [],
      tactics: p.metadata?.tactics ?? [],
    });
  }
  const maxTimeoutSec = maxExecutionTimeoutSec(linked);

  // Hosts: agents with a linked task, plus (day notices) every announced agent.
  const hosts = new Map<string, NoticeEmailData['hosts'][number]>();
  for (const t of linked) {
    if (hosts.has(t.agent_id)) continue;
    hosts.set(t.agent_id, {
      hostname: t.hostname ?? t.agent_id,
      os: t.os ?? '',
      online: isOnline(t.last_heartbeat, now),
    });
  }
  if (n.kind === 'day') {
    const missing = parseJsonArray(n.announced_agent_ids).filter((a) => !hosts.has(a));
    for (const a of repo.getAgentHosts(missing)) {
      hosts.set(a.id, { hostname: a.hostname, os: a.os, online: isOnline(a.last_heartbeat, now) });
    }
  }
  const hostList = [...hosts.values()];

  // Window as announced if accepted now.
  const release = releaseTimesFor(n, now, settings, maxTimeoutSec);
  const dayWindow =
    n.kind === 'day' && n.day_window_start && n.day_window_end
      ? { start: new Date(n.day_window_start), end: new Date(n.day_window_end) }
      : undefined;

  // EDR context.
  const edr = noticeEdrContext(svc);

  const trigger = triggerText(n, userLabel);
  const data: NoticeEmailData = {
    kind: n.kind,
    runTag: tag,
    timezone,
    trigger,
    startNotBefore: release.releaseAt,
    pickupDeadline: release.pickupDeadline,
    windowEnd: release.windowEnd,
    ...(dayWindow ? { dayWindow } : {}),
    tests: [...tests.values()],
    hosts: hostList,
    edr,
    uiUrl: tasksUiUrl(),
  };
  const { subject, html } = buildNoticeEmail(data);

  const ics = buildIcs({
    uid: `${n.id}@projectachilles`,
    sequence: 0,
    start: release.releaseAt,
    end: release.windowEnd,
    summary: `ProjectAchilles security testing ${tag}`,
    description: `${trigger}. ${data.tests.length} test(s) on ${hostList.length} host(s). In your security tools, look for files and processes named after the test UUID under C:\\F0\\tasks or /opt/f0/tasks on those hosts (${tag} itself does not appear on the hosts).`,
    stamp: now,
  });
  const attachments: NonNullable<OutgoingMail['attachments']> = [
    { filename: `${tag}.ics`, content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' },
  ];
  if (hostList.length > MAX_INLINE_HOSTS) {
    attachments.push({ filename: `${tag}-hosts.csv`, content: buildHostsCsv(hostList), contentType: 'text/csv; charset=utf-8' });
  }

  return { to: recipients, subject, html, attachments };
}

async function alertSlackOnFailure(n: NoticeRow, error: string): Promise<void> {
  if (n.slack_failure_alerted) return;
  const slack = noticeSettings(n).getAlertSettings()?.slack;
  if (!slack || !isSlackUsable(slack)) return;
  // Take the once-per-notice flag atomically before sending, so two failing
  // senders can't both alert.
  if (!repo.claimSlackFailureAlert(n.id)) return;
  try {
    await sendSlackText(
      slack.webhook_url,
      `Notice ${runTag(n.id)} could not be sent: ${error}. Tests are waiting.`,
    );
  } catch (err) {
    // Unflag, so the next failure tries Slack again.
    repo.resetSlackFailureAlert(n.id);
    console.error(`[Notices] Slack alert for ${runTag(n.id)} failed:`, err);
  }
}

/** The later of `now` (the pass clock) and the real clock. */
function laterOfNow(now: Date | undefined): Date {
  return new Date(Math.max(now?.getTime() ?? 0, Date.now()));
}

/**
 * One send attempt for a pending notice. Claims it atomically (a second
 * concurrent caller gets `not_claimed`), emails the current recipients, and on
 * full acceptance marks it `sent` with release times counted from acceptance.
 * Every write after the claim is conditional on still owning it; a sender
 * whose stale claim was taken over gets `not_claimed` and writes nothing.
 */
export async function sendNotice(id: string, now?: Date): Promise<SendOutcome> {
  const start = now ?? new Date();
  const claimAt = start.toISOString();
  const staleCutoff = new Date(start.getTime() - STALE_CLAIM_MS);
  if (!repo.claimNotice(id, claimAt, staleCutoff.toISOString())) return 'not_claimed';

  const n = repo.getNotice(id);
  if (!n) return 'not_claimed';

  const linked = repo.getLinkedTasks(id);
  const held = linked.some((t) => t.status === 'pending');
  if (n.kind === 'run' && !held) {
    // Orphan (createTasks threw after the notice was created) or every task
    // was cancelled: nothing is waiting on this notice, so never email.
    const reason = linked.length === 0 ? SKIP_NO_TASKS : SKIP_NONE_HELD;
    return repo.markSkipped(id, claimAt, reason) ? 'skipped' : 'not_claimed';
  }
  if (!held) {
    // Day notice with no held task (none linked yet, or all cancelled):
    // nothing to announce. It stays pending, because later per-machine
    // agents today link to it; try again next tick.
    repo.releaseClaim(id, claimAt);
    return 'not_claimed';
  }

  const recipients = attemptRecipients(n);
  let accepted: string[] = [];
  let rejected: string[] = [];
  let error: string;
  try {
    const email = noticeSettings(n).getAlertSettings()?.email;
    if (!email || !isSmtpUsable(email)) throw new Error('SMTP email is not configured');

    // The email is rendered before sending, from the attempt start: it
    // announces "not before start + lead".
    const userLabel = await resolveUserLabel(n.created_by);
    const mail = buildNoticeMail(n, linked, recipients, start, userLabel);
    const result = await sendMail(email, mail);
    accepted = result.accepted;
    rejected = result.rejected;

    if (isFullyAccepted(recipients, result)) {
      // The countdown starts at acceptance (after SMTP returned), so the
      // stored release is never earlier than the email's "not before".
      const sentAt = laterOfNow(now);
      const settings = noticeSettings(n).getPreExecutionNoticeSettings();
      const times = releaseTimesFor(n, sentAt, settings, maxExecutionTimeoutSec(linked));
      const applied = repo.markSent(id, claimAt, {
        sentAt: sentAt.toISOString(),
        recipients,
        accepted,
        rejected,
        releaseAt: times.releaseAt.toISOString(),
        pickupDeadline: times.pickupDeadline.toISOString(),
        windowEnd: times.windowEnd.toISOString(),
      });
      // Not applied: this sender lost the claim (stale takeover) or the notice
      // left 'pending' mid-send (admin override). The owner, if any, records it.
      return applied ? 'sent' : 'not_claimed';
    }

    if (rejected.length > 0) {
      error = `rejected: ${rejected.join(', ')}`;
    } else {
      const got = new Set(accepted.map((a) => a.trim().toLowerCase()));
      const missing = recipients.filter((r) => !got.has(r.trim().toLowerCase()));
      error = missing.length > 0 ? `not accepted: ${missing.join(', ')}` : 'no recipients accepted';
    }
  } catch (err) {
    error = errorMessage(err);
  }

  // A sender that lost its claim records nothing and alerts nobody.
  const recorded = repo.recordSendFailure(id, claimAt, {
    error,
    recipients,
    accepted,
    rejected,
    attemptAt: laterOfNow(now).toISOString(),
  });
  if (!recorded) return 'not_claimed';
  await alertSlackOnFailure(n, error);
  return 'failed';
}

// ---------------------------------------------------------------------------
// Sweeps (scheduler tick)
// ---------------------------------------------------------------------------

const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MAX_FINISHED_ATTEMPTS = 3;
/**
 * Finished emails only for windows that closed this recently, so turning
 * send_finished back on doesn't mail every old run at once. Task TTL is 7 days,
 * so a run's tasks are terminal well inside this.
 */
const FINISHED_LOOKBACK_MS = 7 * DAY;
/** The banner flags a pending notice older than this. */
const PENDING_OVERDUE_MS = 5 * MIN;
const NOT_DELIVERED_LOOKBACK_MS = 7 * DAY;
const SMTP_CHECK_INTERVAL_MS = DAY;

const REASON_NOT_DELIVERED = 'Not run: notice not delivered';
const REASON_HOST_OFFLINE = 'Not run: host offline during notice window';

function notRunResult(reason: string): string {
  return JSON.stringify({ error: reason, exit_code: -1, stdout: '', stderr: '', execution_duration_ms: 0 });
}

/** Post to `orgId`'s Slack if it is configured. Returns false if not configured or the post failed. */
async function postSlack(orgId: string | null, text: string): Promise<boolean> {
  const slack = settingsFor(orgId).getAlertSettings()?.slack;
  if (!slack || !isSlackUsable(slack)) return false;
  try {
    await sendSlackText(slack.webhook_url, text);
    return true;
  } catch (err) {
    console.error('[Notices] Slack post failed:', err);
    return false;
  }
}


export interface ProcessNoticesResult {
  sent: number;
  notDelivered: number;
  expiredTasks: number;
  finished: number;
}

/** Run one phase; an error is logged and the pass moves on to the next phase. */
async function phase(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[Notices] ${name} failed:`, err);
  }
}

/** Retry backoff after `attempts` failed attempts: 1, 2, 4, 8, then every 15 minutes. */
export function retryBackoffMs(attempts: number): number {
  if (attempts < 1) return 0;
  return Math.min(2 ** (attempts - 1), 15) * MIN;
}

/** Whether a pending notice's backoff has elapsed (first attempts are never delayed). */
function backoffElapsed(p: repo.PendingNoticeRow, now: Date): boolean {
  if (p.attempts < 1) return true;
  const last = parseTimestamp(p.last_attempt_at);
  if (last === null) return true;
  // abs(): a timestamp in the future (clock change) must not block retries forever.
  return Math.abs(now.getTime() - last) >= retryBackoffMs(p.attempts);
}

async function sendPass(now: Date): Promise<number> {
  let sent = 0;
  for (const p of repo.listPendingNotices()) {
    if (!backoffElapsed(p, now)) continue;
    const id = p.id;
    try {
      if ((await sendNotice(id, now)) === 'sent') sent++;
    } catch (err) {
      console.error(`[Notices] send of ${runTag(id)} failed:`, err);
    }
  }
  return sent;
}

async function boundedWaitPass(now: Date): Promise<{ notDelivered: number; expired: number }> {
  const nowIso = now.toISOString();
  const staleClaimCutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const maxWait = (orgId: string | null): number => settingsFor(orgId).getPreExecutionNoticeSettings().max_wait_minutes;

  // Each org's pending notices wait for that org's max_wait_minutes.
  let notDelivered = 0;
  for (const orgId of repo.listPendingNoticeOrgIds()) {
    const minutes = maxWait(orgId);
    const createdCutoff = new Date(now.getTime() - minutes * MIN).toISOString();
    const moved = repo.markNotDelivered(orgId, createdCutoff, staleClaimCutoff, {
      noTasks: SKIP_NO_TASKS,
      noneHeld: SKIP_NONE_HELD,
    });
    for (const id of moved) console.warn(`[Notices] ${runTag(id)} not delivered within ${minutes} min`);
    notDelivered += moved.length;
  }

  // Every pass, not only at the transition (Ruling R5).
  const expired = repo.expireTasksOfNotDelivered(nowIso, notRunResult(REASON_NOT_DELIVERED));

  // Once per notice, to the owning org's Slack. Without Slack configured for
  // that org, nothing is claimed.
  const since = new Date(now.getTime() - NOT_DELIVERED_LOOKBACK_MS).toISOString();
  for (const n of repo.listNotDeliveredToAlert(since)) {
    if (!isSlackUsable(noticeSettings(n).getAlertSettings()?.slack)) continue;
    if (!repo.claimSlackNotDeliveredAlert(n.id)) continue;
    const why = n.last_error ? ` Last error: ${n.last_error}.` : '';
    const ok = await postSlack(
      n.org_id,
      `Notice ${runTag(n.id)} was not delivered within ${maxWait(n.org_id)} minutes; its tests were not run.${why}`,
    );
    // Unflag, so the next pass tries Slack again.
    if (!ok) repo.resetSlackNotDeliveredAlert(n.id);
  }
  return { notDelivered, expired };
}

function parseResult(s: string | null): TaskResult | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as TaskResult;
  } catch {
    return null;
  }
}

async function sendFinished(n: NoticeRow, rows: repo.TaskOutcomeRow[], now: Date): Promise<boolean> {
  if (rows.length === 0) return false;

  // Same verdict as Analytics and the campaign evidence page: completed
  // results get EDR prevention/detection from their ES docs. By now the
  // pickup window has closed, so the EDR sync has had time to tag them.
  const latest = repo.latestAttempts(rows).map((r) => ({ row: r, result: parseResult(r.result) }));
  const completed = latest.filter((x) => x.row.status === 'completed' && x.result);
  const edr = await fetchEdrDocs(completed.flatMap((x) =>
    resultDocIds(x.row.id, x.row.category, controlsOf(x.result!.bundle_results?.controls))));
  const counts: FinishedEmailData['counts'] = { protected: 0, prevented: 0, detected: 0, unprotected: 0, error: 0, notRun: 0 };
  // Vendors that killed the agent mid-run (reconciled from their alerts), earliest first.
  const killedBy: EdrVendorKey[] = [];
  let killedRuns = 0;
  for (const { row, result } of latest) {
    if (row.status === 'failed' && result?.edr_terminated?.vendors?.length) {
      counts[edrTerminatedVerdict(result.edr_terminated).state]++;
      killedRuns++;
      for (const v of result.edr_terminated.vendors) if (!killedBy.includes(v)) killedBy.push(v);
    } else if (row.status === 'completed' && result) {
      const v = cellVerdict({
        taskId: row.id,
        exitCode: typeof result.exit_code === 'number' ? result.exit_code : null,
        error: null,
        stderrTail: null,
        category: row.category,
        controls: controlsOf(result.bundle_results?.controls),
        edr,
      });
      counts[v.state]++;
    } else {
      counts[classifyOutcome({ status: row.status as TaskStatus, result })]++;
    }
  }

  // Actual finish: the latest completed_at (ISO or SQLite UTC form).
  let finishMs: number | null = null;
  let firstPickupMs: number | null = null;
  for (const r of rows) {
    const c = parseTimestamp(r.completed_at);
    if (c !== null && (finishMs === null || c > finishMs)) finishMs = c;
    const a = parseTimestamp(r.assigned_at);
    if (a !== null && (firstPickupMs === null || a < firstPickupMs)) firstPickupMs = a;
  }
  const releaseMs = parseTimestamp(n.release_at) ?? parseTimestamp(n.sent_at) ?? now.getTime();
  const startedAt = new Date(firstPickupMs ?? releaseMs);
  const finishedAt = new Date(finishMs ?? now.getTime());

  const tag = runTag(n.id);
  const timezone = safeTimezone(n.timezone);
  const { subject, html } = buildFinishedEmail({
    runTag: tag,
    timezone,
    startedAt,
    finishedAt,
    counts,
    edrUnavailable: edr.status === 'unavailable',
    edrTerminated: killedRuns > 0
      ? { runs: killedRuns, reason: edrTerminatedReason(killedBy) }
      : undefined,
    uiUrl: tasksUiUrl(),
  });
  // Updated event: same UID, next SEQUENCE, ending at the actual finish.
  const icsStart = new Date(releaseMs);
  const ics = buildIcs({
    uid: `${n.id}@projectachilles`,
    sequence: 1,
    start: icsStart,
    end: new Date(Math.max(icsStart.getTime(), finishedAt.getTime())),
    summary: `ProjectAchilles security testing ${tag}`,
    description: `Finished. Protected ${counts.protected}, prevented ${counts.prevented}, detected ${counts.detected}, unprotected ${counts.unprotected}, error ${counts.error}, not run ${counts.notRun}. Reference ${tag}.`,
    stamp: now,
  });

  const recipients = parseJsonArray(n.recipients);
  try {
    const email = noticeSettings(n).getAlertSettings()?.email;
    if (!email || !isSmtpUsable(email)) throw new Error('SMTP email is not configured');
    const result = await sendMail(email, {
      to: recipients,
      subject,
      html,
      attachments: [{ filename: `${tag}.ics`, content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
    });
    if (!isFullyAccepted(recipients, result)) throw new Error('not every recipient accepted the Finished email');
  } catch (err) {
    console.error(`[Notices] Finished email for ${tag} failed:`, errorMessage(err));
    repo.recordFinishedFailure(n.id);
    return false;
  }
  return repo.markFinishedSent(n.id, now.toISOString());
}

async function finishedPass(now: Date): Promise<number> {
  let finished = 0;
  const since = new Date(now.getTime() - FINISHED_LOOKBACK_MS).toISOString();
  const candidates = repo.listFinishedCandidates(now.toISOString(), since, MAX_FINISHED_ATTEMPTS);
  // EDR integrations are deployment-wide; read their settings once per pass.
  const edrConfigured = candidates.length > 0 && isAnyEdrConfigured();
  for (const n of candidates) {
    // send_finished is the owning org's setting.
    if (!noticeSettings(n).getPreExecutionNoticeSettings().send_finished) continue;
    const rows = repo.getLinkedTaskOutcomes(n.id);
    // A run cut off by a watchdog may yet be proved EDR-killed (Protected):
    // wait for reconciliation, up to 15 minutes. Not an attempt.
    if (repo.finishedHoldActive(rows, now, edrConfigured)) continue;
    if (await sendFinished(n, rows, now)) finished++;
  }
  return finished;
}

/**
 * Daily SMTP check for one settings section: the legacy top level (`orgId`
 * undefined) or an org's own section. Result stored in that section.
 */
async function smtpCheckFor(orgId: string | undefined, now: Date): Promise<void> {
  const svc = new IntegrationsSettingsService(orgId);
  const settings = svc.getPreExecutionNoticeSettings();
  if (!settings.enabled) return;
  const last = parseTimestamp(settings.last_smtp_check_at);
  // abs(): a timestamp in the future (clock change) must not suppress checks forever.
  if (last !== null && Math.abs(now.getTime() - last) < SMTP_CHECK_INTERVAL_MS) return;

  const email = svc.getAlertSettings()?.email;
  let r: { success: boolean; message: string };
  if (!email || !isSmtpUsable(email)) {
    r = { success: false, message: 'SMTP email is not configured' };
  } else {
    try {
      r = await testEmailConnection(email);
    } catch (err) {
      r = { success: false, message: errorMessage(err) };
    }
  }
  svc.savePreExecutionNoticeSettings({
    last_smtp_check_at: now.toISOString(),
    last_smtp_check_ok: r.success,
    last_smtp_check_message: r.message,
  });
  if (!r.success) {
    await postSlack(
      orgId ?? null,
      `Daily SMTP check for pre-execution notices failed: ${r.message}. Test runs will wait for notice delivery until this is fixed.`,
    );
  }
}

/**
 * The legacy section, then every org with its own notice section. An org that
 * has no notice section of its own uses the legacy settings and the legacy
 * check result.
 */
async function dailySmtpCheck(now: Date): Promise<void> {
  const sections: Array<string | undefined> = [undefined, ...new IntegrationsSettingsService().listNoticeOrgIds()];
  for (const orgId of sections) {
    try {
      await smtpCheckFor(orgId, now);
    } catch (err) {
      console.error(`[Notices] SMTP check for ${orgId ?? 'legacy settings'} failed:`, err);
    }
  }
}

async function runPass(now: Date): Promise<ProcessNoticesResult> {
  const out: ProcessNoticesResult = { sent: 0, notDelivered: 0, expiredTasks: 0, finished: 0 };
  // Existing notices are processed even when the feature is off; turning it
  // off only affects new runs. Only the SMTP check depends on `enabled`.
  await phase('send pass', async () => {
    out.sent = await sendPass(now);
  });
  await phase('bounded wait', async () => {
    const r = await boundedWaitPass(now);
    out.notDelivered = r.notDelivered;
    out.expiredTasks += r.expired;
  });
  await phase('pickup deadline', () => {
    out.expiredTasks += repo.expireTasksPastPickupDeadline(now.toISOString(), notRunResult(REASON_HOST_OFFLINE));
  });
  await phase('finished', async () => {
    out.finished = await finishedPass(now);
  });
  await phase('SMTP check', () => dailySmtpCheck(now));
  return out;
}

let inFlight: Promise<ProcessNoticesResult> | null = null;

/**
 * One notice pass per scheduler tick: send pending notices, bounded wait,
 * pickup deadline, Finished email, daily SMTP check. A call made while a pass
 * is still running (a slow SMTP server can outlast the 60s tick) shares that
 * pass instead of starting a second one, so the Finished email can't be sent
 * twice.
 */
export function processNotices(now?: Date): Promise<ProcessNoticesResult> {
  if (inFlight) return inFlight;
  inFlight = runPass(now ?? new Date()).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * Whether `scope` may see `n`. Org callers see only their org's notices; a
 * notice with no org (created before notices were per org) belongs to no org
 * and is visible only in legacy single-org mode.
 */
function inScope(n: Pick<NoticeRow, 'org_id'>, scope: NoticeScope): boolean {
  return scope.kind === 'all' || n.org_id === scope.orgId;
}

/**
 * Release a pending notice without email: records who/why/when and releases
 * its tasks now (lead 0), with the pickup deadline and window end computed as
 * if it had been sent now. A notice outside `scope` is "not found" (its
 * existence is not revealed).
 */
export function releaseWithoutNotice(
  id: string,
  userId: string,
  reason: string,
  scope: NoticeScope,
  now: Date = new Date(),
): NoticeRow {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) throw new AppError('A reason is required to release without notice', 400);

  const n = repo.getNotice(id);
  if (!n || !inScope(n, scope)) throw new AppError('Notice not found', 404);
  if (n.state !== 'pending') throw new AppError(`Notice is ${n.state}, not pending`, 400);

  const settings = noticeSettings(n).getPreExecutionNoticeSettings();
  const times = releaseTimesFor(n, now, { ...settings, lead_minutes: 0 }, maxExecutionTimeoutSec(repo.getLinkedTasks(id)));
  const nowIso = now.toISOString();
  const applied = repo.overrideNotice(id, {
    by: userId,
    reason: why,
    at: nowIso,
    releaseAt: nowIso,
    pickupDeadline: times.pickupDeadline.toISOString(),
    windowEnd: times.windowEnd.toISOString(),
  });
  // Lost a race with a sender or the bounded wait.
  if (!applied) throw new AppError('Notice is no longer pending', 400);
  return repo.getNotice(id)!;
}

export interface NoticeStatus {
  pendingOverdue: number;
  notDeliveredLast7d: number;
  smtpCheck: { ok: boolean | null; at: string | null; message: string | null };
  /** Latest advance digest per org in scope, last 7 days. Always present. */
  digests: Array<{
    orgId: string;
    digestDate: string;
    runDate: string;
    state: DigestState;
    occurrenceCount: number;
    hostCount: number;
    recipientCount: number;
    sentAt: string | null;
    lastError: string | null;
  }>;
}

const DIGEST_LOOKBACK_DAYS = 7;

function recipientCountOf(json: string | null): number {
  if (!json) return 0;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Banner counts for the notices in `scope`, and the SMTP check of the
 * scope's settings (the org's own section, else legacy).
 */
export function getNoticeStatus(scope: NoticeScope, now: Date = new Date()): NoticeStatus {
  const s = settingsFor(scope.kind === 'org' ? scope.orgId : null).getPreExecutionNoticeSettings();
  const sinceDate = new Date(now.getTime() - DIGEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    digests: latestDigests(scope, sinceDate).map((d) => ({
      orgId: d.org_id,
      digestDate: d.digest_date,
      runDate: d.run_date,
      state: d.state,
      occurrenceCount: d.occurrence_count,
      hostCount: d.host_count,
      recipientCount: recipientCountOf(d.recipients),
      sentAt: d.sent_at,
      lastError: d.last_error,
    })),
    // Existing notices still matter after notices are turned off.
    pendingOverdue: repo.countPendingCreatedBefore(new Date(now.getTime() - PENDING_OVERDUE_MS).toISOString(), scope),
    notDeliveredLast7d: repo.countNotDeliveredSince(new Date(now.getTime() - NOT_DELIVERED_LOOKBACK_MS).toISOString(), scope),
    // The daily check only runs while enabled, so a stale failure would
    // otherwise keep the banner up forever after disabling.
    smtpCheck: s.enabled
      ? {
          ok: s.last_smtp_check_ok ?? null,
          at: s.last_smtp_check_at ?? null,
          message: s.last_smtp_check_message ?? null,
        }
      : { ok: null, at: null, message: null },
  };
}
