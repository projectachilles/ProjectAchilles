// Pure normalization of the three Sophos sources into one alert document shape
// shared with the other endpoint EDRs. Tolerant of unknown / absent fields:
// nothing here throws on a payload that differs from the published spec.
//
// PROVISIONAL: field choices are derived from the published Sophos specs
// (spec_common-v1, siemschemas, det.graphql, spec_detections-v1) until the
// PoC capture (Task 14) replaces the fixtures.

export interface SophosAlertDoc {
  doc_type: 'alert';
  source_type: 'alert' | 'siem_event' | 'xdr_detection';
  timestamp: string | null;
  alert_id: string;
  alert_title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational' | 'unknown';
  severity_raw: string | number | null;
  status: string;
  category: string;
  service_source: 'Sophos';
  mitre_techniques: string[];
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  recommended_actions: string[];
  evidence_hostnames: string[];
  evidence_filenames: string[];
  evidence_filepaths: string[];
  prevention_action?: 'quarantined' | 'process_killed' | 'blocked' | 'kill_failed';
  portal_url?: string;
  sophos_type?: string;
  origin?: string;
  sha256?: string;
  endpoint_id?: string;
  /** SIEM `threat`: documented as a threat correlation id, not the detection name. */
  threat_id?: string;
  event_ids?: string[];
  allowed_actions?: string[];
  merged_siem_event_ids?: string[];
}

type Severity = SophosAlertDoc['severity'];
type Prevention = SophosAlertDoc['prevention_action'];
type Obj = Record<string, unknown>;

/** Only Sophos' own response within this long of detection counts as prevention. */
export const SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS = 15 * 60 * 1000;
/** Max gap between a Common Alert's raisedAt and its SIEM event's `when` (provisional join rule). */
const JOIN_WINDOW_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------- helpers

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/**
 * ISO string, or null. Accepts ISO text (a zone-less one, like Common Alerts'
 * raisedAt, is UTC), a GraphQL `Timestamp { seconds, nanos }` object, or a
 * numeric epoch in seconds.
 */
function toIso(v: unknown): string | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const t = v as Obj;
    const sec = Number(t.seconds);
    if (t.seconds === undefined || t.seconds === null || t.seconds === '' || !Number.isFinite(sec)) return null;
    const nanos = Number(t.nanos);
    return msToIso(sec * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1e6) : 0));
  }
  if (typeof v === 'number') return Number.isFinite(v) ? msToIso(v * 1000) : null;
  const s = str(v).trim();
  if (!s) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) || !/T/.test(s);
  return msToIso(Date.parse(hasZone ? s : `${s}Z`));
}

function msToIso(ms: number): string | null {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Upper-case short host name (everything before the first '.'). */
export function normalizeHost(raw: string): string {
  return (raw ?? '').trim().split('.')[0].toUpperCase();
}

function hosts(...raw: unknown[]): string[] {
  return Array.from(new Set(raw.map((r) => normalizeHost(str(r))).filter(Boolean)));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean)));
}

/** Lower-cased unique paths and the bare file names derived from them. */
function pathEvidence(paths: string[], extraNames: string[] = []): { filepaths: string[]; filenames: string[] } {
  const filepaths = uniq(paths);
  return { filepaths, filenames: uniq([...filepaths.map(basename), ...extraNames]) };
}

/**
 * Paths in a Common Alert description. Provisional: `... at '<path>'` /
 * `'<threat>' at '<path>'`, plus the unquoted form the spec's own example uses
 * (`Generic reputation PUA detected C:\Temp\WinExeSvc.exe`). Only values with
 * a path separator count, so a bare `'svchost.exe'` never lands in filepaths.
 */
function pathsFromText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/at '([^']+)'/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?<![\w'])([A-Za-z]:\\[^\s'"]+)/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?<![\w'])(\/(?:opt|home|usr|var|tmp|etc|root|srv|mnt|Library|Applications|Users|private)\/[^\s'"]+)/g)) out.push(m[1]);
  return out.map((p) => p.replace(/[.,;:)\]]+$/, '')).filter((p) => /[\\/]/.test(p));
}

