// SentinelOne posture pass + queries — read-only GETs only.
//
//  - Exclusions        GET /exclusions               → doc_type 'exclusion'
//  - Policies          GET /sites, /groups, /{accounts|sites|groups}/{id}/policy → doc_type 'policy'
//  - Agent inventory   GET /agents                   → doc_type 'agent'
//  - Agent health      GET /agents/count (per filter)→ doc_type 'agent_health' (time series)
//
// Nothing here is scored. Policies are shown as plain settings; exclusions are
// matched against tests SentinelOne missed so a coverage gap caused by an
// exclusion is visible. The pass runs on its own cadence (POSTURE_INTERVAL_MS)
// after an alert poll and never throws.

import type { Client } from '@elastic/elasticsearch';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';
import { SentinelOneApiError, type SentinelOneClient } from './s1-client.js';
import { ensureSentinelOnePostureIndex, SENTINELONE_POSTURE_INDEX } from './index-management.js';
import { attackSimulationExclusions } from '../analytics/attack-simulation-filter.js';
import { windowRange } from '../analytics/integration-window.js';
import type { TimeWindow } from '../analytics/integration-window.js';
import type {
  SentinelOneAgentHealthCounts,
  SentinelOneIntegrationSettings,
  SentinelOnePosturePassResult,
} from '../../types/sentinelone.js';

export const POSTURE_INTERVAL_MS = 6 * 60 * 60 * 1000; // like Defender's score/control sync
const MAX_SITES = 100;
const MAX_GROUP_POLICIES = 200;
const MAX_AGENTS = 50_000;
const AGENT_PAGE_SIZE = 5_000;
const BULK_CHUNK = 500;

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined);
const boolOrUndef = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const firstOf = (v: unknown): string | undefined => (Array.isArray(v) ? str(v[0]) : str(v));

type PostureClient = Pick<SentinelOneClient, 'paginate' | 'listExclusions' | 'listSites' | 'listGroups' | 'getPolicy' | 'listAgents' | 'countAgents'>;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function scopeParams(settings: Pick<SentinelOneIntegrationSettings, 'scope'>): Record<string, string[] | undefined> {
  const s = settings.scope ?? {};
  return { accountIds: s.account_ids, siteIds: s.site_ids, groupIds: s.group_ids };
}

/** Policy doc fields from a raw /policy object — the settings that decide prevention. */
export function summarizePolicy(p: Raw): {
  mitigation_mode?: string;
  mitigation_mode_suspicious?: string;
  auto_mitigation_action?: string;
  anti_tampering_on?: boolean;
  snapshots_on?: boolean;
  agent_ui_on?: boolean;
  engines_on: string[];
  engines_off: string[];
} {
  const engines = (p.engines && typeof p.engines === 'object' ? p.engines : {}) as Record<string, unknown>;
  const on: string[] = [];
  const off: string[] = [];
  for (const [name, v] of Object.entries(engines)) {
    const enabled = v === true || v === 'on' || v === 'enabled';
    const disabled = v === false || v === 'off' || v === 'disabled';
    if (enabled) on.push(name);
    else if (disabled) off.push(name);
  }
  const agentUi = (p.agentUi && typeof p.agentUi === 'object' ? p.agentUi : {}) as Raw;
  return {
    mitigation_mode: str(p.mitigationMode),
    mitigation_mode_suspicious: str(p.mitigationModeSuspicious),
    auto_mitigation_action: str(p.autoMitigationAction),
    anti_tampering_on: boolOrUndef(p.antiTamperingOn),
    snapshots_on: boolOrUndef(p.snapshotsOn),
    agent_ui_on: boolOrUndef(agentUi.agentUiOn) ?? boolOrUndef(p.agentUiOn),
    engines_on: on.sort(),
    engines_off: off.sort(),
  };
}

export type TestOs = 'windows' | 'linux' | 'macos';

/**
 * Representative on-disk paths of an Achilles test binary. The agent runs each
 * task from an isolated dir under its work dir (C:\F0\tasks\task-<id>-<rand>\ on
 * Windows, /opt/f0/tasks/... elsewhere) and tests drop artefacts in C:\F0 / /opt/f0.
 */
export function achillesTestPaths(os: TestOs, bundleUuid: string): string[] {
  const id = bundleUuid.toLowerCase();
  if (os === 'windows') return [`c:\\f0\\tasks\\task-0\\${id}.exe`, `c:\\f0\\${id}.exe`];
  return [`/opt/f0/tasks/task-0/${id}`, `/opt/f0/${id}`];
}

