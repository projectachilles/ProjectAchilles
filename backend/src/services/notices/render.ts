import type { NoticeKind } from './types.js';
import type { TaskResult, TaskStatus } from '../../types/agent.js';
import { formatClock, formatDual } from './window.js';

export const MAX_INLINE_HOSTS = 50;

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface NoticeEmailData {
  kind: NoticeKind;
  runTag: string;
  timezone: string;
  trigger: string;
  startNotBefore: Date;
  pickupDeadline: Date;
  windowEnd: Date;
  dayWindow?: { start: Date; end: Date };
  /** `stages`: display text, e.g. "3", "52 controls", "bundle" or "—". */
  tests: Array<{ name: string; uuid: string; stages: string; techniques: string[]; tactics: string[] }>;
  hosts: Array<{ hostname: string; os: string; online: boolean }>;
  edr: Array<{ vendor: string; autoResolve: 'disabled' | 'dry_run' | 'enabled' }>;
  uiUrl: string;
}

export interface FinishedEmailData {
  runTag: string;
  timezone: string;
  startedAt: Date;
  finishedAt: Date;
  /** Same labels as Analytics: prevented and detected come from EDR correlation. */
  counts: { protected: number; prevented: number; detected: number; unprotected: number; error: number; notRun: number };
  /** Elasticsearch could not be reached, so the counts use exit codes only. */
  edrUnavailable?: boolean;
  /** Runs counted as Protected because the EDR killed the agent mid-run, and the verdict's reason naming the vendor(s). */
  edrTerminated?: { runs: number; reason: string };
  uiUrl: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#18181b;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:600;">ProjectAchilles | f0_csv</td></tr>
${body}
<tr><td style="padding:16px 24px;background-color:#fafafa;color:#71717a;font-size:12px;">Automated message from ProjectAchilles continuous security validation.</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 0;color:#71717a;font-size:13px;width:150px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;color:#18181b;font-size:13px;">${value}</td></tr>`;
}

function section(heading: string, inner: string): string {
  return `<tr><td style="padding:12px 24px;"><div style="font-size:14px;font-weight:600;color:#18181b;margin-bottom:6px;">${escapeHtml(heading)}</div>${inner}</td></tr>`;
}

const TH = 'padding:6px 8px;border-bottom:1px solid #18181b;font-size:11px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;';

function headerRow(cols: Array<[label: string, align?: 'center']>): string {
  return `<tr>${cols.map(([label, align]) => `<th style="${TH}text-align:${align ?? 'left'};">${escapeHtml(label)}</th>`).join('')}</tr>`;
}

function edrText(e: NoticeEmailData['edr'][number]): string {
  const v = escapeHtml(e.vendor);
  switch (e.autoResolve) {
    case 'enabled':
      return `${v}: alerts raised by these tests will be auto-resolved as security testing.`;
    case 'dry_run':
      return `${v}: auto-resolve is in dry-run mode; alerts are logged but not resolved, so expect them in your queue.`;
    default:
      return `${v}: auto-resolve is disabled; alerts raised by these tests will appear in your queue.`;
  }
}

export type TestRowData = NoticeEmailData['tests'][number];
export type HostRowData = NoticeEmailData['hosts'][number];

