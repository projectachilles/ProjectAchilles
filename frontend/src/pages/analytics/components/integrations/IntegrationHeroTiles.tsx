// Hero tiles shared by the CrowdStrike and Defender tabs: vendor alerts and
// Detected / Prevented. Both read data the tab already fetched for its window.

import { Bell, Crosshair } from 'lucide-react';
import type {
  IntegrationAlertSummary,
  IntegrationTrendPoint,
  TechniqueCoverageResponse,
  TimeWindow,
} from '@/services/api/integrationTypes';
import { getSeverityTokens } from '../../utils/crowdstrikeSeverityTokens';
import HeroStatTile from '../HeroStatTile';
import CoveragePips from '../CoveragePips';
import { groupSeverities } from './severity';
import { alertWeekDelta, coverageScopePhrase, inverseDeltaTone, scrollToAlertFeed } from './heroMetrics';
import type { IntegrationVendor } from './vendorConfig';

const LINKED = 'var(--chart-series-alert)';
const PREVENTED = 'var(--chart-series-exec)';

interface AlertsHeroTileProps {
  vendor: IntegrationVendor;
  summary: IntegrationAlertSummary | null;
  trend: IntegrationTrendPoint[];
  window: TimeWindow;
  loading: boolean;
  failed: boolean;
  windowLabel: string;
}

/** "in last 30 days" / "in selected range"; "all time" stands alone. */
function windowPhrase(windowLabel: string): string {
  return windowLabel === 'all time' ? windowLabel : `in ${windowLabel}`;
}

/** In-window alert count, severity micro-bar, linked/organic split, 7-day delta. Click scrolls to the feed. */
export function AlertsHeroTile({ vendor, summary, trend, window, loading, failed, windowLabel }: AlertsHeroTileProps) {
  const counts = summary?.counts;
  const groups = counts
    ? groupSeverities(counts.bySeverity, vendor.knownSeverities).filter((g) => g.count > 0)
    : [];
  const delta = alertWeekDelta(trend, window);

  return (
    <HeroStatTile
      title={vendor.alertsTitle}
      icon={<Bell className="w-4 h-4 text-primary" />}
      value={counts ? counts.bySource.all.toLocaleString() : '—'}
      subValue={
        counts ? (
          <span className="flex flex-col gap-0.5">
            <span>{windowPhrase(windowLabel)}</span>
            <span>
              <span style={{ color: LINKED }}>{counts.bySource.test.toLocaleString()} linked to tests</span>
              {` · ${counts.bySource.organic.toLocaleString()} organic`}
            </span>
          </span>
        ) : undefined
      }
      chartSlot={
        groups.length > 0 ? (
          <div className="w-full space-y-1">
            <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {groups.map((g) => (
                <span key={g.key} className={getSeverityTokens(g.key).bar} style={{ flex: `${g.count} 1 0` }} />
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              {groups.map((g) => `${g.count.toLocaleString()} ${g.label.toLowerCase()}`).join(' · ')}
            </div>
          </div>
        ) : undefined
      }
      delta={delta}
      deltaTone={inverseDeltaTone(delta)}
      deltaLabel="vs prev 7d"
      loading={loading}
      error={failed ? 'Alert summary unavailable' : undefined}
      onClick={scrollToAlertFeed}
    />
  );
}

interface CoverageHeroTileProps {
  vendor: IntegrationVendor;
  coverage: TechniqueCoverageResponse | null;
  loading: boolean;
  failed: boolean;
  windowLabel: string;
}

/**
 * Detected / Prevented, from the same Technique Coverage response as the
 * coverage card (spec D1), so the two cannot disagree. Counts only the hosts
 * the EDR covers (`coverage.scope`), and runs it stopped at launch or by
 * killing the agent count as stopped.
 */
export function CoverageHeroTile({ vendor, coverage, loading, failed, windowLabel }: CoverageHeroTileProps) {
  const o = coverage?.overall;
  const scopePhrase = coverageScopePhrase(coverage?.scope, vendor.shortName);
  const pips = (coverage?.byTechnique ?? []).map((t) => ({
    technique: t.technique,
    detected: t.prevented + t.detectedOnly > 0,
  }));
  const detectedPips = pips.filter((p) => p.detected).length;
  const rate = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—');

  return (
    <HeroStatTile
      title="Detected / Prevented"
      icon={<Crosshair className="w-4 h-4 text-primary" />}
      value={rate(o?.detectionRate)}
      valueSuffix="%"
      secondaryValue={
        o ? (
          <span className="inline-flex items-baseline gap-0.5" style={{ color: PREVENTED }}>
            <span className="text-2xl font-semibold tabular-nums">{rate(o.preventionRate)}</span>
            <span className="text-sm">% prevented</span>
          </span>
        ) : undefined
      }
      subValue={
        o ? (
          <span className="flex flex-col gap-0.5">
            <span>{windowPhrase(windowLabel)}</span>
            <span>
              {`${(o.prevented + o.detectedOnly).toLocaleString()} / ${o.executions.toLocaleString()} test results raised an alert · ${o.prevented.toLocaleString()} were stopped`}
            </span>
            {scopePhrase && <span>{scopePhrase}</span>}
          </span>
        ) : undefined
      }
      chartSlot={
        pips.length > 0 ? (
          <div className="w-full space-y-1">
            <CoveragePips items={pips} />
            <div className="text-xs text-muted-foreground">
              {detectedPips} of {pips.length} techniques drew an alert
            </div>
          </div>
        ) : undefined
      }
      loading={loading}
      error={failed ? 'Technique coverage unavailable' : undefined}
      emptyState={o && o.executions === 0 ? `No test executions in ${windowLabel}` : undefined}
    />
  );
}
