import { useId } from 'react';
import { ChevronDown, ChevronRight, Info, Loader2 } from 'lucide-react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import { cn } from '@/lib/utils';
import { AttackChainStrip } from './AttackChainStrip';
import {
  CrowdStrikeAlertRow,
  SentinelOneAlertRow,
  DefenderAlertRow,
  ResultCode,
  RiskActions,
  descKeyFor,
  stageAlertState,
  type RunDetailPanelProps,
} from './detailParts';
import { StageOutcomeLabel, stageNumber, stageTechnique, stageTone } from './stageDisplay';
import { stageVendors, stageVerdict } from './stageVerdict';
import type { BundleGroup } from './shared';

type StageViewProps = Omit<RunDetailPanelProps, 'row' | 'archiveEnabled' | 'onRequestArchive'>;

function StageField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 break-words text-xs text-foreground">{children}</div>
    </div>
  );
}

/** Stage-attributed Defender + CrowdStrike + SentinelOne alerts as one list. */
function StageEvidence({ exec, ...props }: StageViewProps & { exec: EnrichedTestExecution }) {
  const { defenderConfigured, crowdstrikeConfigured, sentineloneConfigured } = props;
  if ((!defenderConfigured && !crowdstrikeConfigured && !sentineloneConfigured) || !exec.techniques?.length) return null;

  const { defender, crowdstrike, sentinelone } = stageAlertState(exec, props);
  const defAlerts = defenderConfigured ? defender.alerts : [];
  const csAlerts = crowdstrikeConfigured ? crowdstrike.alerts : [];
  const s1Alerts = sentineloneConfigured ? sentinelone.alerts : [];
  const loading = (defenderConfigured && defender.loading)
    || (crowdstrikeConfigured && crowdstrike.loading)
    || (sentineloneConfigured && sentinelone.loading);
  const vendors = [defenderConfigured && 'Defender', crowdstrikeConfigured && 'CrowdStrike', sentineloneConfigured && 'SentinelOne']
    .filter(Boolean)
    .join(' or ');
  const hasBundleAlerts =
    (defenderConfigured && defender.hasBundleAlerts)
    || (crowdstrikeConfigured && crowdstrike.hasBundleAlerts)
    || (sentineloneConfigured && sentinelone.hasBundleAlerts);

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-faint">
        EDR evidence for this stage
      </div>
      {(defAlerts.length > 0 || csAlerts.length > 0 || s1Alerts.length > 0) && (
        <div className="flex flex-col gap-1.5">
          {csAlerts.map((alert) => (
            <CrowdStrikeAlertRow key={alert.alert_id} alert={alert} runTimestamp={exec.timestamp} vendor="CrowdStrike" />
          ))}
          {s1Alerts.map((alert) => (
            <SentinelOneAlertRow key={alert.alert_id} alert={alert} runTimestamp={exec.timestamp} vendor="SentinelOne" />
          ))}
          {defAlerts.map((alert) => (
            <DefenderAlertRow key={alert.alert_id} alert={alert} runTimestamp={exec.timestamp} vendor="Defender" />
          ))}
        </div>
      )}
      {loading ? (
        <div className="mt-1 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
          <span className="text-xs text-muted">Checking for related alerts...</span>
        </div>
      ) : (
        defAlerts.length === 0 &&
        csAlerts.length === 0 &&
        s1Alerts.length === 0 && (
          <p className="text-xs text-faint">
            No {vendors} alert names this stage's binary.
            {hasBundleAlerts && ' See the bundle-level alerts above.'}
          </p>
        )
      )}
    </div>
  );
}

