import { ExternalLink, ShieldAlert, ShieldOff } from 'lucide-react';
import type { EnrichedTestExecution, RiskAcceptance } from '@/services/api/analytics';
import type { DefenderAlertItem, RelatedAlertsResponse } from '@/services/api/defender';
import type { CrowdStrikeAlertItem, RelatedCrowdStrikeAlertsResponse } from '@/services/api/crowdstrike';
import { ENDPOINT_VENDOR_IDS, VENDORS, type EndpointVendorId } from '../integrations/vendorConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { falconAlertUrl } from '../../utils/falconConsole';
import { defenderAlertUrl } from '../../utils/defenderPortal';
import PreventionBadge from '../PreventionBadge';
import {
  ALERT_SEVERITY_CLASSES,
  ERROR_CATEGORY_COLORS,
  ERROR_CODE_CATEGORIES,
  alertRunTimeAnnotation,
  type DisplayRow,
} from './shared';

// Pieces shared by the run detail panel's execution body and its attack-chain
// stage view (StageList).

export interface AcceptRiskItem {
  test_name: string;
  control_id?: string;
  hostname?: string;
  scope?: 'host' | 'global';
}

export interface InfoModalRequest {
  testUuid: string;
  testName: string;
  hasInfoCard: boolean;
  hasReadme: boolean;
  scrollToValidator?: string;
}

export interface DescriptionData {
  description: string | null;
  hasInfoCard: boolean;
  hasReadme: boolean;
}

export type EndpointAlertState = Record<
  EndpointVendorId,
  {
    configured: boolean;
    map: Map<string, RelatedCrowdStrikeAlertsResponse | null>;
    loading: Set<string>;
  }
>;

/** Every endpoint vendor unconfigured with no alerts (defaults for callers and tests). */
export function emptyEndpointAlerts(): EndpointAlertState {
  return Object.fromEntries(
    ENDPOINT_VENDOR_IDS.map((id) => [id, { configured: false, map: new Map(), loading: new Set() }]),
  ) as EndpointAlertState;
}

export interface RunDetailPanelProps {
  row: DisplayRow | null;
  defenderConfigured: boolean;
  /** Related alerts per endpoint-EDR vendor (CrowdStrike, SentinelOne, Sophos). */
  endpointAlerts: EndpointAlertState;
  descriptionMap: Map<string, DescriptionData | null>;
  descriptionLoadingKey: string | null;
  alertsMap: Map<string, RelatedAlertsResponse | null>;
  alertsLoading: Set<string>;
  stageAlertsCacheKey: (exec: EnrichedTestExecution) => string;
  getAcceptanceForExec: (exec: EnrichedTestExecution) => RiskAcceptance | undefined;
  riskEnabled: boolean;
  archiveEnabled: boolean;
  onRequestAcceptRisk: (items: AcceptRiskItem[]) => void;
  onRequestRevoke: (target: { id: string; testName: string }) => void;
  onRequestArchive: (keys: string[]) => void;
  onOpenInfo: (request: InfoModalRequest) => void;
  /** Which control row (index) is expanded within a bundle. */
  expandedControlIndex: number | null;
  onToggleControl: (index: number, exec: EnrichedTestExecution) => void;
}

export function descKeyFor(exec: EnrichedTestExecution): string {
  return exec.is_bundle_control && exec.bundle_id
    ? `${exec.bundle_id}::${exec.control_validator ?? ''}`
    : exec.test_uuid;
}

export function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 break-words font-mono text-xs">{children}</div>
    </div>
  );
}

/** "error_name (code)", coloured by the code's category; an em dash when there is neither. */
export function ResultCode({ exec }: { exec: EnrichedTestExecution }) {
  if (!exec.error_name && !exec.error_code) return <>—</>;
  const text =
    exec.error_name && exec.error_code
      ? `${exec.error_name} (${exec.error_code})`
      : exec.error_name || String(exec.error_code ?? '');
  const cat = exec.error_code != null ? ERROR_CODE_CATEGORIES[exec.error_code] : undefined;
  const code = <span className={cat ? ERROR_CATEGORY_COLORS[cat] : ''}>{text}</span>;
  // An EDR-confirmed launch block: the backend rewrote the agent's 260 to 126.
  if (!exec.edr_launch_blocked) return code;
  return (
    <span className="flex flex-col">
      {code}
      <span className="text-[11px] text-faint">Agent reported 260 (BlockedPreExecution); set to 126 by the EDR's alert</span>
    </span>
  );
}

export function RiskActions({
  exec,
  riskEnabled,
  getAcceptanceForExec,
  onRequestAcceptRisk,
  onRequestRevoke,
}: Pick<RunDetailPanelProps, 'riskEnabled' | 'getAcceptanceForExec' | 'onRequestAcceptRisk' | 'onRequestRevoke'> & {
  exec: EnrichedTestExecution;
}) {
  if (!riskEnabled) return null;
  const acceptance = getAcceptanceForExec(exec);
  if (acceptance) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="text-warning hover:text-warning"
        onClick={(e) => {
          e.stopPropagation();
          onRequestRevoke({ id: acceptance.acceptance_id, testName: exec.test_name });
        }}
        title={`Risk accepted — ${acceptance.justification.substring(0, 100)} — by ${acceptance.accepted_by_name}`}
      >
        <ShieldAlert />
        Revoke
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={(e) => {
        e.stopPropagation();
        onRequestAcceptRisk([
          { test_name: exec.test_name, control_id: exec.control_id, hostname: exec.hostname },
        ]);
      }}
      title="Accept Risk"
    >
      <ShieldOff />
      Accept risk
    </Button>
  );
}

