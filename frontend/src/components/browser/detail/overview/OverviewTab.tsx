import type { BuildInfoState } from '@/components/browser/detail/useBuildInfo';
import type { ReactNode } from 'react';
import type { TestDetails } from '@/types/test';
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

  let chain: ReactNode;
  if (test.category === 'cyber-hygiene' && Object.keys(validators).length > 0) {
    chain = <ControlGrid validators={validators} />;
  } else if (test.category !== 'cyber-hygiene' && test.isMultiStage && test.stages.length > 0) {
    chain = (
      <section>
        <h2 className={LABEL}>Stages</h2>
        <StageChain stages={test.stages} pills={pills} budgetsSec={ov.stageBudgetsSec} />
      </section>
    );
  } else {
    chain = <WhatItDoesCard techniques={techniques} />;
  }

  const infoFile = files.find((f) => f.name.endsWith('_info.md'))?.name ?? '';
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
      <DetectionPanel audit={ov.detectionAudit} onOpenAll={() => onOpenFile('info', infoFile)} />
    </div>
  );

  const showQuality = !!ov.quality;
  const showSource = !!ov.primarySource;
  if (!showDeploy && !showShipsWith && !showQuality && !showSource) return main;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {main}
      <aside className="min-w-0 space-y-4">
        <DeployPanel uuid={test.uuid} canBuild={canBuild} hasSource={hasSource} build={build} />
        {/* Fleet panel slot (fleet PR): intentionally empty for now. */}
        <QualityPanel quality={ov.quality} />
        <ShipsWithPanel test={test} onOpen={onOpenFile} />
        <SourcePanel source={ov.primarySource} />
      </aside>
    </div>
  );
}
