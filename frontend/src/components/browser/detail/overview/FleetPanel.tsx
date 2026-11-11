import { Link } from 'react-router-dom';
import type { TestFleetResponse } from '@/services/api/analytics';
import { formatRelativeDate } from '@/utils/dateFormatters';
import Panel from './Panel';
import { hosts } from '../plural';
import { joinFilterList } from '@/lib/filterList';

/** How the headline reads: a stage chain, a cyber-hygiene bundle, or a standalone test. */
export type FleetKind = 'chain' | 'hygiene' | 'standalone';

interface FleetPanelProps {
  testName: string;
  headline: TestFleetResponse['headline'];
  kind: FleetKind;
}

/** The fleet route covers 90 days; the Analytics link opens the same window. */
const WINDOW = '90d';

const R = 20;
const C = 2 * Math.PI * R;

export default function FleetPanel({ testName, headline, kind }: FleetPanelProps) {
  const { hostCount, pairCount, stoppedCount, lastRunAt } = headline;
  if (pairCount <= 0) return null;
  const share = Math.min(Math.max(stoppedCount / pairCount, 0), 1);
  const text =
    kind === 'hygiene'
      ? `${stoppedCount} of ${pairCount} control checks passing on ${hosts(hostCount)}`
      : `${kind === 'chain' ? 'chain ' : ''}stopped on ${stoppedCount} of ${hosts(pairCount)}`;
  return (
    <Panel
      title="On your fleet · 90 d"
      action={
        <Link to={`/analytics?tests=${encodeURIComponent(joinFilterList([testName]))}&date=${WINDOW}`} className="text-[13px] text-accent hover:underline">
          Analytics →
        </Link>
      }
    >
      <div className="flex items-center gap-3">
        <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden className="shrink-0 -rotate-90">
          <circle cx="24" cy="24" r={R} fill="none" strokeWidth="6" stroke="var(--chart-bypassed)" />
          <circle
            cx="24" cy="24" r={R} fill="none" strokeWidth="6" stroke="var(--chart-protected)"
            strokeDasharray={`${share * C} ${C}`}
          />
        </svg>
        <div className="min-w-0">
          <p className="text-sm text-foreground">{text}</p>
          {lastRunAt && <p className="mt-0.5 text-[11px] text-faint">{`last run ${formatRelativeDate(lastRunAt)}`}</p>}
        </div>
      </div>
    </Panel>
  );
}