export function testsTable(tests: TestRowData[]): string {
  const td = 'padding:6px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top;';
  const testRows = tests
    .map(
      (t) =>
        `<tr data-row="test"><td style="${td}font-size:13px;color:#18181b;">${escapeHtml(t.name)}<div style="font-family:Menlo,Consolas,monospace;font-size:11px;color:#71717a;margin-top:2px;">${escapeHtml(t.uuid)}</div></td><td style="${td}font-size:13px;color:#18181b;text-align:center;white-space:nowrap;">${escapeHtml(t.stages)}</td><td style="${td}font-size:12px;color:#52525b;">${escapeHtml([...t.techniques, ...t.tactics].join(', '))}</td></tr>`,
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0">${headerRow([['Test'], ['Stages', 'center'], ['Techniques & tactics']])}${testRows}</table>`;
}

export function hostsTable(hosts: HostRowData[], offlineNote: (h: HostRowData) => string): string {
  const shown = hosts.slice(0, MAX_INLINE_HOSTS);
  const hostRows = shown
    .map((h) => {
      const status = h.online ? 'online' : offlineNote(h);
      return `<tr data-row="host"><td style="padding:4px 8px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#18181b;">${escapeHtml(h.hostname)}</td><td style="padding:4px 8px;border-bottom:1px solid #e4e4e7;font-size:12px;color:#52525b;">${escapeHtml(h.os)}</td><td style="padding:4px 8px;border-bottom:1px solid #e4e4e7;font-size:12px;color:#52525b;">${escapeHtml(status)}</td></tr>`;
    })
    .join('');
  const more =
    hosts.length > MAX_INLINE_HOSTS
      ? `<div style="font-size:12px;color:#52525b;margin-top:6px;">and ${hosts.length - MAX_INLINE_HOSTS} more (see attached CSV)</div>`
      : '';
  return `<table width="100%" cellpadding="0" cellspacing="0">${headerRow([['Host'], ['OS'], ['Status']])}${hostRows}</table>${more}`;
}

export function buildNoticeEmail(d: NoticeEmailData): { subject: string; html: string } {
  const n = plural(d.tests.length, 'test', 'tests');
  const m = plural(d.hosts.length, 'host', 'hosts');
  const subject =
    d.kind === 'day' && d.dayWindow
      ? `[ProjectAchilles] Security testing today ${formatClock(d.dayWindow.start, d.timezone)}–${formatClock(d.dayWindow.end, d.timezone)} ${d.timezone} — ${n} on ${m}`
      : `[ProjectAchilles] Security testing starts ${formatDual(d.startNotBefore, d.timezone)} — ${n} on ${m}`;

  const when: string[] = [];
  when.push(row('Reference', `<strong>${escapeHtml(d.runTag)}</strong>`));
  when.push(row('Trigger', escapeHtml(d.trigger)));
  if (d.kind === 'day' && d.dayWindow) {
    when.push(row('Testing window', `${escapeHtml(formatDual(d.dayWindow.start, d.timezone))} to ${escapeHtml(formatDual(d.dayWindow.end, d.timezone))}`));
  }
  when.push(row('Starts no earlier than', escapeHtml(formatDual(d.startNotBefore, d.timezone))));
  when.push(row('Hosts pick up until', escapeHtml(formatDual(d.pickupDeadline, d.timezone))));
  when.push(row('All activity ends by', escapeHtml(formatDual(d.windowEnd, d.timezone))));

  // What a SOC analyst can actually search for: the run tag never reaches the
  // hosts, but every test binary is named after its test UUID and runs from
  // the agent's task folder (agent config work_dir, these are the defaults).
  const example = d.tests.find((t) => t.uuid)?.uuid;
  const p = 'font-size:13px;color:#18181b;margin:0 0 6px;';
  const finding = section(
    'Finding this activity in your security tools',
    `<p style="${p}">On the hosts above, between ${escapeHtml(formatDual(d.startNotBefore, d.timezone))} and ${escapeHtml(formatDual(d.windowEnd, d.timezone))}, the tests run from <code>C:\\F0\\tasks</code> (Windows) or <code>/opt/f0/tasks</code> (Linux, macOS). ` +
      `Their files and processes are named after the test UUIDs listed above${example ? `, for example <code>${escapeHtml(example)}.exe</code>, or <code>${escapeHtml(example)}-T1105.exe</code> for a stage` : ''}.</p>` +
      `<p style="${p}color:#52525b;">${escapeHtml(d.runTag)} identifies this run in ProjectAchilles only; it does not appear on the hosts.</p>`,
  );

  const edr = d.edr.length
    ? section(
        'Security tooling',
        d.edr.map((e) => `<div style="font-size:13px;color:#18181b;margin-bottom:4px;">${edrText(e)}</div>`).join(''),
      )
    : '';

  const body = [
    `<tr><td style="padding:20px 24px 4px;font-size:16px;font-weight:600;color:#18181b;">Security testing is about to begin</td></tr>`,
    `<tr><td style="padding:0 24px;"><table width="100%" cellpadding="0" cellspacing="0">${when.join('')}</table></td></tr>`,
    section(`Tests (${d.tests.length})`, testsTable(d.tests)),
    section(`Hosts (${d.hosts.length})`, hostsTable(d.hosts, () => `offline: will run if it reconnects before ${formatDual(d.pickupDeadline, d.timezone)}`)),
    finding,
    edr,
    `<tr><td style="padding:12px 24px 20px;"><a href="${escapeHtml(d.uiUrl)}" style="color:#2563eb;font-size:13px;">Open ProjectAchilles</a></td></tr>`,
  ].join('\n');

  return { subject, html: shell(subject, body) };
}

export interface DigestEmailData {
  runDate: string;
  digestTz: string;
  uiUrl: string;
  entries: Array<{
    scheduleName: string;
    mode: 'fixed' | 'fleet' | 'per_machine';
    timezone: string;
    start: Date;
    end: Date;
    test: TestRowData;
    hosts: HostRowData[];
  }>;
}

function modeLine(e: DigestEmailData['entries'][number]): string {
  const start = formatDual(e.start, e.timezone);
  const end = formatDual(e.end, e.timezone);
  const window = `Hosts can start the test between ${start} and ${end}.`;
  switch (e.mode) {
    case 'per_machine':
      return `Each host at its own random time. ${window}`;
    case 'fleet':
      return `All hosts together at one random time. ${window}`;
    default:
      return `All hosts together. ${window}`;
  }
}

export function buildDigestEmail(d: DigestEmailData): { subject: string; html: string } {
  const weekday = new Date(`${d.runDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const testCount = new Set(d.entries.map((e) => e.test.uuid)).size;
  const hostCount = new Set(d.entries.flatMap((e) => e.hosts.map((h) => h.hostname))).size;
  const subject = `[ProjectAchilles] Security testing scheduled tomorrow, ${weekday} ${d.runDate} — ${plural(testCount, 'test', 'tests')} on ${plural(hostCount, 'host', 'hosts')}`;

  const p = 'font-size:13px;color:#18181b;margin:0 0 6px;';
  const sections = d.entries.map((e) =>
    section(
      e.scheduleName,
      `<p style="${p}color:#52525b;">${escapeHtml(modeLine(e))}</p>${testsTable([e.test])}<div style="height:8px;"></div>${hostsTable(e.hosts, () => 'offline: runs only if it reconnects in time')}`,
    ),
  );

  const example = d.entries.find((e) => e.test.uuid)?.test.uuid;
  const finding = section(
    'Finding this activity in your security tools',
    `<p style="${p}">On the hosts above, during the windows shown, the tests run from <code>C:\\F0\\tasks</code> (Windows) or <code>/opt/f0/tasks</code> (Linux, macOS). ` +
      `Their files and processes are named after the test UUIDs listed above${example ? `, for example <code>${escapeHtml(example)}.exe</code>, or <code>${escapeHtml(example)}-T1105.exe</code> for a stage` : ''}.</p>`,
  );

  const body = [
    `<tr><td style="padding:20px 24px 4px;font-size:16px;font-weight:600;color:#18181b;">Security testing is scheduled for tomorrow</td></tr>`,
    `<tr><td style="padding:0 24px;"><p style="${p}">This is an advance heads-up. Each run is announced again by the usual pre-execution notice a few minutes before it starts. The times shown are when hosts can start a test; a test started near the end may still be running after it. If the mail server is slow on the day, both times move later. Schedules may still change; the notice sent on the day is authoritative.</p></td></tr>`,
    ...sections,
    finding,
    `<tr><td style="padding:12px 24px 20px;"><a href="${escapeHtml(d.uiUrl)}" style="color:#2563eb;font-size:13px;">Open schedules</a></td></tr>`,
  ].join('\n');

  return { subject, html: shell(subject, body) };
}

export function buildFinishedEmail(d: FinishedEmailData): { subject: string; html: string } {
  const subject = `[ProjectAchilles] Security testing finished — ${d.runTag}`;
  const c = d.counts;
  const cells = (
    [
      ['Protected', c.protected],
      ['Prevented', c.prevented],
      ['Detected', c.detected],
      ['Unprotected', c.unprotected],
      ['Error', c.error],
      ['Not run', c.notRun],
    ] as const
  )
    .map(
      ([label, n]) =>
        `<td align="center" width="16%" style="padding:10px 4px;border:1px solid #e4e4e7;"><div style="font-size:22px;font-weight:600;color:#18181b;">${n}</div><div style="font-size:12px;color:#71717a;">${label}</div></td>`,
    )
    .join('');
  const body = [
    `<tr><td style="padding:20px 24px 4px;font-size:16px;font-weight:600;color:#18181b;">Security testing has finished</td></tr>`,
    `<tr><td style="padding:0 24px;"><table width="100%" cellpadding="0" cellspacing="0">${row('Reference', `<strong>${escapeHtml(d.runTag)}</strong>`)}${row('Started', escapeHtml(formatDual(d.startedAt, d.timezone)))}${row('Finished', escapeHtml(formatDual(d.finishedAt, d.timezone)))}</table></td></tr>`,
    `<tr><td style="padding:12px 24px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`,
    `<tr><td style="padding:0 24px;font-size:12px;color:#71717a;">${
      d.edrUnavailable
        ? 'EDR results were unavailable, so these counts use test exit codes only.'
        : 'Prevented and Detected come from your EDR alerts, as in Analytics.'
    }</td></tr>`,
    ...(d.edrTerminated
      ? [`<tr><td style="padding:4px 24px 0;font-size:12px;color:#71717a;">${escapeHtml(`${d.edrTerminated.reason} ${plural(d.edrTerminated.runs, 'run', 'runs')} counted as Protected.`)}</td></tr>`]
      : []),
    `<tr><td style="padding:12px 24px 20px;"><a href="${escapeHtml(d.uiUrl)}" style="color:#2563eb;font-size:13px;">Open ProjectAchilles</a></td></tr>`,
  ].join('\n');
  return { subject, html: shell(subject, body) };
}

export function classifyOutcome(task: {
  status: TaskStatus;
  result: TaskResult | null;
}): 'protected' | 'unprotected' | 'error' | 'notRun' {
  if (task.status !== 'completed') return 'notRun';
  const code = task.result?.exit_code;
  if (code === 101) return 'unprotected';
  if (code === 105 || code === 126 || code === 127) return 'protected';
  return 'error';
}

/** A cell starting with one of these is run as a formula by spreadsheet apps. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(raw: string): string {
  // Hostnames come from agents; never let one become a spreadsheet formula.
  const s = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildHostsCsv(hosts: Array<{ hostname: string; os: string; online: boolean }>): string {
  const lines = ['hostname,os,online', ...hosts.map((h) => [csvCell(h.hostname), csvCell(h.os), String(h.online)].join(','))];
  return lines.join('\r\n') + '\r\n';
}
