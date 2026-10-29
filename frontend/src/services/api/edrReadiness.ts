import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { EdrVendorKey } from '@/lib/edrVendors';

export interface EdrEsPrivilegeGap {
  index: string;
  privileges: string[];
}

/** Can the analytics Elasticsearch API key do what an EDR integration needs? */
export interface EdrEsReadiness {
  status: 'ready' | 'not_ready';
  checked_at: string;
  /** False where the cluster can't report privileges (security disabled): only reachability was checked. */
  privileges_checked: boolean;
  missing: EdrEsPrivilegeGap[];
  /** Not needed to sync; `manage` lets later releases update the index mapping. */
  recommended: EdrEsPrivilegeGap[];
  error?: string;
}

export const edrReadinessApi = {
  /** Stored result (null before any check), or a fresh read-only check (Test). */
  async get(vendor: EdrVendorKey, fresh: boolean): Promise<EdrEsReadiness | null> {
    const response = await apiClient.get(`/integrations/edr/${vendor}/elasticsearch`, { params: fresh ? { fresh: 1 } : undefined });
    return response.data.elasticsearch ?? null;
  },
};
