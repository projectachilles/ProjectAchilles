// The test version a task carries (payload.test_version), validated. One rule
// for every reader: ingestion writes it to Elasticsearch, the campaign
// evidence matrix shows it. Pure: no database, no Elasticsearch.
import type { TaskTestVersion } from '../../types/testVersion.js';

const VERSION_TEXT_MAX = 128;
// The ISO 8601 date-time shapes the server writes: toISOString()
// (`2026-11-23T10:00:00.000Z`) and git's %cI (`2026-11-23T10:00:00-04:00`).
// Elasticsearch's strict_date_optional_time rejects much of what Date.parse
// takes (`2026-11-23 10:00:00`, `Nov 23 2026`, 30 February, hour 24), and a
// rejected date field loses the whole result document.
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The date as the document stores it: the same instant as toISOString()
 * writes it (UTC, milliseconds, `Z`), or undefined when it is not a valid
 * ISO 8601 date-time. Normalising, rather than bounding the offset, means
 * Elasticsearch only ever sees one form: a commit date with an offset Java
 * can't hold (beyond ±18:00, e.g. a mistyped GIT_COMMITTER_DATE) is stored
 * as its UTC instant instead of failing the whole document. A date whose UTC
 * year falls outside 0001-9999 is refused.
 */
function canonicalDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = ISO_DATE_TIME.exec(v);
  if (!m) return undefined;
  const [year, month, day, hour] = [m[1], m[2], m[3], m[4]].map(Number);
  // Date.parse rolls 30 February over to March and takes 24:00; ES does not.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23) return undefined;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return undefined;
  const utc = new Date(ms);
  const utcYear = utc.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) return undefined;
  return utc.toISOString();
}
const isShortString = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && v.length <= VERSION_TEXT_MAX;

/**
 * A task's `payload.test_version`, validated: undefined when it is not an
 * object or `built_at` is not a valid date (created before versions, or
 * malformed); otherwise `built_at` plus whichever of `build_source`, `commit`,
 * `commit_date` and `fingerprint` are valid. Dates come back in UTC
 * (canonicalDate).
 */
export function validTestVersion(raw: unknown): Partial<TaskTestVersion> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Partial<Record<keyof TaskTestVersion, unknown>>;
  const builtAt = canonicalDate(v.built_at);
  if (!builtAt) return undefined;
  const out: Partial<TaskTestVersion> = { built_at: builtAt };
  if (v.build_source === 'built' || v.build_source === 'uploaded') out.build_source = v.build_source;
  if (isShortString(v.commit)) out.commit = v.commit;
  const commitDate = canonicalDate(v.commit_date);
  if (commitDate) out.commit_date = commitDate;
  if (isShortString(v.fingerprint)) out.fingerprint = v.fingerprint;
  return out;
}