/** Windows / POSIX absolute paths in single quotes (v1 `processedData`, SIEM names). */
function quotedAbsolutePaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/'((?:[A-Za-z]:\\|\\\\|\/)[^']+)'/g)) out.push(m[1]);
  return out;
}

function techniqueIds(values: unknown[]): string[] {
  const ids = values.map((v) => str(v).trim().toUpperCase()).filter((v) => /^T\d{4}(?:\.\d{3})?$/.test(v));
  return Array.from(new Set(ids));
}

function sha256Of(v: unknown): string | undefined {
  const s = str(v).trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(s) ? s : undefined;
}

function token(v: unknown): string {
  return str(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function baseDoc(): Omit<SophosAlertDoc, 'source_type' | 'timestamp' | 'alert_id'> {
  return {
    doc_type: 'alert',
    alert_title: '',
    description: '',
    severity: 'unknown',
    severity_raw: null,
    status: '',
    category: '',
    service_source: 'Sophos',
    mitre_techniques: [],
    created_at: null,
    updated_at: null,
    resolved_at: null,
    recommended_actions: [],
    evidence_hostnames: [],
    evidence_filenames: [],
    evidence_filepaths: [],
  };
}

function nonOpen(status: string): boolean {
  return !!status && status !== 'open' && status !== 'new';
}

// ---------------------------------------------------------------- severity

function commonSeverity(raw: unknown): Severity {
  switch (token(raw)) {
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    case 'none': return 'informational';
    default: return 'unknown';
  }
}

function siemSeverity(raw: unknown): Severity {
  switch (token(raw)) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    case 'none': return 'informational';
    default: return 'unknown';
  }
}

function bucket(n: number, cut: [number, number, number, number]): Severity {
  if (n >= cut[0]) return 'critical';
  if (n >= cut[1]) return 'high';
  if (n >= cut[2]) return 'medium';
  if (n >= cut[3]) return 'low';
  return 'informational';
}

// ---------------------------------------------------------------- Common Alert

export function transformAlert(a: unknown): SophosAlertDoc {
  const o = obj(a);
  const agent = obj(o.managedAgent);
  const description = str(o.description);
  const status = token(o.status);
  const created = toIso(o.raisedAt);
  const updated = toIso(o.updatedAt) ?? created;
  const ev = pathEvidence(pathsFromText(description));
  const allowed = arr(o.allowedActions).map(str).filter(Boolean);
  const sevRaw = typeof o.severity === 'string' ? o.severity : null;
  return {
    ...baseDoc(),
    source_type: 'alert',
    timestamp: updated ?? created ?? null,
    alert_id: str(o.id),
    alert_title: description.split(/\s+at '/)[0] || str(o.type) || 'Sophos alert',
    description,
    severity: commonSeverity(o.severity),
    severity_raw: sevRaw,
    status,
    category: str(o.category),
    created_at: created,
    updated_at: updated,
    resolved_at: nonOpen(status) ? updated : null,
    evidence_hostnames: hosts(agent.name),
    evidence_filenames: ev.filenames,
    evidence_filepaths: ev.filepaths,
    sophos_type: str(o.type) || undefined,
    endpoint_id: str(agent.id) || undefined,
    allowed_actions: allowed,
  };
}

// ---------------------------------------------------------------- SIEM events

/** Legacy status-update events: a cleanup outcome for an earlier detection, never a detection themselves. */
const LEGACY_CLEANUP_TYPE = /^Event::Endpoint::Threat::(?:CleanedUp|(?:Pua|HIPS)?CleanupFailed)$/;

/**
 * Detection types; everything else (health, updating, web control, dismissed
 * and cleanup status events) is noise. IPS inbound/outbound events are Core
 * detection events per the schema.
 */
function isDetectionType(type: string): boolean {
  if (type.startsWith('Event::Endpoint::Core')) return true;
  if (!type.startsWith('Event::Endpoint::Threat::')) return false;
  return !/Dismissed$/.test(type) && !LEGACY_CLEANUP_TYPE.test(type);
}

const BLOCKING_ORIGINS = new Set(['AMSI_DETECTION', 'BLOCKLISTED_BY_ADMIN', 'HMPA_DETECTION']);

function remedyItems(e: Obj): Obj[] {
  return arr(obj(e.core_remedy_items).items).map(obj);
}

/** True when a legacy cleanup event happened more than 15 min after the detection. */
function lateAfterDetection(type: string, actionAt: unknown, detectedAt: unknown): boolean {
  if (!LEGACY_CLEANUP_TYPE.test(type)) return false;
  const action = Date.parse(str(actionAt));
  const detected = Date.parse(str(detectedAt));
  if (Number.isNaN(action) || Number.isNaN(detected)) return false;
  return action - detected > SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS;
}

/**
 * The prevention action Sophos' own agent took for a SIEM event, in the shared
 * vocabulary. A Core Detection event's remedy items are the agent's automatic
 * response to that same detection (action time = `when`), so they always
 * qualify; ingest time (`created_at`) is never consulted (offline hosts upload
 * late). For a legacy cleanup event, `detectedAt` (when given) bounds it to 15
 * minutes after the detection. File remedy beats process remedy (as in
 * SentinelOne's mapping).
 */
export function siemPreventionAction(e: unknown, detectedAt?: string): Prevention {
  const o = obj(e);
  if (lateAfterDetection(str(o.type), o.when, detectedAt)) return undefined;

  const type = str(o.type);
  const items = remedyItems(o);
  const results = (kind: string) => items.filter((i) => str(i.type) === kind).map((i) => str(i.result));
  const files = results('file');
  const procs = results('process');

  if (files.some((r) => r === 'SUCCESS' || r === 'DELETED')) return 'quarantined';
  if (procs.some((r) => r === 'SUCCESS')) return 'process_killed';
  if (items.some((i) => /^FAILED_TO_DELETE/.test(str(i.result))) || /Threat::(?:Pua|HIPS)?CleanupFailed$/.test(type)) return 'kill_failed';
  // An allow-listed / vanished item: Sophos let it through or had nothing to act on.
  if (items.some((i) => ['WHITELISTED', 'NOT_FOUND'].includes(str(i.result)))) return undefined;
  if (/Threat::CleanedUp$/.test(type)) return 'blocked';
  if (items.length === 0 && BLOCKING_ORIGINS.has(str(o.origin))) return 'blocked';
  return undefined;
}

function detailValues(e: Obj, ...types: string[]): string[] {
  return arr(e.details).map(obj).filter((d) => types.includes(str(d.type))).map((d) => str(d.property)).filter(Boolean);
}

/** `threat` is a correlation id (uuid / long hex / digits) in the event schema. */
function looksLikeId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[0-9a-f]{16,}$/i.test(v) || /^\d+$/.test(v);
}

/** First quoted token of `name` (port of name_mapping.py's threat_regex group 1), else `threat` unless it is an id. */
function detectionName(o: Obj): string {
  const m = /'([^']+)'/.exec(str(o.name));
  if (m) return m[1];
  const threat = str(o.threat).trim();
  return threat && !looksLikeId(threat) ? threat : '';
}