function normalizePath(p: string, os: TestOs): string {
  let v = p.trim();
  if (os === 'windows') {
    v = v.replace(/\//g, '\\').toLowerCase().replace(/^%systemdrive%/, 'c:').replace(/^\\\\\?\\/, '');
  }
  return v.replace(/[\\/]+$/, '');
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

/**
 * Does a path exclusion cover this file? Honors the S1 path exclusion type:
 * 'file' = that file, 'folder' = files directly in the folder, 'subfolders'
 * = the folder and everything below it. Wildcards (*, ?) are honored. When
 * the type is missing, a trailing separator means a folder (with subfolders),
 * otherwise a file.
 */
export function pathExclusionCovers(
  exclusion: { value: string; path_exclusion_type?: string; os_type?: string },
  filePath: string,
  os: TestOs,
): boolean {
  if (exclusion.os_type && normalizeOs(exclusion.os_type) !== os) return false;
  const sep = os === 'windows' ? '\\' : '/';
  const looksFolder = /[\\/]$/.test(exclusion.value.trim());
  const value = normalizePath(exclusion.value, os);
  const file = normalizePath(filePath, os);
  if (!value) return false;
  const kind = (exclusion.path_exclusion_type ?? (looksFolder ? 'subfolders' : 'file')).toLowerCase();
  const dir = file.slice(0, file.lastIndexOf(sep));
  const matches = (target: string) => globToRegex(value).test(target);
  if (kind === 'file') return matches(file);
  if (kind === 'folder') return matches(dir);
  // subfolders: the folder itself or any ancestor of the file
  const parts = dir.split(sep);
  for (let i = parts.length; i > 0; i--) {
    if (matches(parts.slice(0, i).join(sep))) return true;
  }
  return false;
}

export function normalizeOs(raw: string | undefined): TestOs | undefined {
  const v = (raw ?? '').toLowerCase();
  if (v.startsWith('win')) return 'windows';
  if (v.startsWith('linux')) return 'linux';
  if (v.startsWith('mac') || v === 'osx' || v === 'darwin') return 'macos';
  return undefined;
}

export interface StoredExclusion {
  exclusion_id: string;
  exclusion_type: string;
  value: string;
  os_type?: string;
  path_exclusion_type?: string;
  exclusion_mode?: string;
  scope_name?: string;
  account_id?: string;
  site_id?: string;
  group_id?: string;
}

/** An exclusion applies to an agent when its scope is global or matches the agent's account/site/group. */
export function exclusionAppliesTo(x: StoredExclusion, agent: { account_id?: string; site_id?: string; group_id?: string }): boolean {
  if (x.group_id) return x.group_id === agent.group_id;
  if (x.site_id) return x.site_id === agent.site_id;
  if (x.account_id) return x.account_id === agent.account_id;
  return true;
}

export function toExclusionDoc(x: Raw): StoredExclusion | null {
  const id = str(x.id);
  const value = str(x.value);
  if (!id || value === undefined) return null;
  const scope = (x.scope && typeof x.scope === 'object' ? x.scope : {}) as Raw;
  return {
    exclusion_id: id,
    exclusion_type: str(x.type) ?? 'unknown',
    value,
    os_type: str(x.osType),
    path_exclusion_type: str(x.pathExclusionType),
    exclusion_mode: str(x.mode),
    scope_name: str(x.scopeName) ?? str(x.scopePath),
    account_id: str(x.accountId) ?? firstOf(scope.accountIds),
    site_id: str(x.siteId) ?? firstOf(scope.siteIds),
    group_id: str(x.groupId) ?? firstOf(scope.groupIds),
  };
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

export class SentinelOnePostureService {
  constructor(private readonly es: Client, private readonly client: PostureClient) {}

  async runPosturePass(settings: SentinelOneIntegrationSettings): Promise<SentinelOnePosturePassResult> {
    const startedAt = Date.now();
    const snapshotId = new Date(startedAt).toISOString();
    const result: SentinelOnePosturePassResult = { exclusions: 0, policies: 0, agents: 0, agentHealth: null, errors: [], durationMs: 0 };
    try {
      await ensureSentinelOnePostureIndex();
    } catch (err) {
      result.errors.push(`index: ${describe(err)}`);
      result.durationMs = Date.now() - startedAt;
      return result;
    }
    const scope = scopeParams(settings);

    // Exclusions
    try {
      const docs = await this.fetchExclusions(scope);
      await this.replaceSnapshot('exclusion', snapshotId, docs.map((d) => ({ id: `exclusion-${d.exclusion_id}`, doc: { ...d, value: d.value } })));
      result.exclusions = docs.length;
    } catch (err) {
      result.errors.push(`exclusions: ${describe(err)}`);
    }

    // Policies
    try {
      const docs = await this.fetchPolicies(settings, result.errors);
      await this.replaceSnapshot('policy', snapshotId, docs);
      result.policies = docs.length;
    } catch (err) {
      result.errors.push(`policies: ${describe(err)}`);
    }

    // Agent inventory (also the fallback source for counts)
    let inventory: Raw[] | null = null;
    try {
      inventory = [];
      for await (const page of this.client.paginate((p) => this.client.listAgents(p), { ...scope, limit: 1000 })) {
        inventory.push(...page);
        if (inventory.length >= MAX_AGENTS) break;
      }
      const docs = inventory.map((a) => toAgentDoc(a)).filter((d): d is { id: string; doc: Raw } => d !== null);
      await this.replaceSnapshot('agent', snapshotId, docs);
      result.agents = docs.length;
    } catch (err) {
      inventory = null;
      result.errors.push(`agents: ${describe(err)}`);
    }

    // Agent health counts
    try {
      let counts: SentinelOneAgentHealthCounts | null = null;
      let countsError: string | undefined;
      try {
        counts = await this.fetchAgentCounts(scope, inventory);
      } catch (err) {
        if (!(err instanceof AgentCountsUnavailableError)) throw err;
        countsError = err.short;
        result.errors.push(`agent_health: ${describe(err.cause)}`);
      }
      result.agentHealth = counts;
      await this.es.index({
        index: SENTINELONE_POSTURE_INDEX,
        document: {
          doc_type: 'agent_health', snapshot_id: snapshotId, timestamp: snapshotId,
          counts: counts ?? { total: null, active: null, infected: null, outdated: null, detect_only: null, disconnected: null },
          ...(countsError ? { counts_error: countsError } : {}),
        },
        refresh: 'wait_for',
      });
    } catch (err) {
      result.errors.push(`agent_health: ${describe(err)}`);
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  private async fetchExclusions(scope: Record<string, string[] | undefined>): Promise<StoredExclusion[]> {
    const collect = async (params: Record<string, unknown>) => {
      const out: StoredExclusion[] = [];
      for await (const page of this.client.paginate((p) => this.client.listExclusions(p), { ...params, limit: 1000 } as never)) {
        for (const x of page) {
          const d = toExclusionDoc(x as Raw);
          if (d) out.push(d);
        }
      }
      return out;
    };
    let docs: StoredExclusion[];
    try {
      // includeParents: also return account/global exclusions that apply to the scoped sites.
      docs = await collect({ ...scope, includeParents: true, includeChildren: true });
    } catch (err) {
      if (!(err instanceof SentinelOneApiError) || err.statusCode !== 400) throw err;
      docs = await collect({ ...scope });
    }
    const byId = new Map(docs.map((d) => [d.exclusion_id, d]));
    return Array.from(byId.values());
  }

  private async fetchPolicies(settings: SentinelOneIntegrationSettings, errors: string[] = []): Promise<Array<{ id: string; doc: Raw }>> {
    const scope = settings.scope ?? {};
    const out: Array<{ id: string; doc: Raw }> = [];
    // One scope the token can't read (e.g. 403 on the account policy) must not
    // hide the sites and groups it can read: record the error on that row.
    const fetchedErrors = new Map<string, string>();
    const getPolicy = async (level: 'account' | 'site' | 'group', id: string): Promise<Raw | null> => {
      try {
        return await this.client.getPolicy(level, id);
      } catch (err) {
        const status = err instanceof SentinelOneApiError ? err.statusCode : undefined;
        const short = status ? `HTTP ${status}` : 'error';
        fetchedErrors.set(`${level}-${id}`, short);
        if (errors.filter((e) => e.startsWith('policies:')).length < 5) errors.push(`policies: ${level} ${id}: ${describe(err)}`);
        return null;
      }
    };
    const push = (level: 'account' | 'site' | 'group', id: string, name: string | undefined, extra: Raw, policy: Raw | null) => {
      const policyError = fetchedErrors.get(`${level}-${id}`);
      out.push({
        id: `policy-${level}-${id}`,
        doc: {
          level,
          scope_id: id,
          scope_name: name,
          ...extra,
          ...(policy ? summarizePolicy(policy) : { engines_on: [], engines_off: [] }),
          ...(policy ? { raw: policy } : {}),
          ...(policyError ? { policy_error: policyError } : {}),
        },
      });
    };

    for (const accountId of (scope.account_ids ?? []).slice(0, 10)) {
      push('account', accountId, undefined, { account_id: accountId }, await getPolicy('account', accountId));
    }

    const sites: Raw[] = [];
    for await (const page of this.client.paginate((p) => this.client.listSites(p), { accountIds: scope.account_ids, siteIds: scope.site_ids, limit: 1000 })) {
      sites.push(...page);
      if (sites.length >= MAX_SITES) break;
    }
    const siteNames = new Map<string, string | undefined>();
    for (const s of sites.slice(0, MAX_SITES)) {
      const id = str(s.id);
      if (!id) continue;
      siteNames.set(id, str(s.name));
      push('site', id, str(s.name), { site_id: id, site_name: str(s.name), account_id: str(s.accountId) }, await getPolicy('site', id));
    }

    const siteIds = scope.site_ids?.length ? scope.site_ids : Array.from(siteNames.keys());
    if (siteIds.length === 0) return out;
    let groupPolicies = 0;
    for await (const page of this.client.paginate((p) => this.client.listGroups(p), { siteIds, groupIds: scope.group_ids, limit: 1000 })) {
      for (const g of page) {
        const id = str(g.id);
        if (!id) continue;
        const inherits = g.inherits === true;
        const siteId = str(g.siteId);
        const extra = { group_id: id, site_id: siteId, site_name: siteId ? siteNames.get(siteId) : undefined, inherits };
        // Groups that inherit use their site's policy — listed, not re-fetched.
        if (inherits || groupPolicies >= MAX_GROUP_POLICIES) {
          push('group', id, str(g.name), extra, null);
        } else {
          groupPolicies++;
          push('group', id, str(g.name), extra, await getPolicy('group', id));
        }
      }
    }
    return out;
  }

  private async fetchAgentCounts(scope: Record<string, string[] | undefined>, inventory: Raw[] | null): Promise<SentinelOneAgentHealthCounts> {
    const fromInventory = (pred: (a: Raw) => boolean) => (inventory ? inventory.filter(pred).length : null);
    const fallbacks: Record<keyof SentinelOneAgentHealthCounts, () => number | null> = {
      total: () => (inventory ? inventory.length : null),
      active: () => fromInventory((a) => a.isActive === true),
      infected: () => fromInventory((a) => a.infected === true),
      outdated: () => fromInventory((a) => a.isUpToDate === false),
      detect_only: () => fromInventory((a) => a.mitigationMode === 'detect'),
      disconnected: () => fromInventory((a) => a.networkStatus === 'disconnected'),
    };
    const filters: Record<keyof SentinelOneAgentHealthCounts, Record<string, string>> = {
      total: {},
      active: { isActive: 'true' },
      infected: { infected: 'true' },
      outdated: { isUpToDate: 'false' },
      detect_only: { mitigationMode: 'detect' },
      disconnected: { networkStatuses: 'disconnected' },
    };
    const counts = {} as SentinelOneAgentHealthCounts;
    let firstError: unknown = null;
    for (const key of Object.keys(filters) as Array<keyof SentinelOneAgentHealthCounts>) {
      try {
        counts[key] = await this.client.countAgents({ ...scope, ...filters[key] });
      } catch (err) {
        firstError ??= err;
        counts[key] = fallbacks[key]();
      }
    }
    if (firstError && Object.values(counts).every((v) => v == null)) {
      // Nothing readable: surface why instead of a row of dashes.
      throw new AgentCountsUnavailableError(firstError);
    }
    return counts;
  }

  /** Index the new docs, then drop that doc type's docs from earlier snapshots. */
  private async replaceSnapshot(docType: string, snapshotId: string, docs: Array<{ id: string; doc: Raw }>): Promise<void> {
    for (let i = 0; i < docs.length; i += BULK_CHUNK) {
      const chunk = docs.slice(i, i + BULK_CHUNK);
      const res = await this.es.bulk({
        operations: chunk.flatMap(({ id, doc }) => [
          { index: { _index: SENTINELONE_POSTURE_INDEX, _id: id } },
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
      index: SENTINELONE_POSTURE_INDEX,
      refresh: true,
      conflicts: 'proceed',
      query: { bool: { filter: [{ term: { doc_type: docType } }], must_not: [{ term: { snapshot_id: snapshotId } }] } },
    } as any);
  }

  // -------------------------------------------------------------------------
  // Queries (analytics routes)
  // -------------------------------------------------------------------------

  async getPolicies(): Promise<Raw[]> {
    const res = await this.es.search({
      index: SENTINELONE_POSTURE_INDEX,
      size: 1000,
      query: { term: { doc_type: 'policy' } },
      sort: [{ level: 'asc' }, { site_name: { order: 'asc', unmapped_type: 'keyword' } }, { scope_name: { order: 'asc', unmapped_type: 'keyword' } }],
      _source: { excludes: ['raw'] },
    } as any).catch(missingIndex);
    return hitsOf(res);
  }

  async getAgentHealth(days = 30): Promise<{ latest: Raw | null; trend: Array<{ timestamp: string; counts: SentinelOneAgentHealthCounts }> }> {
    const res = await this.es.search({
      index: SENTINELONE_POSTURE_INDEX,
      // One snapshot per posture pass (every 6 hours): size the page to the window.
      size: Math.min(Math.ceil(days * (86_400_000 / POSTURE_INTERVAL_MS)) + 8, 10_000),
      query: { bool: { filter: [{ term: { doc_type: 'agent_health' } }, { range: { timestamp: { gte: `now-${days}d` } } }] } },
      sort: [{ timestamp: 'desc' }],
    } as any).catch(missingIndex);
    const hits = hitsOf(res) as Array<{ timestamp: string; counts: SentinelOneAgentHealthCounts }>;
    return { latest: hits[0] ?? null, trend: hits.slice().reverse() };
  }

  async getLatestAgentHealth(): Promise<SentinelOneAgentHealthCounts | null> {
    const { latest } = await this.getAgentHealth(7);
    return (latest?.counts as SentinelOneAgentHealthCounts | undefined) ?? null;
  }

  async getExclusions(): Promise<StoredExclusion[]> {
    const res = await this.es.search({
      index: SENTINELONE_POSTURE_INDEX,
      size: 5000,
      query: { term: { doc_type: 'exclusion' } },
    } as any).catch(missingIndex);
    return hitsOf(res) as unknown as StoredExclusion[];
  }

  /**
   * Every stored agent (up to MAX_AGENTS), keyed by upper-cased computer
   * name. Paged with search_after: a single search stops at
   * max_result_window (10,000), which would count managed hosts in larger
   * fleets as "not S1-managed".
   */
  private async loadAgentsByHostname(): Promise<Map<string, Raw>> {
    const agents = new Map<string, Raw>();
    let searchAfter: unknown[] | undefined;
    for (let loaded = 0; loaded < MAX_AGENTS;) {
      const res = await this.es.search({
        index: SENTINELONE_POSTURE_INDEX,
        size: AGENT_PAGE_SIZE,
        query: { term: { doc_type: 'agent' } },
        _source: ['computer_name', 'os_type', 'account_id', 'site_id', 'group_id'],
        sort: [{ agent_id: 'asc' }],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      } as any).catch(missingIndex);
      const page = ((res as any)?.hits?.hits ?? []) as Array<{ _source?: Raw; sort?: unknown[] }>;
      for (const h of page) {
        const name = str(h._source?.computer_name);
        if (name && h._source) agents.set(name.toUpperCase(), h._source);
      }
      loaded += page.length;
      if (page.length < AGENT_PAGE_SIZE) break;
      searchAfter = page[page.length - 1].sort;
      if (!searchAfter) break;
    }
    return agents;
  }

  /**
   * Tests SentinelOne missed (exit 101, no S1 detection) on S1-managed hosts
   * whose on-disk path is covered by a path exclusion that applies to the host.
   */
  async getExclusionGaps(resultsIndexPattern: string, window: TimeWindow | null): Promise<ExclusionGapReport> {
    const exclusions = await this.getExclusions();
    const byType: Record<string, number> = {};
    for (const x of exclusions) byType[x.exclusion_type] = (byType[x.exclusion_type] ?? 0) + 1;
    const pathExclusions = exclusions.filter((x) => x.exclusion_type === 'path');

    const agents = await this.loadAgentsByHostname();

    const range = windowRange('routing.event_time', window);
    const must: QueryDslQueryContainer[] = [{ term: { 'event.ERROR': 101 } }];
    if (range) must.push(range);
    const resultsRes = await this.es.search({
      index: resultsIndexPattern,
      size: 2000,
      query: {
        bool: {
          filter: must,
          must_not: [{ term: { 'f0rtika.sentinelone_detected': true } }, ...attackSimulationExclusions()],
        },
      },
      sort: [{ 'routing.event_time': { order: 'desc', unmapped_type: 'date' } }],
      _source: ['routing.hostname', 'routing.event_time', 'f0rtika.test_uuid', 'f0rtika.test_name', 'f0rtika.bundle_id'],
    } as any).catch(missingIndex);

    const seen = new Set<string>();
    let missedOnS1Hosts = 0;
    let missedOnOtherHosts = 0;
    const flagged: ExclusionGapReport['flagged'] = [];
    for (const r of hitsOf(resultsRes)) {
      const routing = (r.routing ?? {}) as Raw;
      const f = (r.f0rtika ?? {}) as Raw;
      const host = (str(routing.hostname) ?? '').toUpperCase();
      const testUuid = str(f.test_uuid) ?? '';
      const bundleUuid = (str(f.bundle_id) ?? testUuid).split('::')[0];
      const key = `${bundleUuid}|${host}`;
      if (!bundleUuid || !host || seen.has(key)) continue;
      seen.add(key);
      const agent = agents.get(host);
      if (!agent) { missedOnOtherHosts++; continue; }
      missedOnS1Hosts++;
      const os = normalizeOs(str(agent.os_type));
      if (!os) continue;
      const paths = achillesTestPaths(os, bundleUuid);
      const hits = pathExclusions.filter((x) => exclusionAppliesTo(x, agent) && paths.some((p) => pathExclusionCovers(x, p, os)));
      if (hits.length === 0) continue;
      flagged.push({
        test_uuid: testUuid,
        test_name: str(f.test_name) ?? null,
        hostname: host,
        os,
        last_seen: str(routing.event_time) ?? null,
        exclusions: hits.map((x) => ({
          exclusion_id: x.exclusion_id,
          value: x.value,
          path_exclusion_type: x.path_exclusion_type ?? null,
          exclusion_mode: x.exclusion_mode ?? null,
          scope_name: x.scope_name ?? null,
        })),
      });
    }

    return {
      exclusionsTotal: exclusions.length,
      byType,
      // Hash / certificate exclusions can't be tied to a test: result docs don't record the binary hash or signer.
      unmatchable: exclusions.length - pathExclusions.length,
      s1Agents: agents.size,
      missedOnS1Hosts,
      missedOnOtherHosts,
      flagged,
    };
  }
}

export interface ExclusionGapReport {
  exclusionsTotal: number;
  byType: Record<string, number>;
  unmatchable: number;
  s1Agents: number;
  missedOnS1Hosts: number;
  missedOnOtherHosts: number;
  flagged: Array<{
    test_uuid: string;
    test_name: string | null;
    hostname: string;
    os: TestOs;
    last_seen: string | null;
    exclusions: Array<{ exclusion_id: string; value: string; path_exclusion_type: string | null; exclusion_mode: string | null; scope_name: string | null }>;
  }>;
}

function toAgentDoc(a: Raw): { id: string; doc: Raw } | null {
  const id = str(a.id);
  if (!id) return null;
  return {
    id: `agent-${id}`,
    doc: {
      agent_id: id,
      computer_name: str(a.computerName),
      os_type: str(a.osType),
      account_id: str(a.accountId),
      site_id: str(a.siteId),
      site_name: str(a.siteName),
      group_id: str(a.groupId),
      mitigation_mode: str(a.mitigationMode),
      agent_version: str(a.agentVersion),
      is_active: boolOrUndef(a.isActive),
      infected: boolOrUndef(a.infected),
      is_up_to_date: boolOrUndef(a.isUpToDate),
      network_status: str(a.networkStatus),
    },
  };
}

function hitsOf(res: unknown): Raw[] {
  const hits = ((res as any)?.hits?.hits ?? []) as any[];
  return hits.map((h) => h._source as Raw).filter(Boolean);
}

/** A missing index (posture never ran / no results yet) reads as empty. */
function missingIndex(err: unknown): { hits: { hits: [] } } {
  const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
  if (status === 404) return { hits: { hits: [] } };
  throw err;
}

class AgentCountsUnavailableError extends Error {
  readonly short: string;
  constructor(readonly cause: unknown) {
    super('agent counts unavailable');
    this.short = cause instanceof SentinelOneApiError ? `HTTP ${cause.statusCode}` : 'error';
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
