import { Fragment } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  Loader2,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import type { RelatedAlertsResponse } from '@/services/api/defender';
import type { RelatedCrowdStrikeAlertsResponse } from '@/services/api/crowdstrike';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { falconAlertUrl } from '../../utils/falconConsole';
import { defenderAlertUrl } from '../../utils/defenderPortal';
import PreventionBadge from '../PreventionBadge';
import {
  ALERT_SEVERITY_CLASSES,
  BundleResultLabel,
  ExecResultLabel,
  SEVERITY_VARIANTS,
  formatTimestamp,
  isSkippedStage,
  type BundleGroup,
} from './shared';
import {
  CrowdStrikeAlertRow,
  DefenderAlertRow,
  SentinelOneAlertRow,
  MetaCell,
  ResultCode,
  RiskActions,
  descKeyFor,
  stageAlertState,
  type RunDetailPanelProps,
} from './detailParts';
import { StageList } from './StageList';
import { stageOutcomeCounts } from './stageVerdict';

export type { AcceptRiskItem, InfoModalRequest } from './detailParts';

/** First member value for a run-level field (every stage of a run carries the same one). */
function runField<K extends keyof EnrichedTestExecution>(
  controls: EnrichedTestExecution[],
  key: K,
): EnrichedTestExecution[K] | undefined {
  return controls.find((c) => c[key] !== undefined && c[key] !== null)?.[key];
}

