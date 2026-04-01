// Risk Acceptance service — CRUD for formal risk acceptance records.
// Manages the lifecycle: accept → (optionally revoke).
// Provides a cached exclusion filter for Defense Score queries.

import { randomUUID } from 'node:crypto';
import { Client } from '@elastic/elasticsearch';
import { RISK_ACCEPTANCE_INDEX, ensureRiskAcceptanceIndex } from './index-management.js';

// ── Types ──────────────────────────────────────────────────────────

export type RiskScope = 'host' | 'global';

export interface RiskAcceptance {
  acceptance_id: string;
  org_id?: string;
  test_name: string;
  control_id?: string;
  hostname?: string;
  scope?: RiskScope;
  justification: string;
  accepted_by: string;
  accepted_by_name: string;
  accepted_at: string;
  status: 'active' | 'revoked';
  revoked_at?: string;
  revoked_by?: string;
  revoked_by_name?: string;
  revocation_reason?: string;
}

export interface AcceptRiskParams {
  org_id?: string;
  test_name: string;
  control_id?: string;
  hostname?: string;
  scope?: RiskScope;
  justification: string;
  accepted_by: string;
  accepted_by_name: string;
}

export interface RevokeRiskParams {
  revoked_by: string;
  revoked_by_name: string;
  revocation_reason: string;
}

export interface ListAcceptancesParams {
  org_id?: string;
  status?: 'active' | 'revoked';
  test_name?: string;
  page?: number;
  pageSize?: number;
}

// ── Service ────────────────────────────────────────────────────────

export class RiskAcceptanceService {
  private client: Client;
  private indexEnsured = false;

  // In-memory cache for the risk acceptance exclusion filter
  private riskAcceptanceCache: RiskAcceptance[] | null = null;
  private riskAcceptanceCacheExpiry = 0;
  private static readonly RISK_CACHE_TTL = 60_000; // 60 seconds

  constructor(client: Client) {
    this.client = client;
  }

  /** Ensure the index exists (lazy, once per instance). */
  private async ensureIndex(): Promise<void> {
    if (this.indexEnsured) return;
    await ensureRiskAcceptanceIndex();
    this.indexEnsured = true;
  }

  /** Accept risk for a test/control. */
  async acceptRisk(params: AcceptRiskParams): Promise<RiskAcceptance> {
    await this.ensureIndex();

    const doc: RiskAcceptance = {
      acceptance_id: randomUUID(),
      org_id: params.org_id || undefined,
      test_name: params.test_name,
      control_id: params.control_id || undefined,
      hostname: params.hostname || undefined,
      scope: params.scope || 'global',
      justification: params.justification,
      accepted_by: params.accepted_by,
      accepted_by_name: params.accepted_by_name,
      accepted_at: new Date().toISOString(),
      status: 'active',
    };

    await this.client.index({
      index: RISK_ACCEPTANCE_INDEX,
      id: doc.acceptance_id,
      document: doc,
      refresh: 'wait_for',
    });

    this.invalidateCache();
    return doc;
  }

  /** Revoke an active risk acceptance. */
  async revokeRisk(acceptanceId: string, params: RevokeRiskParams): Promise<RiskAcceptance> {
    const existing = await this.getAcceptanceById(acceptanceId);
    if (!existing) {
      throw new Error(`Risk acceptance not found: ${acceptanceId}`);
    }
    if (existing.status === 'revoked') {
      throw new Error(`Risk acceptance already revoked: ${acceptanceId}`);
    }

    const updated: RiskAcceptance = {
      ...existing,
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: params.revoked_by,
      revoked_by_name: params.revoked_by_name,
      revocation_reason: params.revocation_reason,
    };

    await this.client.index({
      index: RISK_ACCEPTANCE_INDEX,
      id: acceptanceId,
      document: updated,
      refresh: 'wait_for',
    });

    this.invalidateCache();
    return updated;
  }

