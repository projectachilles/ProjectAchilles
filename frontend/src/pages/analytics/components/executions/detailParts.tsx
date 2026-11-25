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
  /** Show the "Test version" block (capability `testVersions`). */
  showVersions?: boolean;
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

/** The alert fields the stage rules read. */
interface StageAttributable {
  attribution?: string;
  attributed_control_id?: string;
  attributed_control_ids?: string[];
  stage_actions?: Record<string, string>;
  prevention_action?: string;
}

/** The stage's own control token among `tokens`: exact match OR a `<control_id>-` variant prefix (the `-` keeps `T108` off `T1083`). */
function tokenForStage(tokens: string[], stageControlId: string): string | undefined {
  return tokens.find((t) => t === stageControlId || t.startsWith(`${stageControlId}-`));
}

/**
 * Alerts that have evidence for THIS specific stage, each with that stage's own
 * action as `prevention_action`. An alert is listed under every control in
 * `attributed_control_ids` (falling back to `attributed_control_id`). When the
 * alert carries `stage_actions` the stage's entry is its action (none when the
 * stage has no entry); without `stage_actions` the alert's own
 * `prevention_action` shows under every stage.
 */
function filterStageAlerts<A extends StageAttributable>(alerts: A[], controlId: string | undefined): A[] {
  const stageControlId = controlId?.toLowerCase();
  if (!stageControlId) return [];
  const out: A[] = [];
  for (const a of alerts) {
    if (a.attribution !== 'stage') continue;
    const tokens = (a.attributed_control_ids?.length ? a.attributed_control_ids : a.attributed_control_id ? [a.attributed_control_id] : []).map(
      (t) => t.toLowerCase(),
    );
    const token = tokenForStage(tokens, stageControlId);
    if (!token) continue;
    if (!a.stage_actions) {
      out.push(a);
      continue;
    }
    const actions = Object.entries(a.stage_actions).map(([k, v]) => [k.toLowerCase(), v] as const);
    const own = actions.find(([k]) => k === token)?.[1] ?? actions.find(([k]) => tokenForStage([k], stageControlId))?.[1];
    out.push({ ...a, prevention_action: own });
  }
  return out;
}

/** Cache key of one execution's alerts: its time keeps two runs of a test on a host apart. */
export function stageAlertsKey(exec: Pick<EnrichedTestExecution, 'test_uuid' | 'hostname' | 'timestamp'>): string {
  return `${exec.test_uuid}::${exec.hostname}::${exec.timestamp}::stage-alerts`;
}

/** Shown when a related-alerts lookup failed (not "no alerts"); selecting the run again retries it. */
export function lookupFailedText(vendors: string): string {
  return `Couldn't load ${vendors} alerts. Select the run again to retry.`;
}

/**
 * Per-vendor loading state, stage-attributed alerts, whether bundle-level
 * alerts exist, and whether the lookup failed. A failed lookup is stored as
 * null (a lookup that found nothing is { alerts: [] }), so `failed` keeps an
 * HTTP error from reading as "No related alerts".
 */
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
  // Only a bundle stage filters to its own alerts: its siblings' and the
  // orchestrator's alerts render once in the bundle callout. A standalone run
  // (including an EDR launch block) has no stages and no callout, so every
  // correlated alert is the run's own, even though its test binary's alert
  // reads as orchestrator-attributed ('bundle').
  // Alerts naming several tests that single out none of this run's files are
  // never the run's own ('multi_test'): they render as one note instead.
  const pick = <A extends StageAttributable>(alerts: A[]): A[] =>
    exec.is_bundle_control
      ? filterStageAlerts(alerts, exec.control_id)
      : alerts.filter((a) => a.attribution !== 'multi_test');
  const multiTest = <A extends { attribution?: string }>(alerts: A[]): A[] =>
    alerts.filter((a) => a.attribution === 'multi_test');
  const endpoint = Object.fromEntries(
    ENDPOINT_VENDOR_IDS.map((id) => {
      const map = endpointAlerts[id]?.map;
      const entry = map?.get(key);
      const loading = Boolean(endpointAlerts[id]?.loading.has(key));
      return [
        id,
        {
          loading,
          failed: !loading && Boolean(map?.has(key)) && entry === null,
          alerts: entry ? pick(entry.alerts) : [],
          multiTestAlerts: entry ? multiTest(entry.alerts) : [],
          hasBundleAlerts: Boolean(entry?.alerts.some((a) => a.attribution === 'bundle')),
        },
      ];
    }),
  ) as Record<EndpointVendorId, { loading: boolean; failed: boolean; alerts: CrowdStrikeAlertItem[]; multiTestAlerts: CrowdStrikeAlertItem[]; hasBundleAlerts: boolean }>;
  const defLoading = alertsLoading.has(key);
  return {
    defender: {
      loading: defLoading,
      failed: !defLoading && alertsMap.has(key) && def === null,
      alerts: def ? pick(def.alerts) : [],
      multiTestAlerts: def ? multiTest(def.alerts) : [],
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
  ranToCompletion,
}: {
  alert: DefenderAlertItem;
  runTimestamp: string;
  vendor?: string;
  /** The result shown exited 101: an action reads "stage still completed" (same rule as the verdict). */
  ranToCompletion?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {vendor && <span className="w-20 shrink-0 text-muted">{vendor}</span>}
      <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', ALERT_SEVERITY_CLASSES[alert.severity])}>
        {alert.severity}
      </Badge>
      <PreventionBadge action={alert.prevention_action} rawStatus={alert.remediation_status} stageCompleted={ranToCompletion} />
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
  ranToCompletion,
}: {
  alert: CrowdStrikeAlertItem;
  runTimestamp: string;
  vendor: EndpointVendorId;
  /** Adds a leading vendor-name column (stage view). */
  showVendor?: boolean;
  /** The result shown exited 101: an action reads "stage still completed" (same rule as the verdict). */
  ranToCompletion?: boolean;
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
        stageCompleted={ranToCompletion}
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
