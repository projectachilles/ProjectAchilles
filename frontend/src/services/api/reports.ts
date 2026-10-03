import { apiClient } from '@/hooks/useAuthenticatedApi';

// ─── SB-PC-2026-001 compliance report ─────────────────────────────

export type SbOutcome = 'PREVENTED' | 'DETECTED' | 'MISSED' | 'EXPOSED' | 'NOT_RUN' | 'ERROR';

export interface SbReportExecutionRow {
  sourceEventId: string;
  timestamp: string;
  bundleId: string;
  bundleName: string;
  testName: string;
  hostname: string;
  stage: number;
  stageLabel: string;
  techniques: string[];
  tactics: string[];
  outcome: SbOutcome;
  isProtected: boolean;
  preventedBy: string[];
  detectedBy: string[];
  evidenceRef: string;
}

export interface SbReport {
  meta: {
    organization: string;
    vendor: string;
    window: { from: string; to: string };
    generatedAt: string;
  };
  executions: SbReportExecutionRow[];
}

export interface SbReportParams {
  /** Window start, ISO 8601 datetime (required). */
  from: string;
  /** Window end, ISO 8601 datetime (required). */
  to: string;
  /** Organization UUID (routing.oid filter). */
  org?: string;
  /** SB entity code for meta.organization. */
  orgCode?: string;
  /** Bundle UUID (f0rtika.bundle_id filter). */
  bundleUuid?: string;
}

export const reportsApi = {
  /** Fetch the SB-PC-2026-001 compliance report for a window. */
  async getSbPc2026001Report(params: SbReportParams): Promise<SbReport> {
    const response = await apiClient.get('/reports/sb-pc-2026-001', {
      params: {
        from: params.from,
        to: params.to,
        org: params.org,
        org_code: params.orgCode,
        bundle_uuid: params.bundleUuid,
      },
    });
    return response.data;
  },
};
