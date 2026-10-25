// Per-vendor copy and defaults for the shared integration (CrowdStrike / Defender / SentinelOne) tab components.

import { crowdstrikeApi } from '@/services/api/crowdstrike';
import { DEFAULT_FALCON_CONSOLE_BASE, falconAlertUrl, resolveFalconConsoleBase } from '../../utils/falconConsole';
import { defenderApi } from '@/services/api/defender';
import { sentineloneAnalyticsApi } from '@/services/api/sentineloneAnalytics';

import type { IntegrationApi } from '@/services/api/integrationTypes';

export type { TimeWindow } from '@/services/api/integrationTypes';

export type VendorId = 'crowdstrike' | 'defender' | 'sentinelone';

export interface SeveritySegment {
  key: string;
  label: string;
  /** null = no severity filter. */
  severities: string[] | null;
}

/** Optional record-type filter (e.g. SentinelOne threats vs detection alerts). */
export interface AlertTypeSegment {
  key: string;
  label: string;
  /** null = no filter. */
  sourceType: string | null;
}

/**
 * How to build an alert's console link when the stored portal_url isn't
 * enough (CrowdStrike: fall back to the configured region's console).
 */
export interface ConsoleLink {
  defaultBase: string;
  resolveBase: () => Promise<string>;
  url: (portalUrl: string | null | undefined, base: string) => string;
}

export interface IntegrationVendor {
  id: VendorId;
  /** Full product name (tab header). */
  name: string;
  /** Short name for copy: "Recent <x> Alerts", "<x> sync failed". */
  shortName: string;
  /** Tab header subtitle. */
  tabSubtitle: string;
  /** Product label in the alert feed's empty / count copy. */
  product: string;
  /**
   * Endpoint-EDR alert docs (host column, prevention facet, the
   * EndpointAlertDetailsDrawer): CrowdStrike and SentinelOne.
   */
  endpointEdr: boolean;
  consoleLink?: ConsoleLink;
  alertsTitle: string;
  portalLabel: string;
  responseLabel: string;
  knownSeverities: string[];
  severitySegments: SeveritySegment[];
  defaultSeverityKey: string;
  alertTypeSegments?: AlertTypeSegment[];
  api: IntegrationApi;
}

export const VENDORS: Record<VendorId, IntegrationVendor> = {
  crowdstrike: {
    id: 'crowdstrike',
    name: 'CrowdStrike Falcon',
    shortName: 'CrowdStrike',
    tabSubtitle: 'Zero Trust posture score, security alerts, and detection correlation',
    product: 'Falcon',
    endpointEdr: true,
    consoleLink: { defaultBase: DEFAULT_FALCON_CONSOLE_BASE, resolveBase: resolveFalconConsoleBase, url: falconAlertUrl },
    alertsTitle: 'Falcon Alerts',
    portalLabel: 'Open in Falcon console',
    responseLabel: 'Falcon response',
    knownSeverities: ['critical', 'high', 'medium', 'low', 'informational'],
    severitySegments: [
      { key: 'all', label: 'All severities', severities: null },
      { key: 'hc', label: 'High & critical', severities: ['critical', 'high'] },
    ],
    defaultSeverityKey: 'all',
    api: {
      getAlerts: crowdstrikeApi.getAlerts,
      getAlertTrend: crowdstrikeApi.getAlertTrend,
      getAlertSummary: crowdstrikeApi.getAlertSummary,
      getTechniqueCoverage: crowdstrikeApi.getTechniqueCoverage,
    },
  },
  defender: {
    id: 'defender',
    name: 'Microsoft Defender',
    shortName: 'Defender',
    tabSubtitle: 'Secure Score, security alerts, and remediation controls',
    product: 'Defender',
    endpointEdr: false,
    alertsTitle: 'Defender Alerts',
    portalLabel: 'Open in Defender portal',
    responseLabel: 'Defender response',
    knownSeverities: ['high', 'medium', 'low', 'informational'],
    severitySegments: [
      { key: 'hm', label: 'High & medium', severities: ['high', 'medium'] },
      { key: 'all', label: 'All severities', severities: null },
    ],
    defaultSeverityKey: 'hm',
    api: {
      getAlerts: defenderApi.getAlerts,
      getAlertTrend: defenderApi.getAlertTrend,
      getAlertSummary: defenderApi.getAlertSummary,
      getTechniqueCoverage: defenderApi.getTechniqueCoverage,
    },
  },
  sentinelone: {
    id: 'sentinelone',
    name: 'SentinelOne Singularity',
    shortName: 'SentinelOne',
    tabSubtitle: 'Threats, detection alerts, and detection correlation',
    product: 'SentinelOne',
    endpointEdr: true,
    alertsTitle: 'SentinelOne Alerts',
    portalLabel: 'Open in SentinelOne console',
    responseLabel: 'SentinelOne response',
    knownSeverities: ['critical', 'high', 'medium', 'low', 'informational'],
    severitySegments: [
      { key: 'all', label: 'All severities', severities: null },
      { key: 'hc', label: 'High & critical', severities: ['critical', 'high'] },
    ],
    defaultSeverityKey: 'all',
    alertTypeSegments: [
      { key: 'all', label: 'All types', sourceType: null },
      { key: 'threats', label: 'Threats', sourceType: 'threats' },
      { key: 'alerts', label: 'Detection alerts', sourceType: 'cloud_detection_alerts' },
    ],
    api: {
      getAlerts: sentineloneAnalyticsApi.getAlerts,
      getAlertTrend: sentineloneAnalyticsApi.getAlertTrend,
      getAlertSummary: sentineloneAnalyticsApi.getAlertSummary,
      getTechniqueCoverage: sentineloneAnalyticsApi.getTechniqueCoverage,
    },
  },
};