function siemPaths(o: Obj): string[] {
  const name = str(o.name);
  const items = remedyItems(o);
  const amsi = obj(o.amsi_threat_data);
  const ips = obj(o.ips_threat_data);
  return [
    ...detailValues(o, 'CORE_APPLICATION_PATH', 'CORE_BEHAVIORAL_PATH', 'HMPA_PROCESS_PATH', 'AMSI_PROCESS_PATH', 'IPS_EXECUTABLE_PATH'),
    str(amsi.processPath),
    str(ips.executablePath),
    ...items.filter((i) => str(i.type) === 'file').map((i) => str(i.descriptor)),
    ...items.map((i) => str(i.processPath)),
    ...pathsFromText(name),
    ...quotedAbsolutePaths(name),
  ].filter((p) => /[\\/]/.test(p));
}

function siemSha(o: Obj): string | undefined {
  return sha256Of(o.appSha256) ?? sha256Of(detailValues(o, 'CORE_APPLICATION_SHA_256')[0]);
}

export function transformSiemEvent(e: unknown): SophosAlertDoc | null {
  const o = obj(e);
  const type = str(o.type);
  if (!isDetectionType(type) || !str(o.id)) return null;

  const name = str(o.name);
  const when = toIso(o.when);
  const amsi = obj(o.amsi_threat_data);
  const ips = obj(o.ips_threat_data);
  const ev = pathEvidence(siemPaths(o), [
    ...detailValues(o, 'AMSI_PROCESS_NAME', 'IPS_EXECUTABLE_NAME'),
    str(amsi.processName),
    str(ips.executableName),
  ]);
  const prevention = siemPreventionAction(o);
  return {
    ...baseDoc(),
    source_type: 'siem_event',
    timestamp: when ?? toIso(o.created_at) ?? null,
    alert_id: str(o.id),
    alert_title: detectionName(o) || name || type,
    description: name,
    severity: siemSeverity(o.severity),
    severity_raw: typeof o.severity === 'string' ? o.severity : null,
    status: '',
    category: str(o.group),
    created_at: when,
    updated_at: toIso(o.created_at) ?? when,
    evidence_hostnames: hosts(o.location),
    evidence_filenames: ev.filenames,
    evidence_filepaths: ev.filepaths,
    ...(prevention ? { prevention_action: prevention } : {}),
    sophos_type: type,
    origin: str(o.origin) || undefined,
    sha256: siemSha(o),
    endpoint_id: str(o.endpoint_id) || undefined,
    threat_id: str(o.threat) || undefined,
  };
}

