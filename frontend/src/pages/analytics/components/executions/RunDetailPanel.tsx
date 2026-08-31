import { Fragment } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';
import type { EnrichedTestExecution, RiskAcceptance } from '@/services/api/analytics';
import type { RelatedAlertsResponse } from '@/services/api/defender';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ALERT_SEVERITY_CLASSES,
  BundleResultLabel,
  ExecResultLabel,
  SEVERITY_VARIANTS,
  formatTimestamp,
  isSkippedStage,
  parseTimestamp,
  ERROR_CODE_CATEGORIES,
  ERROR_CATEGORY_COLORS,
  type BundleGroup,
  type DisplayRow,
} from './shared';

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

interface DescriptionData {
  description: string | null;
  hasInfoCard: boolean;
  hasReadme: boolean;
}

interface RunDetailPanelProps {
  row: DisplayRow | null;
  defenderConfigured: boolean;
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

function descKeyFor(exec: EnrichedTestExecution): string {
  return exec.is_bundle_control && exec.bundle_id
    ? `${exec.bundle_id}::${exec.control_validator ?? ''}`
    : exec.test_uuid;
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 break-words font-mono text-xs">{children}</div>
    </div>
  );
}

/** Description + metadata + stage-attributed Defender alerts for one execution. */
function ExecDetailBody({
  exec,
  defenderConfigured,
  descriptionMap,
  descriptionLoadingKey,
  alertsMap,
  alertsLoading,
  stageAlertsCacheKey,
  onOpenInfo,
}: Pick<
  RunDetailPanelProps,
  | 'defenderConfigured'
  | 'descriptionMap'
  | 'descriptionLoadingKey'
  | 'alertsMap'
  | 'alertsLoading'
  | 'stageAlertsCacheKey'
  | 'onOpenInfo'
> & { exec: EnrichedTestExecution }) {
  const isBundleCtrl = exec.is_bundle_control && exec.bundle_id;
  const descKey = descKeyFor(exec);
  const descData = descriptionMap.get(descKey);
  const isLoadingDesc = descriptionLoadingKey === descKey;
  const hasDocumentation = descData && (descData.hasInfoCard || descData.hasReadme);

  const alertKey = stageAlertsCacheKey(exec);
  const alertData = alertsMap.get(alertKey);
  const isLoadingAlerts = alertsLoading.has(alertKey);

  // Filter to alerts whose evidence binary is THIS specific stage's
  // technique. Accept exact match OR a `<control_id>-` prefix; the `-`
  // boundary prevents `T108` from accidentally matching `T1083`.
  const stageControlId = exec.control_id?.toLowerCase();
  const stageAlerts =
    alertData && stageControlId
      ? alertData.alerts.filter((a) => {
          if (a.attribution !== 'stage') return false;
          const att = a.attributed_control_id?.toLowerCase();
          if (!att) return false;
          return att === stageControlId || att.startsWith(`${stageControlId}-`);
        })
      : [];

  return (
    <div className="flex flex-col gap-3 text-sm">
      {!isLoadingDesc && hasDocumentation && (
        <div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInfo({
                testUuid: isBundleCtrl ? exec.bundle_id! : exec.test_uuid,
                testName: exec.test_name || exec.bundle_name || 'Test Details',
                hasInfoCard: descData!.hasInfoCard,
                hasReadme: descData!.hasReadme,
                scrollToValidator: isBundleCtrl ? exec.control_validator : undefined,
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-dim px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-dim/70"
          >
            <Info className="h-3.5 w-3.5" />
            View Details
          </button>
        </div>
      )}
      {(isLoadingDesc || descData?.description) && (
        <div className="min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-faint">Description</span>
          {isLoadingDesc ? (
            <div className="mt-1 h-4 w-64 animate-pulse rounded bg-raised" />
          ) : (
            <p className="mt-1 break-words text-xs text-foreground">
              {descData?.description?.replace(/:$/, '')}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetaCell label="Test UUID">{exec.test_uuid}</MetaCell>
        {exec.is_bundle_control && exec.control_validator && (
          <MetaCell label={exec.category === 'cyber-hygiene' ? 'Validator' : 'Stage'}>
            {exec.control_validator}
          </MetaCell>
        )}
        {exec.is_bundle_control && exec.control_id && exec.category !== 'cyber-hygiene' && (
          <MetaCell label="Technique">{exec.control_id}</MetaCell>
        )}
        {exec.tactics?.length ? <MetaCell label="Tactics">{exec.tactics.join(', ')}</MetaCell> : null}
        {exec.target && <MetaCell label="Target">{exec.target}</MetaCell>}
        {exec.complexity && <MetaCell label="Complexity">{exec.complexity}</MetaCell>}
        {exec.score !== undefined && <MetaCell label="Score">{exec.score}/10</MetaCell>}
        <MetaCell label="Executed">{formatTimestamp(exec.timestamp, false)}</MetaCell>
      </div>

      {exec.tags?.length ? (
        <div className="flex flex-wrap items-center gap-1">
          {exec.tags.map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* Related Defender Alerts — STAGE-ATTRIBUTABLE only. Bundle-level
          alerts render once in the bundle callout instead of being
          duplicated under every stage. */}
      {defenderConfigured && exec.techniques && exec.techniques.length > 0 && (
        <div className="border-t border-border pt-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
            Defender Alerts
          </span>
          {isLoadingAlerts ? (
            <div className="mt-2 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
              <span className="text-xs text-muted">Checking for related alerts...</span>
            </div>
          ) : stageAlerts.length > 0 ? (
            <div className="mt-2 space-y-2">
              {stageAlerts.map((alert) => {
                const testTime = parseTimestamp(exec.timestamp).getTime();
                const alertTime = new Date(alert.created_at).getTime();
                const deltaMin = Math.round(Math.abs(alertTime - testTime) / 60000);
                const deltaLabel =
                  deltaMin < 60
                    ? `${deltaMin}m ${alertTime > testTime ? 'after' : 'before'}`
                    : `${Math.round(deltaMin / 60)}h ${alertTime > testTime ? 'after' : 'before'}`;
                return (
                  <div key={alert.alert_id} className="flex items-center gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className={cn('px-1.5 py-0 text-[10px]', ALERT_SEVERITY_CLASSES[alert.severity])}
                    >
                      {alert.severity}
                    </Badge>
                    <span className="flex-1 truncate text-foreground">{alert.alert_title}</span>
                    <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                      {alert.status}
                    </Badge>
                    <span className="whitespace-nowrap text-faint">{deltaLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-faint">
              {alertData && alertData.alerts.some((a) => a.attribution === 'bundle')
                ? 'No stage-specific Defender alerts. See the bundle-level alerts above.'
                : 'No related Defender alerts within the time window'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RiskActions({
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

export function RunDetailPanel(props: RunDetailPanelProps) {
  const {
    row,
    defenderConfigured,
    alertsMap,
    alertsLoading,
    stageAlertsCacheKey,
    getAcceptanceForExec,
    archiveEnabled,
    onRequestArchive,
    expandedControlIndex,
    onToggleControl,
  } = props;

  if (!row) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-surface text-sm text-faint">
        Select a run to see its detail.
      </div>
    );
  }

  const headerExec = row.type === 'standalone' ? row.execution : undefined;
  const name = row.type === 'bundle' ? row.bundle_name : row.execution.test_name;
  const category = row.type === 'bundle' ? row.category : row.execution.category;
  const techniques =
    row.type === 'bundle'
      ? [...new Set(row.controls.flatMap((c) => c.techniques ?? []))]
      : (row.execution.techniques ?? []);

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold leading-snug">{name}</h3>
          <div className="shrink-0">
            {row.type === 'bundle' ? (
              <BundleResultLabel group={row} />
            ) : (
              <ExecResultLabel exec={row.execution} />
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {category && <Badge variant="low">{category}</Badge>}
          {headerExec?.severity && (
            <Badge
              variant="outline"
              className={cn('font-mono uppercase', SEVERITY_VARIANTS[headerExec.severity])}
            >
              {headerExec.severity}
            </Badge>
          )}
          {techniques.slice(0, 4).map((t) => (
            <Badge key={t} variant="default" className="font-mono">
              {t}
            </Badge>
          ))}
          {techniques.length > 4 && (
            <span className="text-xs text-faint">+{techniques.length - 4}</span>
          )}
          {headerExec && getAcceptanceForExec(headerExec) && (
            <Badge variant="medium" className="font-mono uppercase">
              <ShieldOff className="h-3 w-3" /> accepted
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-1">
            {headerExec && <RiskActions {...props} exec={headerExec} />}
            {archiveEnabled && (
              <Button
                variant="ghost"
                size="xs"
                className="hover:text-danger"
                onClick={() => onRequestArchive([row.key])}
                title="Archive"
              >
                <Archive />
                Archive
              </Button>
            )}
          </span>
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-3 border-b border-border p-4 md:grid-cols-4">
        <MetaCell label="Agent">
          {row.type === 'bundle' ? row.hostname : row.execution.hostname}
        </MetaCell>
        <MetaCell label="Executed">
          {formatTimestamp(row.type === 'bundle' ? row.timestamp : row.execution.timestamp, false)}
        </MetaCell>
        {headerExec ? (
          <>
            <MetaCell label="Result code">
              {(() => {
                const exec = headerExec;
                if (!exec.error_name && !exec.error_code) return '—';
                const text =
                  exec.error_name && exec.error_code
                    ? `${exec.error_name} (${exec.error_code})`
                    : exec.error_name || String(exec.error_code ?? '');
                const cat = exec.error_code != null ? ERROR_CODE_CATEGORIES[exec.error_code] : undefined;
                return <span className={cat ? ERROR_CATEGORY_COLORS[cat] : ''}>{text}</span>;
              })()}
            </MetaCell>
            {headerExec.score !== undefined && (
              <MetaCell label="Score">{headerExec.score}/10</MetaCell>
            )}
          </>
        ) : (
          <MetaCell label="Results">
            <span className="text-faint">
              {(row as BundleGroup).protectedCount}P / {(row as BundleGroup).unprotectedCount}F
            </span>
          </MetaCell>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {row.type === 'standalone' ? (
          <ExecDetailBody {...props} exec={row.execution} />
        ) : (
          <BundleBody
            group={row}
            {...props}
            defenderConfigured={defenderConfigured}
            alertsMap={alertsMap}
            alertsLoading={alertsLoading}
            stageAlertsCacheKey={stageAlertsCacheKey}
            expandedControlIndex={expandedControlIndex}
            onToggleControl={onToggleControl}
          />
        )}
      </div>
    </div>
  );
}

function BundleBody({
  group,
  ...props
}: RunDetailPanelProps & { group: BundleGroup }) {
  const {
    defenderConfigured,
    alertsMap,
    alertsLoading,
    stageAlertsCacheKey,
    expandedControlIndex,
    onToggleControl,
  } = props;

  // Bundle-level Defender alerts: union `attribution === 'bundle'` alerts
  // across every stage's cache, deduped by alert_id (later inserts win —
  // Defender can mutate fields like `status` between sync passes, so the
  // latest cached version is safest).
  const isLoadingAlerts = group.controls.some((ctrl) => alertsLoading.has(stageAlertsCacheKey(ctrl)));
  const seen = new Map<string, RelatedAlertsResponse['alerts'][number]>();
  for (const ctrl of group.controls) {
    const entry = alertsMap.get(stageAlertsCacheKey(ctrl));
    if (!entry) continue;
    for (const a of entry.alerts) {
      if (a.attribution === 'bundle') seen.set(a.alert_id, a);
    }
  }
  const bundleAlerts = Array.from(seen.values());

  const scored = group.controls.filter((c) => !isSkippedStage(c));
  const ratio = scored.length > 0 ? group.protectedCount / scored.length : 0;
  const itemLabel = group.category === 'cyber-hygiene' ? 'Controls' : 'Stages';

  return (
    <div className="flex flex-col gap-3">
      {defenderConfigured && (isLoadingAlerts || bundleAlerts.length > 0) && (
        <div className="rounded-md border border-warning/40 bg-warning-dim p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium uppercase tracking-wide text-warning">
                Bundle-level Defender alerts
              </span>
              <span className="ml-2 text-xs text-muted">
                (evidence doesn't identify a specific stage)
              </span>
              {isLoadingAlerts ? (
                <div className="mt-1 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-muted" />
                  <span className="text-xs text-muted">Checking…</span>
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  {bundleAlerts.map((alert) => (
                    <div key={alert.alert_id} className="flex items-center gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={cn('px-1.5 py-0 text-[10px]', ALERT_SEVERITY_CLASSES[alert.severity])}
                      >
                        {alert.severity}
                      </Badge>
                      <span className="flex-1 truncate text-foreground">{alert.alert_title}</span>
                      <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                        {alert.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Controls header + protection ratio bar */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
          {itemLabel}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-danger-dim">
          <div className="h-full rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
        </div>
        <span className="font-mono text-[11px] text-muted">
          {group.protectedCount}/{scored.length || group.totalCount}
        </span>
      </div>

      {/* Per-control rows */}
      <div className="flex flex-col gap-1.5">
        {group.controls.map((ctrl, index) => {
          const expanded = expandedControlIndex === index;
          return (
            <Fragment key={`${group.key}::ctrl-${index}`}>
              <button
                onClick={() => onToggleControl(index, ctrl)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border border-border bg-raised px-3 py-2 text-left text-xs transition-colors hover:bg-overlay',
                  expanded && 'border-border-strong bg-overlay',
                )}
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                )}
                <span className="min-w-0 flex-1 truncate">{ctrl.test_name}</span>
                <ExecResultLabel exec={ctrl} compact />
              </button>
              {expanded && (
                <div className="ml-4 rounded-md border border-border p-3">
                  <div className="mb-2 flex justify-end">
                    <RiskActions {...props} exec={ctrl} />
                  </div>
                  <ExecDetailBody {...props} exec={ctrl} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
