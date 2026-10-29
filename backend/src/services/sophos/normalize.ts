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
  timestamp: string;
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

/** ISO string, or null. A zone-less timestamp (Common Alerts' raisedAt) is UTC. */
function toIso(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) || !/T/.test(s);
  const ms = Date.parse(hasZone ? s : `${s}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
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

/** Provisional: Common Alert descriptions read `... at '<path>'` / `'<threat>' at '<path>'`. */
function pathsFromText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/at '([^']+)'/g)) out.push(m[1]);
  return out;
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
    timestamp: updated ?? created ?? '',
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

/** Detection types; everything else (health, updating, web control...) is noise. */
function isDetectionType(type: string): boolean {
  if (type.startsWith('Event::Endpoint::Core')) return true;
  if (!type.startsWith('Event::Endpoint::Threat::')) return false;
  return !/Dismissed$/.test(type);
}

const BLOCKING_ORIGINS = new Set(['AMSI_DETECTION', 'BLOCKLISTED_BY_ADMIN', 'HMPA_DETECTION']);

function remedyItems(e: Obj): Obj[] {
  return arr(obj(e.core_remedy_items).items).map(obj);
}

const LEGACY_THREAT_PREFIX = 'Event::Endpoint::Threat::';

/** True when a separate legacy Threat event happened more than 15 min after the detection. */
function lateAfterDetection(type: string, actionAt: unknown, detectedAt: unknown): boolean {
  if (!type.startsWith(LEGACY_THREAT_PREFIX)) return false;
  const action = Date.parse(str(actionAt));
  const detected = Date.parse(str(detectedAt));
  if (Number.isNaN(action) || Number.isNaN(detected)) return false;
  return action - detected > SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS;
}

/**
 * The prevention action Sophos' own agent took for a SIEM detection event,
 * in the shared vocabulary. A Core Detection event's remedy items are the
 * agent's automatic response to that same detection (action time = `when`),
 * so they always qualify; ingest time (`created_at`) is never consulted
 * (offline hosts upload late). Legacy Threat::CleanedUp / CleanupFailed are
 * separate events: when `detectedAt` is given and their `when` is more than
 * 15 minutes later, they were a later manual / scan action and do not count.
 * When both a file and a process remedy succeeded, quarantined wins (as in
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

export function transformSiemEvent(e: unknown): SophosAlertDoc | null {
  const o = obj(e);
  const type = str(o.type);
  if (!isDetectionType(type) || !str(o.id)) return null;

  const name = str(o.name);
  const when = toIso(o.when);
  const items = remedyItems(o);
  const amsi = obj(o.amsi_threat_data);
  const ips = obj(o.ips_threat_data);
  const paths = [
    ...detailValues(o, 'CORE_APPLICATION_PATH', 'CORE_BEHAVIORAL_PATH', 'HMPA_PROCESS_PATH', 'AMSI_PROCESS_PATH', 'IPS_EXECUTABLE_PATH'),
    str(amsi.processPath),
    str(ips.executablePath),
    ...items.filter((i) => str(i.type) === 'file').map((i) => str(i.descriptor)),
    ...items.map((i) => str(i.processPath)),
    ...pathsFromText(name),
    ...quotedAbsolutePaths(name),
  ].filter((p) => /[\\/]/.test(p));
  const ev = pathEvidence(paths, [
    ...detailValues(o, 'AMSI_PROCESS_NAME', 'IPS_EXECUTABLE_NAME'),
    str(amsi.processName),
    str(ips.executableName),
  ]);
  const sha = sha256Of(o.appSha256) ?? sha256Of(detailValues(o, 'CORE_APPLICATION_SHA_256')[0]);
  const prevention = siemPreventionAction(o);
  return {
    ...baseDoc(),
    source_type: 'siem_event',
    timestamp: when ?? toIso(o.created_at) ?? '',
    alert_id: str(o.id),
    alert_title: str(o.threat) || name || type,
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
    sha256: sha,
    endpoint_id: str(o.endpoint_id) || undefined,
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
  const sevRaw = typeof meta.severity === 'number' ? meta.severity : null;
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
    timestamp: updated ?? '',
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
  const sevRaw = typeof o.severity === 'number' ? o.severity : null;
  const time = toIso(o.time);
  const techniques = arr(o.mitreAttacks).flatMap((m) => arr(obj(obj(m).tactic).techniques).map((t) => obj(t).id));
  const ev = pathEvidence(quotedAbsolutePaths(str(o.processedData)));
  return {
    ...baseDoc(),
    source_type: 'xdr_detection',
    timestamp: time ?? '',
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

/**
 * PROVISIONAL join rule between a SIEM detection event and a Common Alert:
 * same normalized host AND (event threat name appears in the alert text, or
 * same SHA-256) AND the alert's raisedAt is within 2 minutes of the event's `when`.
 */
export function siemEventMatchesAlert(event: SophosAlertDoc, alert: SophosAlertDoc): boolean {
  if (!event.evidence_hostnames.some((h) => alert.evidence_hostnames.includes(h))) return false;
  const name = event.alert_title.trim().toLowerCase();
  const text = `${alert.alert_title} ${alert.description}`.toLowerCase();
  const sameThreat = (!!name && text.includes(name)) || (!!event.sha256 && event.sha256 === alert.sha256);
  if (!sameThreat) return false;
  const a = Date.parse(alert.created_at ?? '');
  const e = Date.parse(event.created_at ?? '');
  if (Number.isNaN(a) || Number.isNaN(e)) return false;
  return Math.abs(a - e) <= JOIN_WINDOW_MS;
}

function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

/** The alert keeps its identity; the event adds evidence, prevention and Core Detection fields. */
export function mergeSiemIntoAlert(alert: SophosAlertDoc, event: SophosAlertDoc): SophosAlertDoc {
  // A legacy CleanedUp/CleanupFailed event is only Sophos' response if it
  // followed the alert's detection time closely (event.created_at holds `when`).
  const late = lateAfterDetection(event.sophos_type ?? '', event.created_at, alert.created_at);
  const prevention = (late ? undefined : event.prevention_action) ?? alert.prevention_action;
  const merged: SophosAlertDoc = {
    ...alert,
    mitre_techniques: union(alert.mitre_techniques, event.mitre_techniques),
    evidence_hostnames: union(alert.evidence_hostnames, event.evidence_hostnames),
    evidence_filenames: union(alert.evidence_filenames, event.evidence_filenames),
    evidence_filepaths: union(alert.evidence_filepaths, event.evidence_filepaths),
    origin: event.origin ?? alert.origin,
    sha256: event.sha256 ?? alert.sha256,
    endpoint_id: alert.endpoint_id ?? event.endpoint_id,
    merged_siem_event_ids: union(alert.merged_siem_event_ids ?? [], [event.alert_id]),
  };
  if (prevention) merged.prevention_action = prevention;
  return merged;
}