/** Description + metadata + stage-attributed Defender/CrowdStrike alerts for one execution. */
function ExecDetailBody({
  exec,
  defenderConfigured,
  crowdstrikeConfigured,
  descriptionMap,
  descriptionLoadingKey,
  alertsMap,
  alertsLoading,
  csAlertsMap,
  csAlertsLoading,
  sentineloneConfigured,
  s1AlertsMap,
  s1AlertsLoading,
  stageAlertsCacheKey,
  onOpenInfo,
}: Pick<
  RunDetailPanelProps,
  | 'defenderConfigured'
  | 'crowdstrikeConfigured'
  | 'sentineloneConfigured'
  | 's1AlertsMap'
  | 's1AlertsLoading'
  | 'descriptionMap'
  | 'descriptionLoadingKey'
  | 'alertsMap'
  | 'alertsLoading'
  | 'csAlertsMap'
  | 'csAlertsLoading'
  | 'stageAlertsCacheKey'
  | 'onOpenInfo'
> & { exec: EnrichedTestExecution }) {
  const isBundleCtrl = exec.is_bundle_control && exec.bundle_id;
  const descKey = descKeyFor(exec);
  const descData = descriptionMap.get(descKey);
  const isLoadingDesc = descriptionLoadingKey === descKey;
  const hasDocumentation = descData && (descData.hasInfoCard || descData.hasReadme);

  const { defender, crowdstrike, sentinelone } = stageAlertState(exec, {
    alertsMap,
    alertsLoading,
    csAlertsMap,
    csAlertsLoading,
    s1AlertsMap,
    s1AlertsLoading,
    stageAlertsCacheKey,
  });

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
          {defender.loading ? (
            <div className="mt-2 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
              <span className="text-xs text-muted">Checking for related alerts...</span>
            </div>
          ) : defender.alerts.length > 0 ? (
            <div className="mt-2 space-y-2">
              {defender.alerts.map((alert) => (
                <DefenderAlertRow key={alert.alert_id} alert={alert} runTimestamp={exec.timestamp} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-faint">
              {defender.hasBundleAlerts
                ? 'No stage-specific Defender alerts. See the bundle-level alerts above.'
                : 'No related Defender alerts within the time window'}
            </p>
          )}
        </div>
      )}

      {/* Related CrowdStrike Alerts — STAGE-ATTRIBUTABLE only. Bundle-level
          alerts render once in the bundle callout instead of being
          duplicated under every stage. */}
      {crowdstrikeConfigured && exec.techniques && exec.techniques.length > 0 && (
        <div className="border-t border-border pt-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
            CrowdStrike Alerts
          </span>
          {crowdstrike.loading ? (
            <div className="mt-2 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
              <span className="text-xs text-muted">Checking for related alerts...</span>
            </div>
          ) : crowdstrike.alerts.length > 0 ? (
            <div className="mt-2 space-y-2">
              {crowdstrike.alerts.map((alert) => (
                <CrowdStrikeAlertRow key={alert.alert_id} alert={alert} runTimestamp={exec.timestamp} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-faint">
              {crowdstrike.hasBundleAlerts
                ? 'No stage-specific CrowdStrike alerts. See the bundle-level alerts above.'
                : 'No related CrowdStrike alerts within the time window'}
            </p>
          )}
        </div>
      )}

      {/* Related SentinelOne Alerts — STAGE-ATTRIBUTABLE only (same rule as CrowdStrike). */}
      {sentineloneConfigured && exec.techniques && exec.techniques.length > 0 && (
        <div className="border-t border-border pt-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
            SentinelOne Alerts
          </span>
          {sentinelone.loading ? (
            <div className="mt-2 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
              <span className="text-xs text-muted">Checking for related alerts...</span>
            </div>
          ) : sentinelone.alerts.length > 0 ? (
            <div className="mt-2 space-y-2">
              {sentinelone.alerts.map((alert) => (
                <SentinelOneAlertRow key={alert.alert_id} alert={alert} runTimestamp={exec.timestamp} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-faint">
              {sentinelone.hasBundleAlerts
                ? 'No stage-specific SentinelOne alerts. See the bundle-level alerts above.'
                : 'No related SentinelOne alerts within the time window'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RunDetailPanel(props: RunDetailPanelProps) {
  const { row, getAcceptanceForExec, archiveEnabled, onRequestArchive } = props;

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
  // Attack-chain runs (every bundle but cyber-hygiene) carry their run-level
  // fields in the header instead of repeating them under each stage.
  const stageRun = row.type === 'bundle' && row.category !== 'cyber-hygiene' ? row : undefined;
  const runTags = stageRun ? runField(stageRun.controls, 'tags') : undefined;
  const runScore = stageRun ? runField(stageRun.controls, 'score') : undefined;
  const runTarget = stageRun ? runField(stageRun.controls, 'target') : undefined;
  const runComplexity = stageRun ? runField(stageRun.controls, 'complexity') : undefined;

  return (
    // min-w-0: a grid/flex item must be allowed to shrink below the strip's width.
    <div className="min-w-0 rounded-lg border border-border bg-surface">
      <div role="region" aria-label="Run summary">
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
          {runTags?.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {runTags.map((tag) => (
                <Badge key={tag} variant="default">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
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
                <ResultCode exec={headerExec} />
              </MetaCell>
              {headerExec.score !== undefined && (
                <MetaCell label="Score">{headerExec.score}/10</MetaCell>
              )}
            </>
          ) : stageRun ? (
            <>
              <div className="col-span-2">
                <MetaCell label="Results">{stageOutcomeCounts(stageRun.controls)}</MetaCell>
              </div>
              {runScore !== undefined && <MetaCell label="Score">{runScore}/10</MetaCell>}
              {runTarget && <MetaCell label="Target">{runTarget}</MetaCell>}
              {runComplexity && <MetaCell label="Complexity">{runComplexity}</MetaCell>}
              <div className="col-span-2">
                <MetaCell label="Test UUID">{stageRun.bundle_id}</MetaCell>
              </div>
            </>
          ) : (
            <MetaCell label="Results">
              <span className="text-faint">
                {(row as BundleGroup).protectedCount}P / {(row as BundleGroup).unprotectedCount}F
              </span>
            </MetaCell>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {row.type === 'standalone' ? (
          <ExecDetailBody {...props} exec={row.execution} />
        ) : (
          <BundleBody {...props} group={row} />
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
    crowdstrikeConfigured,
    alertsMap,
    alertsLoading,
    csAlertsMap,
    csAlertsLoading,
    sentineloneConfigured,
    s1AlertsMap,
    s1AlertsLoading,
    stageAlertsCacheKey,
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

  // Bundle-level CrowdStrike alerts — same union/dedupe pattern as Defender.
  const isLoadingCsAlerts = group.controls.some((ctrl) => csAlertsLoading.has(stageAlertsCacheKey(ctrl)));
  const csSeen = new Map<string, RelatedCrowdStrikeAlertsResponse['alerts'][number]>();
  for (const ctrl of group.controls) {
    const entry = csAlertsMap.get(stageAlertsCacheKey(ctrl));
    if (!entry) continue;
    for (const a of entry.alerts) {
      if (a.attribution === 'bundle') csSeen.set(a.alert_id, a);
    }
  }
  const csBundleAlerts = Array.from(csSeen.values());

  // Bundle-level SentinelOne alerts — same union/dedupe pattern.
  const isLoadingS1Alerts = group.controls.some((ctrl) => Boolean(s1AlertsLoading?.has(stageAlertsCacheKey(ctrl))));
  const s1Seen = new Map<string, RelatedCrowdStrikeAlertsResponse['alerts'][number]>();
  for (const ctrl of group.controls) {
    const entry = s1AlertsMap?.get(stageAlertsCacheKey(ctrl));
    if (!entry) continue;
    for (const a of entry.alerts) {
      if (a.attribution === 'bundle') s1Seen.set(a.alert_id, a);
    }
  }
  const s1BundleAlerts = Array.from(s1Seen.values());


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
                      <PreventionBadge
                        action={alert.prevention_action}
                        rawStatus={alert.remediation_status}
                      />
                      <span className="flex-1 truncate text-foreground">{alert.alert_title}</span>
                      <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                        {alert.status}
                      </Badge>
                      <a
                        href={defenderAlertUrl(alert.portal_url, alert.alert_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-foreground"
                        aria-label="Open in Microsoft Defender"
                        title="Open in Microsoft Defender"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {crowdstrikeConfigured && (isLoadingCsAlerts || csBundleAlerts.length > 0) && (
        <div className="rounded-md border border-warning/40 bg-warning-dim p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium uppercase tracking-wide text-warning">
                Bundle-level CrowdStrike alerts
              </span>
              <span className="ml-2 text-xs text-muted">
                (evidence doesn't identify a specific stage)
              </span>
              {isLoadingCsAlerts ? (
                <div className="mt-1 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-muted" />
                  <span className="text-xs text-muted">Checking…</span>
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  {csBundleAlerts.map((alert) => (
                    <div key={alert.alert_id} className="flex items-center gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={cn('px-1.5 py-0 text-[10px]', ALERT_SEVERITY_CLASSES[alert.severity])}
                      >
                        {alert.severity}
                      </Badge>
                      <PreventionBadge
                      action={alert.prevention_action}
                      rawStatus={alert.pattern_disposition_description}
                    />
                      <span className="flex-1 truncate text-foreground">{alert.alert_title}</span>
                      <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                        {alert.status}
                      </Badge>
                      <a
                        href={falconAlertUrl(alert.portal_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-foreground"
                        aria-label="Open in Falcon console"
                        title="Open in Falcon console"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {sentineloneConfigured && (isLoadingS1Alerts || s1BundleAlerts.length > 0) && (
        <div className="rounded-md border border-warning/40 bg-warning-dim p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium uppercase tracking-wide text-warning">
                Bundle-level SentinelOne alerts
              </span>
              <span className="ml-2 text-xs text-muted">
                (evidence doesn't identify a specific stage)
              </span>
              {isLoadingS1Alerts ? (
                <div className="mt-1 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-muted" />
                  <span className="text-xs text-muted">Checking…</span>
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  {s1BundleAlerts.map((alert) => (
                    <SentinelOneAlertRow key={alert.alert_id} alert={alert} runTimestamp={group.controls[0]?.timestamp ?? ''} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {group.category !== 'cyber-hygiene' ? (
        <StageList {...props} group={group} />
      ) : (
        <CyberHygieneControls {...props} group={group} />
      )}
    </div>
  );
}

/** Cyber-hygiene bundles: protection ratio bar + one row per independent control. */
function CyberHygieneControls({ group, ...props }: RunDetailPanelProps & { group: BundleGroup }) {
  const { expandedControlIndex, onToggleControl } = props;
  const scored = group.controls.filter((c) => !isSkippedStage(c));
  const ratio = scored.length > 0 ? group.protectedCount / scored.length : 0;
  return (
    <>
      {/* Controls header + protection ratio bar */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
          Controls
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
    </>
  );
}