// ---------------------------------------------------------------- legacy cleanup events

/** Minimal shape of a legacy Threat::CleanedUp / CleanupFailed status event, to be merged into a detection. */
export interface SophosLegacyCleanup {
  kind: 'legacy_cleanup';
  id: string;
  host: string;
  name: string;
  sha256?: string;
  when: string | null;
  prevention_action?: SophosAlertDoc['prevention_action'];
  filenames: string[];
  filepaths: string[];
}

export function parseLegacyCleanup(e: unknown): SophosLegacyCleanup | null {
  const o = obj(e);
  if (!LEGACY_CLEANUP_TYPE.test(str(o.type))) return null;
  const ev = pathEvidence(siemPaths(o));
  return {
    kind: 'legacy_cleanup',
    id: str(o.id),
    host: normalizeHost(str(o.location)),
    name: detectionName(o),
    sha256: siemSha(o),
    when: toIso(o.when),
    prevention_action: siemPreventionAction(o),
    filenames: ev.filenames,
    filepaths: ev.filepaths,
  };
}

// ---------------------------------------------------------------- XDR detections

/**
 * Provisional entity prefixes (`<type>:<value>`): the schema documents the
 * format but not the type vocabulary.
 */
const HOST_ENTITY = /^(?:hostname|host|device|computer|endpoint)$/i;
const PATH_ENTITY = /^(?:file|filepath|file_path|path|process|process_path|image|binary)$/i;

