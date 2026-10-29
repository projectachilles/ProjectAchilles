// Sophos posture pass + queries. Read-only GETs only.
//
//  - Health Check      /account-health-check/v1/health-check, /scores/historical  -> doc_type 'health_check'
//  - Endpoint health   /endpoint/v1/endpoints?view=full                           -> doc_type 'endpoint_health'
//  - Policies          threat-protection + server-threat-protection (+ settings)  -> doc_type 'policy'
//  - Exclusions        /settings/exclusions/scanning                              -> doc_type 'exclusion'
//  - Allowed items     /settings/allowed-items                                    -> doc_type 'allowed_item'
//
// Everything lives in the one achilles-sophos index (doc_type discriminator).
// The per-endpoint tamper-protection route returns the tamper PASSWORD and is
// never called; tamper state comes from tamperProtectionEnabled on the list.
// The score is ours: the Achilles average of Sophos Health Check scores.

import type { Client } from '@elastic/elasticsearch';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';
import type { SophosClient } from './sophos-client.js';
import { ensureSophosIndex, SOPHOS_INDEX } from './index-management.js';
import {
  computeHealthSnapshot, categoriesFromHistoryPoint, dailyLastHeadline, headlineOf,
  type SophosHealthSnapshot,
} from './health-score.js';
import { achillesTestPaths, normalizeOs, pathExclusionCovers, type TestOs } from '../sentinelone/posture.service.js';
import { attackSimulationExclusions } from '../analytics/attack-simulation-filter.js';
import { windowRange } from '../analytics/integration-window.js';
import type { TimeWindow } from '../analytics/integration-window.js';
import { TestsSettingsService } from '../tests/settings.js';

export const POSTURE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_ENDPOINTS = 50_000;
const ENDPOINT_PAGE_SIZE = 5_000;
const MAX_POLICIES = 200;
const HISTORY_DAYS = 30;
const BULK_CHUNK = 500;
const DAY_MS = 86_400_000;
const POLICY_TYPES = ['threat-protection', 'server-threat-protection'] as const;

/** Protection-relevant policy settings (spec 7.7), matched on the key after `endpoint.[server-]threat-protection.`. */
export const PROTECTION_SETTING_KEYS = [
  'malware-protection.deep-learning.enabled',
  'malware-protection.on-access.enabled',
  'malware-protection.live-protection.enabled',
  'malware-protection.behavioral-detection.enabled',
  'malware-protection.amsi-protection.enabled',
  'malware-protection.hips-detection.enabled',
  'exploit-mitigation.cryptoguard.enabled',
  'exploit-mitigation.all-mitigations.enabled',
  'exploit-mitigation.process-protection.credential-theft-protection.enabled',
  'network-protection.ips.enabled',
  // Sophos' "adaptive attack protection" is exposed as active adversary mitigation.
  'block-active-adversary-mitigation.enabled',
] as const;
const SETTING_PREFIX = /^endpoint\.(?:server-)?threat-protection\./;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const dateOrUndef = (v: unknown): string | undefined => (typeof v === 'string' && v && Number.isFinite(Date.parse(v)) ? v : undefined);
const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export type PostureClient = Pick<
  SophosClient,
  'healthCheck' | 'healthHistory' | 'listEndpoints' | 'paginateKey' | 'listPolicies' | 'getPolicySettings' | 'listScanningExclusions' | 'listAllowedItems'
>;

export interface SophosPosturePassResult {
  healthCheck: boolean;
  historyImported: number;
  endpoints: number;
  policies: number;
  exclusions: number;
  allowedItems: number;
  errors: string[];
}

export interface SophosEndpointHealth {
  total: number;
  notSeen7d: number;
  outOfDate: number;
  tamperOff: number;
  isolated: number;
  healthBad: number;
  healthSuspicious: number;
  xdrInstalled: number;
}

export interface SophosPolicyRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  appliesTo: string[];
  deviations: Array<{ key: string; value: unknown; recommended: unknown }>;
}

export interface SophosExclusionGapReport {
  critical: Array<{ kind: 'certificate_allow' | 'folder_exclusion' | 'agent_process_exclusion'; value: string; detail: string }>;
  gaps: Array<{ testUuid: string; hostname: string; path: string; exclusion: string; lastRunAt: string }>;
  notes: string[];
}

