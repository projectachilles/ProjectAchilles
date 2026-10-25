import type { ExecutionReport, StageOutcome } from '@/services/api/reports';
import { OUTCOME_LABEL } from '../lib/outcomes';
import { GlyphIcon } from '../diagrams/StageGlyph';
import { Sheet, type SheetHead } from './Sheet';

const DEFINITIONS: [StageOutcome, string][] = [
  ['protected', 'The test exited 105, 126 or 127: the security stack blocked or quarantined it.'],
  ['prevented', 'The stage ran (exit 101) and the EDR confirmed it blocked, killed or quarantined it.'],
  ['detected', 'The stage ran and an EDR alert names this stage.'],
  ['unprotected', 'The stage ran and nothing stopped or detected it. Dark red marks exfiltration and impact stages.'],
  ['inconclusive', 'The test could not reach a verdict (for example exit 200, 259, 260 or 999). Excluded from rates.'],
];

const VENDOR_SOURCE: Record<ExecutionReport['meta']['edrVendors'][number], string> = {
  defender: 'Microsoft Defender for Endpoint',
  crowdstrike: 'CrowdStrike Falcon',
  sentinelone: 'SentinelOne Singularity',
};

/** `edrVendors` is meta.edrVendors: the sources and alert-window text name only configured vendors, and are omitted when there are none. */
export function Method({ head, edrVendors = ['defender', 'crowdstrike'] }: { head: SheetHead; edrVendors?: ExecutionReport['meta']['edrVendors'] }) {
  const edr = edrVendors.length > 0;
  return (
    <Sheet label="Method" head={head}>
      <h2 className="rp-h2">Method</h2>
      <dl className="rp-defs">
        {DEFINITIONS.map(([o, text]) => (
          <div key={o}>
            <dt><GlyphIcon outcome={o} />{OUTCOME_LABEL[o]}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <div className="rp-notice">
        <p><b>Defense Score</b> is the dashboard's number for the same filters: conclusive results only, a bundle on an endpoint counts as protected when any of its stages is protected or detected, and accepted risks are excluded.</p>
        <p><b>Stage protection rate</b> is every other percentage in this report: protected, prevented or detected stage results divided by conclusive stage results. Skipped bundle stages (exit 0) are not results.</p>
        <p>
          <b>Sources.</b> Stage results come from the ProjectAchilles agent.
          {edr && ` EDR alerts come from ${edrVendors.map((v) => VENDOR_SOURCE[v]).join(' and ')}, matched to a run by test binary, endpoint and a window from 5 minutes before to 30 minutes after the run completed.`}
        </p>
        <p>
          <b>Limits.</b> Stages within a run are not timed individually; every stage carries the run's completion time.
          {edr && ' Alerts raised more than 5 minutes before a long run completed can fall outside the window, as in the console.'}
          {' '}Archived executions are not included.
        </p>
      </div>
    </Sheet>
  );
}