export function transformGraphqlDetection(d: unknown): SophosAlertDoc {
  const o = obj(d);
  const meta = obj(o.metadata);
  const sevRaw = typeof meta.severity === 'number' && Number.isFinite(meta.severity) ? meta.severity : null;
  const status = token(o.status);
  const created = toIso(meta.created_at) ?? toIso(meta.first_seen_at);
  const updated = toIso(meta.updated_at) ?? created;

  const entities = arr(obj(o.entities).entities).map(str);
  const hostVals: string[] = [];
  const pathVals: string[] = [];
  let sha: string | undefined;
  for (const ent of entities) {
    const i = ent.indexOf(':');
    if (i < 1) continue;
    const kind = ent.slice(0, i);
    const value = ent.slice(i + 1);
    if (HOST_ENTITY.test(kind)) hostVals.push(value);
    else if (PATH_ENTITY.test(kind) && /[\\/]/.test(value)) pathVals.push(value);
    else if (/^sha256$/i.test(kind)) sha = sha ?? sha256Of(value);
  }
  const ev = pathEvidence(pathVals);
  const enrichment = arr(o.enrichment_details).map((x) => obj(obj(x).mitre_attack_info).technique_id);
  return {
    ...baseDoc(),
    source_type: 'xdr_detection',
    timestamp: updated ?? null,
    alert_id: str(o.id),
    alert_title: str(meta.title) || str(meta.full_title) || 'Sophos XDR detection',
    description: str(meta.description),
    severity: sevRaw === null ? 'unknown' : bucket(sevRaw, [0.8, 0.6, 0.4, 0.2]),
    severity_raw: sevRaw,
    status,
    mitre_techniques: techniqueIds([...arr(o.attack_technique_ids), ...enrichment]),
    created_at: created,
    updated_at: updated,
    resolved_at: nonOpen(status) ? updated : null,
    evidence_hostnames: hosts(...hostVals),
    evidence_filenames: ev.filenames,
    evidence_filepaths: ev.filepaths,
    sha256: sha,
    event_ids: arr(o.event_ids).map((x) => str(obj(x).id)).filter(Boolean),
  };
}

export function transformV1Detection(d: unknown): SophosAlertDoc {
  const o = obj(d);
  const sevRaw = typeof o.severity === 'number' && Number.isFinite(o.severity) ? o.severity : null;
  const time = toIso(o.time);
  const techniques = arr(o.mitreAttacks).flatMap((m) => arr(obj(obj(m).tactic).techniques).map((t) => obj(t).id));
  const ev = pathEvidence(quotedAbsolutePaths(str(o.processedData)));
  return {
    ...baseDoc(),
    source_type: 'xdr_detection',
    timestamp: time ?? null,
    alert_id: str(o.id),
    alert_title: str(o.detectionRule) || 'Sophos XDR detection',
    description: str(o.ruleDescription) || str(o.processedData),
    severity: sevRaw === null ? 'unknown' : bucket(sevRaw, [8, 6, 4, 2]),
    severity_raw: sevRaw,
    status: '',
    category: str(o.detectionAttack),
    mitre_techniques: techniqueIds(techniques),
    created_at: time,
    updated_at: time,
    evidence_hostnames: hosts(obj(o.device).entity),
    evidence_filenames: ev.filenames,
    evidence_filepaths: ev.filepaths,
    sophos_type: str(o.type) || undefined,
  };
}

// ---------------------------------------------------------------- join + merge

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** Exact token match: the name quoted, or delimited by non-name characters (so `ML/PE-A` never matches `ML/PE-AB`). */
function nameInText(name: string, text: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return new RegExp(`(?<![\\w/.-])${escapeRegExp(n)}(?![\\w/-])`, 'i').test(text);
}

/** Stage binaries differ per stage: when both sides name files, they must share one. */
function filesCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((f) => b.includes(f));
}

function sameThreat(name: string, sha: string | undefined, target: SophosAlertDoc): boolean {
  return nameInText(name, `${target.alert_title} ${target.description}`) || (!!sha && sha === target.sha256);
}

/**
 * PROVISIONAL join rule between a SIEM Core detection event and a Common Alert:
 * same normalized host, a shared evidence file name (when both carry one), the
 * same threat (exact name token in the alert text, or same SHA-256) and the
 * alert's raisedAt within 2 minutes of the event's `when`.
 */