/** Expanded stage: verdict, result code / technique / tactic, what it does, EDR evidence, actions. */
function StageDetail({
  exec,
  siblings,
  id,
  n,
  ...props
}: StageViewProps & { exec: EnrichedTestExecution; siblings: EnrichedTestExecution[]; id: string; n: number }) {
  const { descriptionMap, descriptionLoadingKey, onOpenInfo } = props;
  const verdict = stageVerdict(exec, siblings);
  const tone = stageTone(exec);
  const technique = stageTechnique(exec);
  const descKey = descKeyFor(exec);
  const descData = descriptionMap.get(descKey);
  const hasDocumentation =
    descriptionLoadingKey !== descKey && descData && (descData.hasInfoCard || descData.hasReadme);

  return (
    <div
      id={id}
      role="region"
      aria-label={`Stage ${n} details`}
      className="mb-1 ml-3 mt-1.5 flex flex-col gap-3.5 rounded-md border border-border bg-background/40 p-3.5 sm:ml-8"
    >
      <div className={cn('rounded-md border px-3 py-2.5', tone.dim, tone.border)}>
        <div className="text-sm font-semibold text-foreground">{verdict.title}</div>
        <div className="mt-1 text-sm leading-relaxed text-muted">{verdict.body}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StageField label="Result code">
          <span className="font-mono">
            <ResultCode exec={exec} />
          </span>
        </StageField>
        {technique && (
          <StageField label="Technique">
            {technique.url ? (
              <a
                href={technique.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                <span className="font-mono">{technique.id}</span> {technique.name}
              </a>
            ) : (
              <span className="font-mono">{technique.id}</span>
            )}
          </StageField>
        )}
        {exec.tactics?.length ? <StageField label="Tactic">{exec.tactics.join(', ')}</StageField> : null}
      </div>

      {exec.control_description && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-faint">What this stage does</div>
          <p className="mt-1 break-words text-sm leading-relaxed text-muted">{exec.control_description}</p>
        </div>
      )}

      <StageEvidence {...props} exec={exec} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasDocumentation && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenInfo({
                testUuid: exec.bundle_id ?? exec.test_uuid,
                testName: exec.test_name || exec.bundle_name || 'Test Details',
                hasInfoCard: descData.hasInfoCard,
                hasReadme: descData.hasReadme,
                scrollToValidator: exec.control_validator,
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-dim px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-dim/70"
          >
            <Info className="h-3.5 w-3.5" />
            View test details
          </button>
        )}
        <RiskActions {...props} exec={exec} />
      </div>
    </div>
  );
}

/**
 * Stage view for a non-cyber-hygiene bundle: the attack-chain strip, then one
 * row per stage. The strip and the rows share the expanded index, so picking a
 * node opens its row. Members arrive in stage order from the backend.
 */
export function StageList({ group, ...props }: StageViewProps & { group: BundleGroup }) {
  const { expandedControlIndex, onToggleControl } = props;
  const baseId = useId();
  const stages = group.controls;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-faint">Attack chain</div>
        <AttackChainStrip
          stages={stages}
          selectedIndex={expandedControlIndex}
          onSelect={(index) => onToggleControl(index, stages[index])}
        />
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-faint">Stages</div>
        <ol aria-label="Stages" className="flex flex-col gap-1.5">
          {stages.map((exec, index) => {
            const expanded = expandedControlIndex === index;
            const n = stageNumber(exec, index);
            const tone = stageTone(exec);
            const technique = stageTechnique(exec);
            const vendors = stageVendors(exec);
            const detailId = `${baseId}-stage-${index}`;
            const tactic = exec.tactics?.length ? exec.tactics.join(', ') : undefined;
            return (
              <li key={`${group.key}::ctrl-${index}`}>
                <button
                  type="button"
                  onClick={() => onToggleControl(index, exec)}
                  aria-expanded={expanded}
                  aria-controls={expanded ? detailId : undefined}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-2.5 rounded-md border border-border bg-raised px-3 py-2 text-left transition-colors hover:bg-overlay',
                    expanded && 'border-border-strong bg-overlay',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px]',
                      tone.dim,
                      tone.text,
                    )}
                  >
                    {n}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] text-foreground">{exec.test_name}</span>
                    {(technique || tactic) && (
                      <span className="truncate text-xs text-faint">
                        {technique && <span className="font-mono text-muted">{technique.id}</span>}
                        {technique?.name && ` · ${technique.name}`}
                        {tactic && `${technique ? ' · ' : ''}${tactic}`}
                      </span>
                    )}
                  </span>
                  {vendors && (
                    <span
                      className="shrink-0 whitespace-nowrap rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-muted"
                      title={`${vendors.label} raised an alert naming this stage`}
                    >
                      {vendors.short} alert
                    </span>
                  )}
                  <span className="shrink-0">
                    <StageOutcomeLabel exec={exec} />
                  </span>
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                  )}
                </button>
                {expanded && (
                  <StageDetail {...props} exec={exec} siblings={stages} id={detailId} n={n} />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