  /** Get a single acceptance by ID. */
  async getAcceptanceById(id: string): Promise<RiskAcceptance | null> {
    await this.ensureIndex();

    try {
      const response = await this.client.get<RiskAcceptance>({
        index: RISK_ACCEPTANCE_INDEX,
        id,
      });
      return response._source ?? null;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /** List acceptances with optional filters. */
  async listAcceptances(params?: ListAcceptancesParams): Promise<{ data: RiskAcceptance[]; total: number }> {
    await this.ensureIndex();

    const filters: any[] = [];

    // Org isolation: filter by org_id when provided (new records have org_id;
    // legacy records without org_id are visible to all orgs for backward compat)
    if (params?.org_id) {
      filters.push({
        bool: {
          should: [
            { term: { org_id: params.org_id } },
            { bool: { must_not: { exists: { field: 'org_id' } } } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (params?.status) {
      filters.push({ term: { status: params.status } });
    }
    if (params?.test_name) {
      filters.push({ term: { test_name: params.test_name } });
    }

    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;

    const response = await this.client.search<RiskAcceptance>({
      index: RISK_ACCEPTANCE_INDEX,
      size: pageSize,
      from: (page - 1) * pageSize,
      sort: [{ accepted_at: { order: 'desc' } }],
      query: filters.length > 0
        ? { bool: { filter: filters } }
        : { match_all: {} },
    });

    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value ?? 0;

    const data = response.hits.hits
      .map(hit => hit._source)
      .filter((s): s is RiskAcceptance => s !== undefined);

    return { data, total };
  }

  /** Get all active acceptances (cached, used by Defense Score filter). */
  async getActiveAcceptances(): Promise<RiskAcceptance[]> {
    const now = Date.now();
    if (this.riskAcceptanceCache && now < this.riskAcceptanceCacheExpiry) {
      return this.riskAcceptanceCache;
    }

    await this.ensureIndex();

    // Scroll through all active acceptances (expect low volume, <1000)
    const response = await this.client.search<RiskAcceptance>({
      index: RISK_ACCEPTANCE_INDEX,
      size: 1000,
      query: { term: { status: 'active' } },
    });

    const acceptances = response.hits.hits
      .map(hit => hit._source)
      .filter((s): s is RiskAcceptance => s !== undefined);

    this.riskAcceptanceCache = acceptances;
    this.riskAcceptanceCacheExpiry = now + RiskAcceptanceService.RISK_CACHE_TTL;
    return acceptances;
  }

  /** Batch lookup: get active acceptances for a list of test_names. */
  async getAcceptancesForControls(testNames: string[]): Promise<Record<string, RiskAcceptance[]>> {
    if (testNames.length === 0) return {};

    await this.ensureIndex();

    const response = await this.client.search<RiskAcceptance>({
      index: RISK_ACCEPTANCE_INDEX,
      size: 1000,
      query: {
        bool: {
          filter: [
            { term: { status: 'active' } },
            { terms: { test_name: testNames } },
          ],
        },
      },
    });

    const result: Record<string, RiskAcceptance[]> = {};
    for (const hit of response.hits.hits) {
      const doc = hit._source;
      if (!doc) continue;
      // Key by test_name or test_name::control_id for bundle sub-controls
      const key = doc.control_id ? `${doc.test_name}::${doc.control_id}` : doc.test_name;
      if (!result[key]) result[key] = [];
      result[key].push(doc);
    }

    return result;
  }

  /**
   * Build the must_not exclusion filter for Defense Score queries.
   * Returns null if no active acceptances exist.
   */
  async buildExclusionFilter(): Promise<any | null> {
    const acceptances = await this.getActiveAcceptances();
    if (acceptances.length === 0) return null;

    const exclusions: any[] = [];

    for (const acc of acceptances) {
      // Determine effective scope:
      // - Explicit scope field takes priority
      // - Legacy records (no scope): hostname present → 'host', absent → 'global'
      const effectiveScope: RiskScope = acc.scope ?? (acc.hostname ? 'host' : 'global');

      if (effectiveScope === 'host' && acc.hostname) {
        // Per-host acceptance — exclude only for this hostname
        const must: any[] = [
          { term: { 'f0rtika.test_name': acc.test_name } },
          { term: { 'routing.hostname': acc.hostname } },
        ];
        if (acc.control_id) {
          must.push({ term: { 'f0rtika.control_id': acc.control_id } });
        }
        exclusions.push({ bool: { must } });
      } else if (acc.control_id) {
        // Global bundle sub-control acceptance — all hosts
        exclusions.push({
          bool: {
            must: [
              { term: { 'f0rtika.test_name': acc.test_name } },
              { term: { 'f0rtika.control_id': acc.control_id } },
            ],
          },
        });
      } else {
        // Global acceptance for entire test — all hosts
        exclusions.push({ term: { 'f0rtika.test_name': acc.test_name } });
      }
    }

    return { bool: { must_not: exclusions } };
  }

  /** Invalidate the in-memory cache (called after accept/revoke). */
  invalidateCache(): void {
    this.riskAcceptanceCache = null;
    this.riskAcceptanceCacheExpiry = 0;
  }
}