export interface ActiveAchillesCert { subjectCn: string; sha256: string | null }

/** The active Achilles signing cert (subject CN + SHA-256), or null when none is active. */
export function resolveActiveAchillesCert(): ActiveAchillesCert | null {
  try {
    const { certificates, activeCertId } = new TestsSettingsService().listCertificates();
    const active = certificates.find((c) => c.id === activeCertId && c.exists);
    const cn = active?.subject?.commonName;
    if (!active || !cn) return null;
    return { subjectCn: cn, sha256: active.fingerprint ?? null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Settings that differ from Sophos' recommendedValue, protection-relevant keys only. */
export function policyDeviations(settings: unknown): SophosPolicyRow['deviations'] {
  const out: SophosPolicyRow['deviations'] = [];
  for (const [fullKey, v] of Object.entries(obj(settings))) {
    if (!SETTING_PREFIX.test(fullKey)) continue;
    const key = fullKey.replace(SETTING_PREFIX, '');
    if (!(PROTECTION_SETTING_KEYS as readonly string[]).includes(key)) continue;
    const s = obj(v);
    if (!('recommendedValue' in s) || JSON.stringify(s.value) === JSON.stringify(s.recommendedValue)) continue;
    out.push({ key, value: s.value, recommended: s.recommendedValue });
  }
  return out;
}

function toEndpointDoc(e: Raw, now: number): { id: string; doc: Raw } | null {
  const id = str(e.id);
  if (!id) return null;
  const os = obj(e.os);
  const lastSeen = dateOrUndef(e.lastSeenAt);
  const overall = str(obj(e.health).overall);
  const protectionStatus = str(obj(obj(e.packages).protection).status);
  const products = Array.isArray(e.assignedProducts) ? (e.assignedProducts as unknown[]) : [];
  return {
    id: `endpoint-${id}`,
    doc: {
      endpoint_id: id,
      endpoint: {
        endpoint_id: id,
        hostname: str(e.hostname)?.toUpperCase(),
        os_platform: str(os.platform),
        is_server: typeof os.isServer === 'boolean' ? os.isServer : undefined,
        health: overall,
        protection_status: protectionStatus,
        last_seen_at: lastSeen,
        // Derived flags so the counts are plain term filters at read time.
        not_seen_7d: lastSeen ? now - Date.parse(lastSeen) > 7 * DAY_MS : true,
        out_of_date: protectionStatus === 'upgradable',
        // Only a definite "off" on a tamper-capable endpoint counts.
        tamper_off: e.tamperProtectionEnabled === false && e.tamperProtectionSupported !== false,
        isolated: str(obj(e.isolation).status) === 'isolated',
        health_bad: overall === 'bad',
        health_suspicious: overall === 'suspicious',
        xdr_installed: products.some((p) => obj(p).code === 'xdr'),
      },
    },
  };
}

function flattenAppliesTo(a: unknown): string[] {
  const out: string[] = [];
  const visit = (o: unknown) => {
    for (const [k, v] of Object.entries(obj(o))) {
      if (Array.isArray(v)) out.push(`${k}:${v.length}`);
      else if (typeof v === 'string') out.push(`${k}:${v}`);
      else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(a);
  return out;
}

const normalizeHash = (s: string): string => s.replace(/[:\s]/g, '').toLowerCase();

/** Does a Sophos certificateSigner allowed item trust the active Achilles signing cert? */
export function certificateAllowMatches(item: { value?: string; sha256?: string }, cert: ActiveAchillesCert): boolean {
  const cn = cert.subjectCn.trim().toLowerCase();
  const value = (item.value ?? '').trim().toLowerCase();
  if (cn && value) {
    if (value === cn) return true;
    const m = /(?:^|,\s*)cn=([^,]+)/.exec(value); // "CN=..., O=..." distinguished-name form
    if (m && m[1].trim() === cn) return true;
  }
  if (cert.sha256) {
    const want = normalizeHash(cert.sha256);
    for (const c of [item.sha256, item.value]) if (c && normalizeHash(c) === want) return true;
  }
  return false;
}

const isFolderLike = (v: string): boolean => /[\\/]$/.test(v.trim()) || /[\\/]\*+$/.test(v.trim());
const basename = (v: string): string => v.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? '';

/** Which OS a stored exclusion/allowed item can apply to. */
function osesOf(type: string, value: string): TestOs[] {
  if (type === 'path') return ['windows'];
  if (type === 'posixPath') return ['linux', 'macos'];
  return value.trim().startsWith('/') ? ['linux', 'macos'] : ['windows'];
}

/** An exclusion/allow as a pathExclusionCovers input, or null when it can't describe a path. */
function asPathRule(type: string, value: string): { value: string; path_exclusion_type: string } | null {
  if (!['path', 'posixPath', 'process', 'amsi', 'behavioral', 'detectedExploit'].includes(type)) return null;
  const v = value.trim();
  if (!v) return null;
  if (!/[\\/]/.test(v) && !v.includes('*')) {
    // A bare process/file name matches that name anywhere.
    return { value: `*${v.startsWith('/') ? '/' : '\\'}${v}`, path_exclusion_type: 'file' };
  }
  return { value: v, path_exclusion_type: isFolderLike(v) ? 'subfolders' : 'file' };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SophosPostureService {
  constructor(private readonly es: Client, private readonly client: PostureClient) {}

  async runPosturePass(): Promise<SophosPosturePassResult> {
    const result: SophosPosturePassResult = { healthCheck: false, historyImported: 0, endpoints: 0, policies: 0, exclusions: 0, allowedItems: 0, errors: [] };
    try {
      await ensureSophosIndex();
    } catch (err) {
      result.errors.push(`index: ${describe(err)}`);
      return result;
    }
    const startedAt = Date.now();
    const snapshotId = new Date(startedAt).toISOString();

    // Health Check (time series, not replaced)
    try {
      const snap = computeHealthSnapshot(await this.client.healthCheck());
      await this.es.index({
        index: SOPHOS_INDEX,
        id: `hc-${snapshotId.slice(0, 13).replace('T', '-')}`,
        document: { doc_type: 'health_check', snapshot_id: snapshotId, timestamp: snapshotId, source: 'sophos_live', health: snap },
        refresh: 'wait_for',
      });
      result.healthCheck = true;
    } catch (err) {
      result.errors.push(`health_check: ${describe(err)}`);
    }

    // One-time history backfill so the trend isn't empty
    try {
      if (!(await this.hasHistory())) result.historyImported = await this.importHistory();
    } catch (err) {
      result.errors.push(`history: ${describe(err)}`);
    }

    // Endpoint health
    try {
      const docs: Array<{ id: string; doc: Raw }> = [];
      for await (const page of this.client.paginateKey((key) => this.client.listEndpoints({ pageFromKey: key }))) {
        for (const e of page) {
          const d = toEndpointDoc(obj(e), startedAt);
          if (d) docs.push(d);
        }
        if (docs.length >= MAX_ENDPOINTS) break;
      }
      docs.length = Math.min(docs.length, MAX_ENDPOINTS);
      await this.replaceSnapshot('endpoint_health', snapshotId, docs);
      result.endpoints = docs.length;
    } catch (err) {
      result.errors.push(`endpoints: ${describe(err)}`);
    }

    // Policies
    try {
      const docs = await this.fetchPolicies(result.errors);
      await this.replaceSnapshot('policy', snapshotId, docs);
      result.policies = docs.length;
    } catch (err) {
      result.errors.push(`policies: ${describe(err)}`);
    }

    // Scanning exclusions
    try {
      const docs = (await this.client.listScanningExclusions()).flatMap((x) => {
        const o = obj(x);
        const id = str(o.id);
        const value = typeof o.value === 'string' ? o.value : undefined;
        if (!id || value === undefined) return [];
        return [{ id: `exclusion-${id}`, doc: { exclusion: { exclusion_id: id, type: str(o.type) ?? 'unknown', value, scan_mode: str(o.scanMode), locked: o.lockedByManagingAccount === true } } }];
      });
      await this.replaceSnapshot('exclusion', snapshotId, docs);
      result.exclusions = docs.length;
    } catch (err) {
      result.errors.push(`exclusions: ${describe(err)}`);
    }

    // Allowed items
    try {
      const docs = (await this.client.listAllowedItems()).flatMap((x) => {
        const o = obj(x);
        const id = str(o.id);
        const type = str(o.type);
        if (!id || !type) return [];
        const props = obj(o.properties);
        const value = str(props[type]) ?? str(props.path) ?? str(props.fileName) ?? str(props.sha256);
        return [{ id: `allowed-${id}`, doc: { allowed_item: { item_id: id, type, value, sha256: str(props.sha256), file_name: str(props.fileName), path: str(props.path) } } }];
      });
      await this.replaceSnapshot('allowed_item', snapshotId, docs);
      result.allowedItems = docs.length;
    } catch (err) {
      result.errors.push(`allowed_items: ${describe(err)}`);
    }

    return result;
  }

  private async hasHistory(): Promise<boolean> {
    const res = await this.es.search({
      index: SOPHOS_INDEX,
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: [{ term: { doc_type: 'health_check' } }, { term: { source: 'sophos_history' } }] } },
    }).catch(() => null);
    const total = res?.hits.total;
    return (typeof total === 'number' ? total : total?.value ?? 0) > 0;
  }

  /** Import 30 days of /scores/historical as daily points, skipping days that have a live snapshot. */
  async importHistory(): Promise<number> {
    const end = new Date();
    const start = new Date(end.getTime() - HISTORY_DAYS * DAY_MS);
    // Plain dates only: Sophos answers HTTP 400 to any timestamp, even midnight.
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const raw = obj(await this.client.healthHistory({ startDate: day(start), endDate: day(end) }));
    const points = Array.isArray(raw.datapoints) ? raw.datapoints : [];

    const live = await this.es.search({
      index: SOPHOS_INDEX,
      size: 10_000,
      query: { bool: {
        filter: [{ term: { doc_type: 'health_check' } }, { range: { timestamp: { gte: start.toISOString() } } }],
        must_not: [{ term: { source: 'sophos_history' } }],
      } },
      _source: ['timestamp'],
    });
    const liveDays = new Set(
      (live.hits.hits as Array<{ _source?: { timestamp?: string } }>)
        .map((h) => h._source?.timestamp)
        .filter((t): t is string => !!t && Number.isFinite(Date.parse(t)))
        .map((t) => new Date(t).toISOString().slice(0, 10)),
    );

    const operations: Raw[] = [];
    let imported = 0;
    for (const p of points) {
      const date = str(obj(p).date)?.slice(0, 10);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || liveDays.has(date)) continue;
      const categories = categoriesFromHistoryPoint(p);
      const headline = headlineOf(categories);
      if (headline === null) continue;
      const timestamp = `${date}T12:00:00.000Z`;
      operations.push(
        { index: { _index: SOPHOS_INDEX, _id: `hc-${date}-hist` } },
        { doc_type: 'health_check', source: 'sophos_history', timestamp, health: { headline, categories, items: { notFullyProtected: [], notOnRecommended: [], riskyExclusions: [], tamperDisabled: [] } } },
      );
      imported++;
    }
    if (operations.length) {
      const res = await this.es.bulk({ operations, refresh: 'wait_for' });
      if (res.errors) throw new Error('bulk history import failed');
    }
    return imported;
  }

  private async fetchPolicies(errors: string[]): Promise<Array<{ id: string; doc: Raw }>> {
    const docs: Array<{ id: string; doc: Raw }> = [];
    let settingsFailures = 0;
    for (const type of POLICY_TYPES) {
      for (const p of await this.client.listPolicies(type)) {
        if (docs.length >= MAX_POLICIES) break;
        const po = obj(p);
        const id = str(po.id);
        if (!id) continue;
        let deviations: SophosPolicyRow['deviations'] = [];
        let settingsError: string | undefined;
        try {
          deviations = policyDeviations(await this.client.getPolicySettings(id));
        } catch (err) {
          settingsFailures++;
          settingsError = describe(err).slice(0, 200);
        }
        docs.push({
          id: `policy-${id}`,
          doc: { policy: { policy_id: id, name: str(po.name) ?? id, type: str(po.type) ?? type, enabled: po.enabled !== false, applies_to: flattenAppliesTo(po.appliesTo), deviations, ...(settingsError ? { settings_error: settingsError } : {}) } },
        });
      }
    }
    if (settingsFailures) errors.push(`policies: settings unreadable for ${settingsFailures} policy(ies)`);
    return docs;
  }

  /** Index the new docs, then drop that doc type's docs from earlier snapshots. */
  private async replaceSnapshot(docType: string, snapshotId: string, docs: Array<{ id: string; doc: Raw }>): Promise<void> {
    for (let i = 0; i < docs.length; i += BULK_CHUNK) {
      const res = await this.es.bulk({
        operations: docs.slice(i, i + BULK_CHUNK).flatMap(({ id, doc }) => [
          { index: { _index: SOPHOS_INDEX, _id: id } },
          { ...doc, doc_type: docType, snapshot_id: snapshotId, timestamp: snapshotId },
        ]),
        refresh: 'wait_for',
      });
      if (res.errors) {
        const first = res.items.find((it) => it.index?.error)?.index?.error;
        throw new Error(`bulk ${docType}: ${first?.reason ?? 'error'}`);
      }
    }
    await this.es.deleteByQuery({
      index: SOPHOS_INDEX,
      refresh: true,
      conflicts: 'proceed',
      query: { bool: { filter: [{ term: { doc_type: docType } }], must_not: [{ term: { snapshot_id: snapshotId } }] } },
    });
  }

  // -------------------------------------------------------------------------
  // Queries (analytics routes)
  // -------------------------------------------------------------------------

  async getHealthCheck(days = 30): Promise<{ latest: SophosHealthSnapshot | null; trend: Array<{ date: string; score: number }> }> {
    const res = await this.es.search({
      index: SOPHOS_INDEX,
      size: 10_000,
      query: { bool: { filter: [{ term: { doc_type: 'health_check' } }, { range: { timestamp: { gte: `now-${days}d` } } }] } },
      sort: [{ timestamp: 'asc' }],
      _source: ['timestamp', 'source', 'health'],
    }).catch(missingIndex);
    const hits = hitsOf(res);
    const live = hits.filter((h) => h.source !== 'sophos_history');
    const last = live[live.length - 1];
    const h = obj(last?.health);
    const latest: SophosHealthSnapshot | null = last
      ? {
          headline: typeof h.headline === 'number' ? h.headline : null,
          categories: (Array.isArray(h.categories) ? h.categories : []) as SophosHealthSnapshot['categories'],
          items: { notFullyProtected: [], notOnRecommended: [], riskyExclusions: [], tamperDisabled: [], ...obj(h.items) } as SophosHealthSnapshot['items'],
        }
      : null;
    return { latest, trend: dailyLastHeadline(hits.map((s) => ({ _source: s as { timestamp?: string; health?: { headline?: number | null } } }))) };
  }

  async getEndpointHealth(): Promise<SophosEndpointHealth> {
    const flag = (name: string) => ({ term: { [`endpoint.${name}`]: true } });
    const res = await this.es.search({
      index: SOPHOS_INDEX,
      size: 0,
      track_total_hits: true,
      query: { term: { doc_type: 'endpoint_health' } },
      aggs: {
        flags: {
          filters: { filters: {
            notSeen7d: flag('not_seen_7d'), outOfDate: flag('out_of_date'), tamperOff: flag('tamper_off'), isolated: flag('isolated'),
            healthBad: flag('health_bad'), healthSuspicious: flag('health_suspicious'), xdrInstalled: flag('xdr_installed'),
          } },
        },
      },
    }).catch(missingIndex) as { hits?: { total?: number | { value: number } }; aggregations?: { flags?: { buckets?: Record<string, { doc_count: number }> } } };
    const total = res.hits?.total;
    const b = res.aggregations?.flags?.buckets ?? {};
    const n = (k: string) => b[k]?.doc_count ?? 0;
    return {
      total: typeof total === 'number' ? total : total?.value ?? 0,
      notSeen7d: n('notSeen7d'), outOfDate: n('outOfDate'), tamperOff: n('tamperOff'), isolated: n('isolated'),
      healthBad: n('healthBad'), healthSuspicious: n('healthSuspicious'), xdrInstalled: n('xdrInstalled'),
    };
  }

  async getPolicies(): Promise<SophosPolicyRow[]> {
    const res = await this.es.search({ index: SOPHOS_INDEX, size: 1000, query: { term: { doc_type: 'policy' } }, _source: ['policy'] }).catch(missingIndex);
    return hitsOf(res).flatMap((h) => {
      const p = obj(h.policy);
      const id = str(p.policy_id);
      if (!id) return [];
      return [{
        id, name: str(p.name) ?? id, type: str(p.type) ?? 'unknown', enabled: p.enabled !== false,
        appliesTo: Array.isArray(p.applies_to) ? (p.applies_to as string[]) : [],
        deviations: (Array.isArray(p.deviations) ? p.deviations : []) as SophosPolicyRow['deviations'],
      }];
    });
  }

  private async loadDocs(docType: string, field: string): Promise<Raw[]> {
    const res = await this.es.search({ index: SOPHOS_INDEX, size: 10_000, query: { term: { doc_type: docType } }, _source: [field] }).catch(missingIndex);
    return hitsOf(res).map((h) => obj(h[field]));
  }

  /** Hostname (upper-cased) -> OS of every stored Sophos endpoint, paged with search_after. */
  private async loadEndpointOsByHostname(): Promise<Map<string, TestOs | undefined>> {
    const hosts = new Map<string, TestOs | undefined>();
    let searchAfter: unknown[] | undefined;
    for (let loaded = 0; loaded < MAX_ENDPOINTS;) {
      const res = await this.es.search({
        index: SOPHOS_INDEX,
        size: ENDPOINT_PAGE_SIZE,
        query: { term: { doc_type: 'endpoint_health' } },
        _source: ['endpoint.hostname', 'endpoint.os_platform'],
        sort: [{ endpoint_id: 'asc' }],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      }).catch(missingIndex);
      const page = (res.hits.hits ?? []) as Array<{ _source?: Raw; sort?: unknown[] }>;
      for (const h of page) {
        const e = obj(h._source?.endpoint);
        const name = str(e.hostname);
        if (name) hosts.set(name.toUpperCase(), normalizeOs(str(e.os_platform)));
      }
      loaded += page.length;
      if (page.length < ENDPOINT_PAGE_SIZE) break;
      searchAfter = page[page.length - 1].sort;
      if (!searchAfter) break;
    }
    return hosts;
  }

  /**
   * Exclusion / allow-list gaps:
   *  - critical: a certificateSigner allow matching the active Achilles signing cert
   *  - critical: a folder exclusion covering C:\F0 / /opt/f0, or a process exclusion of the agent
   *  - gaps: unprotected (exit 101, no Sophos detection) runs on Sophos-managed hosts whose binary
   *    path is covered by an exclusion or a path allowed item
   */
  async getExclusionGaps(resultsIndexPattern: string, window: TimeWindow | null, activeCert: ActiveAchillesCert | null): Promise<SophosExclusionGapReport> {
    const report: SophosExclusionGapReport = { critical: [], gaps: [], notes: [] };
    const exclusions = (await this.loadDocs('exclusion', 'exclusion'))
      .map((x) => ({ type: str(x.type) ?? 'unknown', value: typeof x.value === 'string' ? x.value : '' }))
      .filter((x) => x.value);
    const allowed = (await this.loadDocs('allowed_item', 'allowed_item'))
      .map((x) => ({ type: str(x.type) ?? 'unknown', value: str(x.value), sha256: str(x.sha256) }));

    // 2. certificate allow
    if (!activeCert) {
      report.notes.push('cert_unavailable');
    } else {
      for (const a of allowed) {
        if (a.type === 'certificateSigner' && certificateAllowMatches(a, activeCert)) {
          report.critical.push({
            kind: 'certificate_allow',
            value: a.value ?? activeCert.subjectCn,
            detail: 'This certificate allow trusts the Achilles signing certificate, so Sophos will not inspect every Achilles test.',
          });
        }
      }
    }

    // 3. folder / agent-process exclusions
    const probes: Array<[TestOs, string]> = [['windows', 'c:\\f0\\tasks\\task-0\\probe.exe'], ['linux', '/opt/f0/tasks/task-0/probe']];
    for (const x of exclusions) {
      if ((x.type === 'path' || x.type === 'posixPath') && isFolderLike(x.value)) {
        const rule = asPathRule(x.type, x.value);
        if (rule && osesOf(x.type, x.value).some((os) => probes.some(([po, p]) => po === (os === 'macos' ? 'linux' : os) && pathExclusionCovers(rule, p, po)))) {
          report.critical.push({ kind: 'folder_exclusion', value: x.value, detail: 'This exclusion covers the Achilles working folder, so Sophos will not scan any Achilles test or the agent.' });
          continue;
        }
      }
      if (['process', 'path', 'posixPath'].includes(x.type) && basename(x.value).startsWith('achilles-agent')) {
        report.critical.push({ kind: 'agent_process_exclusion', value: x.value, detail: 'This exclusion names the Achilles agent, so Sophos will not monitor it.' });
      }
    }

    // 1. unprotected runs under an exclusion
    const rules = [
      ...exclusions.map((x) => ({ value: x.value, rule: asPathRule(x.type, x.value), oses: osesOf(x.type, x.value) })),
      ...allowed.filter((a) => a.type === 'path' || a.type === 'posixPath').map((a) => ({ value: a.value ?? '', rule: asPathRule(a.type, a.value ?? ''), oses: osesOf(a.type, a.value ?? '') })),
    ].filter((r): r is { value: string; rule: NonNullable<ReturnType<typeof asPathRule>>; oses: TestOs[] } => r.rule !== null);
    if (rules.length === 0) return report;

    const hosts = await this.loadEndpointOsByHostname();
    const range = windowRange('routing.event_time', window);
    const filter: QueryDslQueryContainer[] = [{ term: { 'event.ERROR': 101 } }];
    if (range) filter.push(range);
    const res = await this.es.search({
      index: resultsIndexPattern,
      size: 2000,
      query: { bool: { filter, must_not: [{ term: { 'f0rtika.sophos_detected': true } }, ...attackSimulationExclusions()] } },
      sort: [{ 'routing.event_time': { order: 'desc', unmapped_type: 'date' } }],
      _source: ['routing.hostname', 'routing.event_time', 'f0rtika.test_uuid', 'f0rtika.bundle_id'],
    }).catch(missingIndex);

    const seen = new Set<string>();
    for (const r of hitsOf(res)) {
      const routing = obj(r.routing);
      const f = obj(r.f0rtika);
      const host = (str(routing.hostname) ?? '').toUpperCase();
      const testUuid = str(f.test_uuid) ?? '';
      const bundleUuid = (str(f.bundle_id) ?? testUuid).split('::')[0];
      const key = `${bundleUuid}|${host}`;
      if (!bundleUuid || !host || seen.has(key) || !hosts.has(host)) continue;
      seen.add(key);
      const os = hosts.get(host);
      if (!os) continue;
      const paths = achillesTestPaths(os, bundleUuid);
      const hit = rules.find((x) => x.oses.includes(os) && paths.some((p) => pathExclusionCovers(x.rule, p, os)));
      if (!hit) continue;
      report.gaps.push({ testUuid, hostname: host, path: paths[0], exclusion: hit.value, lastRunAt: str(routing.event_time) ?? '' });
    }
    return report;
  }
}

function hitsOf(res: unknown): Raw[] {
  const hits = ((res as { hits?: { hits?: Array<{ _source?: Raw }> } })?.hits?.hits ?? []);
  return hits.map((h) => h._source).filter((s): s is Raw => !!s);
}

/** A missing index (posture never ran) reads as empty. */
function missingIndex(err: unknown): { hits: { hits: [] } } {
  if ((err as { meta?: { statusCode?: number } })?.meta?.statusCode === 404) return { hits: { hits: [] } };
  throw err;
}