export function siemEventMatchesAlert(event: SophosAlertDoc, alert: SophosAlertDoc): boolean {
  if (!event.evidence_hostnames.some((h) => alert.evidence_hostnames.includes(h))) return false;
  if (!filesCompatible(event.evidence_filenames, alert.evidence_filenames)) return false;
  if (!sameThreat(event.alert_title, event.sha256, alert)) return false;
  const a = Date.parse(alert.created_at ?? '');
  const e = Date.parse(event.created_at ?? '');
  if (Number.isNaN(a) || Number.isNaN(e)) return false;
  return Math.abs(a - e) <= JOIN_WINDOW_MS;
}

/**
 * A legacy cleanup status event belongs to a detection when it is on the same
 * host, names the same threat (exact token / SHA-256), shares a file name when
 * both carry one, and happened within [target.created_at - 2 min, +15 min] (Central can raise the alert after the endpoint event and its cleanup). Outside
 * that window it never matches, so it can never add prevention.
 */
export function legacyCleanupMatches(event: SophosLegacyCleanup, target: SophosAlertDoc): boolean {
  if (!event.host || !target.evidence_hostnames.includes(event.host)) return false;
  if (!filesCompatible(event.filenames, target.evidence_filenames)) return false;
  if (!sameThreat(event.name, event.sha256, target)) return false;
  const at = Date.parse(event.when ?? '');
  const detected = Date.parse(target.created_at ?? '');
  if (Number.isNaN(at) || Number.isNaN(detected)) return false;
  return at - detected >= -JOIN_WINDOW_MS && at - detected <= SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS;
}

const PREVENTION_RANK: Record<NonNullable<Prevention>, number> = { quarantined: 4, process_killed: 3, blocked: 2, kill_failed: 1 };

/** Order-independent: a success never loses to kill_failed. */
function bestPrevention(a: Prevention, b: Prevention): Prevention {
  if (!a) return b;
  if (!b) return a;
  return PREVENTION_RANK[b] > PREVENTION_RANK[a] ? b : a;
}

function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

/**
 * The alert keeps its identity; the SIEM event (or a matching legacy cleanup
 * event; a non-matching one is ignored) adds evidence, prevention and Core
 * Detection fields. origin / sha256 keep the first non-empty value.
 */
export function mergeSiemIntoAlert(alert: SophosAlertDoc, event: SophosAlertDoc | SophosLegacyCleanup): SophosAlertDoc {
  let evidence: SophosAlertDoc;
  let eventId: string;
  if ('kind' in event) {
    if (!legacyCleanupMatches(event, alert)) return alert;
    eventId = event.id;
    evidence = {
      ...alert,
      prevention_action: event.prevention_action,
      mitre_techniques: [],
      evidence_hostnames: [],
      evidence_filenames: event.filenames,
      evidence_filepaths: event.filepaths,
      origin: undefined,
      sha256: event.sha256,
      endpoint_id: undefined,
    };
  } else {
    evidence = event;
    eventId = event.alert_id;
  }
  const merged: SophosAlertDoc = {
    ...alert,
    mitre_techniques: union(alert.mitre_techniques, evidence.mitre_techniques),
    evidence_hostnames: union(alert.evidence_hostnames, evidence.evidence_hostnames),
    evidence_filenames: union(alert.evidence_filenames, evidence.evidence_filenames),
    evidence_filepaths: union(alert.evidence_filepaths, evidence.evidence_filepaths),
    origin: alert.origin || evidence.origin || undefined,
    sha256: alert.sha256 || evidence.sha256 || undefined,
    endpoint_id: alert.endpoint_id || evidence.endpoint_id || undefined,
    merged_siem_event_ids: union(alert.merged_siem_event_ids ?? [], eventId ? [eventId] : []),
  };
  const prevention = bestPrevention(alert.prevention_action, evidence.prevention_action);
  if (prevention) merged.prevention_action = prevention;
  else delete merged.prevention_action;
  return merged;
}
