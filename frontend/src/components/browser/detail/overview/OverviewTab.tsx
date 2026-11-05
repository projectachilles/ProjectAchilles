import type { BuildInfoState } from '@/components/browser/detail/useBuildInfo';
import type { ReactNode } from 'react';
import type { TestDetails } from '@/types/test';
import type { TestFleetStage } from '@/services/api/analytics';
import type { TestTabId } from '../testTabs';
import StageChain, { type StagePillData } from './StageChain';
import OutcomesPanel from './OutcomesPanel';
import SafetyPanel from './SafetyPanel';
import QualityPanel from './QualityPanel';
import DetectionPanel from './DetectionPanel';
import SourcePanel from './SourcePanel';
import ControlGrid from './ControlGrid';
import WhatItDoesCard from './WhatItDoesCard';
import DeployPanel from './DeployPanel';
import FleetPanel from './FleetPanel';
import { mapFleetToPills } from './fleetPills';
import { useTestFleet } from '../useTestFleet';
import ShipsWithPanel from './ShipsWithPanel';

interface OverviewTabProps {
  test: TestDetails;
  canBuild: boolean;
  build: BuildInfoState;
  onOpenFile: (tab: TestTabId, file: string) => void;
}

const LABEL = 'mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted';

export default function OverviewTab({ test, canBuild, build, onOpenFile }: OverviewTabProps) {
  const files = test.files ?? [];
  const ov = test.overview ?? {};
  const hasSource = files.some((f) => f.category === 'source');
  const showDeploy = canBuild && hasSource;
  const showShipsWith = files.some((f) => f.category === 'detection' || f.category === 'defense');
  const techniques = test.techniques ?? [];
  const validators = test.validatorDescriptions ?? {};

  const pills: Record<number, StagePillData> = {};
  for (const s of ov.labStageOutcomes ?? []) {
    pills[s.stage] = { lab: `${s.outcome} in lab` };
  }

  const { data: fleet } = useTestFleet(test.uuid);
  const hasFleet = !!fleet && fleet.headline.pairCount > 0;
  const isHygiene = test.category === 'cyber-hygiene';
  const isChain = !isHygiene && test.isMultiStage && test.stages.length > 0;

  // Fleet pills replace lab pills for stages with a fleet row.
  let earlier: TestFleetStage[] = [];
  if (hasFleet && isChain) {
    const mapped = mapFleetToPills(test.stages, fleet.stages);
    Object.assign(pills, mapped.pills);
    earlier = mapped.earlier;
  }

  let chain: ReactNode;
  if (isHygiene && (Object.keys(validators).length > 0 || (hasFleet && fleet.stages.length > 0))) {
    chain = <ControlGrid validators={validators} fleet={hasFleet ? fleet.stages : undefined} />;
  } else if (isChain) {
    chain = (
      <section>
        <h2 className={LABEL}>Stages</h2>
        {hasFleet && fleet.stoppedBeforeStage > 0 && (
          <p className="mb-2 text-[13px] text-muted">
            {`${fleet.stoppedBeforeStage} hosts stopped before any stage ran (EDR killed / blocked at launch)`}
          </p>
        )}
        <StageChain stages={test.stages} pills={pills} budgetsSec={ov.stageBudgetsSec} />
        {earlier.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Earlier stages</h3>
            <ul className="space-y-1">
              {earlier.map((r) => (
                <li key={r.controlId} className="flex flex-wrap items-baseline gap-x-3 text-[11px] text-muted">
                  <span className="font-mono text-xs text-faint">{r.controlId}</span>
                  <span>{`${r.blocked} blocked · ${r.detected} detected · ${r.through} through`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  } else {
    chain = <WhatItDoesCard techniques={techniques} />;
  }

  const infoFile = files.find((f) => f.name.endsWith('_info.md'))?.name;
  const hasTwoCol = (ov.expectedOutcomes?.length ?? 0) > 0 || (ov.safety?.length ?? 0) > 0;

  const main = (
    <div className="min-w-0 space-y-6">
      {test.description && (
        <section>
          <h2 className={LABEL}>Summary</h2>
          <p className="max-w-[72ch] text-sm leading-relaxed text-foreground">{test.description}</p>
        </section>
      )}
      {chain}
      {hasTwoCol && (
        <div className="grid gap-4 md:grid-cols-2">
          <OutcomesPanel outcomes={ov.expectedOutcomes} />
          <SafetyPanel
            safety={ov.safety}
            source={ov.safetySource}
            onOpenFull={() => ov.safetySource && onOpenFile('readme', ov.safetySource)}
          />
        </div>
      )}
      <DetectionPanel audit={ov.detectionAudit} onOpenAll={infoFile ? () => onOpenFile('info', infoFile) : undefined} />
    </div>
  );

  const showFleet = hasFleet;
  const showQuality = !!ov.quality;
  const showSource = !!ov.primarySource;
  if (!showFleet && !showDeploy && !showShipsWith && !showQuality && !showSource) return main;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {main}
      <aside className="min-w-0 space-y-4">
        <DeployPanel uuid={test.uuid} canBuild={canBuild} hasSource={hasSource} build={build} />
        {hasFleet && <FleetPanel testName={test.name} headline={fleet.headline} cyberHygiene={isHygiene} />}
        <QualityPanel quality={ov.quality} />
        <ShipsWithPanel test={test} onOpen={onOpenFile} />
        <SourcePanel source={ov.primarySource} />
      </aside>
    </div>
  );
}