// ── Stage-attributed EDR alerts ────────────────────────────────────

/**
 * Alerts whose evidence binary is THIS specific stage's technique. Accept
 * exact match OR a `<control_id>-` prefix; the `-` boundary prevents `T108`
 * from accidentally matching `T1083`.
 */
function filterStageAlerts<A extends { attribution?: string; attributed_control_id?: string }>(
  alerts: A[],
  controlId: string | undefined,
): A[] {
  const stageControlId = controlId?.toLowerCase();
  if (!stageControlId) return [];
  return alerts.filter((a) => {
    if (a.attribution !== 'stage') return false;
    const att = a.attributed_control_id?.toLowerCase();
    if (!att) return false;
    return att === stageControlId || att.startsWith(`${stageControlId}-`);
  });
}

/** Per-vendor loading state, stage-attributed alerts, and whether bundle-level alerts exist. */
export function stageAlertState(
  exec: EnrichedTestExecution,
  {
    alertsMap,
    alertsLoading,
    endpointAlerts,
    stageAlertsCacheKey,
  }: Pick<RunDetailPanelProps, 'alertsMap' | 'alertsLoading' | 'endpointAlerts' | 'stageAlertsCacheKey'>,
) {
  const key = stageAlertsCacheKey(exec);
  const def = alertsMap.get(key);
  // An EDR launch block is a whole-test result with no stage: its evidence is
  // the orchestrator alert (bundle-attributed), so nothing is stage-filtered.
  const pick = <A extends { attribution?: string; attributed_control_id?: string }>(alerts: A[]): A[] =>
    exec.edr_launch_blocked && !exec.is_bundle_control ? alerts : filterStageAlerts(alerts, exec.control_id);
  const endpoint = Object.fromEntries(
    ENDPOINT_VENDOR_IDS.map((id) => {
      const entry = endpointAlerts[id]?.map.get(key);
      return [
        id,
        {
          loading: Boolean(endpointAlerts[id]?.loading.has(key)),
          alerts: entry ? pick(entry.alerts) : [],
          hasBundleAlerts: Boolean(entry?.alerts.some((a) => a.attribution === 'bundle')),
        },
      ];
    }),
  ) as Record<EndpointVendorId, { loading: boolean; alerts: CrowdStrikeAlertItem[]; hasBundleAlerts: boolean }>;
  return {
    defender: {
      loading: alertsLoading.has(key),
      alerts: def ? pick(def.alerts) : [],
      hasBundleAlerts: Boolean(def?.alerts.some((a) => a.attribution === 'bundle')),
    },
    endpoint,
  };
}

function AlertRowLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-foreground"
      aria-label={label}
      title={label}
    >
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** One stage-attributed alert row; `vendor` adds a leading vendor column (stage view). */
export function DefenderAlertRow({
  alert,
  runTimestamp,
  vendor,
}: {
  alert: DefenderAlertItem;
  runTimestamp: string;
  vendor?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {vendor && <span className="w-20 shrink-0 text-muted">{vendor}</span>}
      <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', ALERT_SEVERITY_CLASSES[alert.severity])}>
        {alert.severity}
      </Badge>
      <PreventionBadge action={alert.prevention_action} rawStatus={alert.remediation_status} />
      <span className="flex-1 truncate text-foreground">{alert.alert_title}</span>
      <Badge variant="default" className="px-1.5 py-0 text-[10px]">
        {alert.status}
      </Badge>
      <span className="whitespace-nowrap text-faint">{alertRunTimeAnnotation(runTimestamp, alert)}</span>
      <AlertRowLink href={defenderAlertUrl(alert.portal_url, alert.alert_id)} label="Open in Microsoft Defender" />
    </div>
  );
}

/**
 * One alert row for an endpoint-EDR vendor (CrowdStrike-shaped docs). The link
 * label comes from the vendor registry; CrowdStrike resolves its region's
 * Falcon console URL, the others link only when the doc carries a console URL.
 */
export function EndpointAlertRow({
  alert,
  runTimestamp,
  vendor,
  showVendor,
}: {
  alert: CrowdStrikeAlertItem;
  runTimestamp: string;
  vendor: EndpointVendorId;
  /** Adds a leading vendor-name column (stage view). */
  showVendor?: boolean;
}) {
  const label = VENDORS[vendor].portalLabel;
  return (
    <div className="flex items-center gap-2 text-xs">
      {showVendor && <span className="w-20 shrink-0 text-muted">{VENDORS[vendor].shortName}</span>}
      <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', ALERT_SEVERITY_CLASSES[alert.severity])}>
        {alert.severity}
      </Badge>
      <PreventionBadge
        action={alert.prevention_action}
        rawStatus={vendor === 'crowdstrike' ? alert.pattern_disposition_description : undefined}
      />
      <span className="flex-1 truncate text-foreground">{alert.alert_title}</span>
      {/* Sophos siem_event rows have no status (''): no empty badge. */}
      {alert.status && (
        <Badge variant="default" className="px-1.5 py-0 text-[10px]">
          {alert.status}
        </Badge>
      )}
      <span className="whitespace-nowrap text-faint">{alertRunTimeAnnotation(runTimestamp, alert)}</span>
      {vendor === 'crowdstrike' ? (
        <AlertRowLink href={falconAlertUrl(alert.portal_url)} label={label} />
      ) : (
        alert.portal_url && <AlertRowLink href={alert.portal_url} label={label} />
      )}
    </div>
  );
}
