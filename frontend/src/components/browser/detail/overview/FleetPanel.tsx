import { Link } from 'react-router-dom';
import type { TestFleetResponse } from '@/services/api/analytics';
import { formatRelativeDate } from '@/utils/dateFormatters';
import Panel from './Panel';

interface FleetPanelProps {
  testName: string;
  headline: TestFleetResponse['headline'];
  cyberHygiene: boolean;
}

const R = 20;
const C = 2 * Math.PI * R;

export default function FleetPanel({ testName, headline, cyberHygiene }: FleetPanelProps) {
  const { hostCount, pairCount, stoppedCount, lastRunAt } = headline;
  if (pairCount <= 0) return null;
  const share = Math.min(Math.max(stoppedCount / pairCount, 0), 1);
  const text = cyberHygiene
    ? `${stoppedCount} of ${pairCount} control checks passing on ${hostCount} hosts`
    : `chain stopped on ${stoppedCount} of ${pairCount} hosts`;
  return (
    <Panel
      title="Fleet results"
      action={
        <Link to={`/analytics?tests=${encodeURIComponent(testName)}`} className="text-[13px] text-accent hover:underline">
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
