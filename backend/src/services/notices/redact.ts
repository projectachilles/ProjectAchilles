import type { NoticeStatus } from './notices.service.js';
import type { NoticeSummary } from './types.js';

/*
 * The notice routes are readable with `endpoints:tasks:read` (analysts,
 * read-scope API keys), but recipient addresses and raw SMTP text belong to
 * whoever can read the notice settings (`integrations:read`). These helpers
 * strip both for everyone else, keeping counts and states so the UI and the
 * banner still work.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A delivery error without addresses or server text: a recipient count or a generic line. */
export function redactDeliveryError(error: string | null): string | null {
  if (!error) return error;
  const m = /^(rejected|not accepted): (.+)$/.exec(error);
  if (m) return `${plural(m[2].split(', ').length, 'recipient')} ${m[1]}`;
  if (error === 'no recipients accepted') return error;
  return 'delivery failed';
}

export function redactNoticeStatus(status: NoticeStatus): NoticeStatus {
  return {
    ...status,
    digests: status.digests.map((d) => ({ ...d, lastError: redactDeliveryError(d.lastError) })),
    smtpCheck: {
      ...status.smtpCheck,
      message: status.smtpCheck.ok === false ? 'SMTP check failed' : null,
    },
  };
}

/** A GET /api/notices row without its recipient list. */
export function redactNoticeListItem<T extends { recipients?: unknown; last_error: string | null }>(
  row: T,
): Omit<T, 'recipients'> {
  const { recipients: _recipients, ...rest } = row;
  return { ...rest, last_error: redactDeliveryError(row.last_error) };
}

/** A grouped task list's notice map with each `last_error` redacted. */
export function redactNoticeSummaries(notices: Record<string, NoticeSummary>): Record<string, NoticeSummary> {
  return Object.fromEntries(
    Object.entries(notices).map(([id, n]) => [id, { ...n, last_error: redactDeliveryError(n.last_error) }]),
  );
}
