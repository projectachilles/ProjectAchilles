import TechniqueBadge from '@/components/browser/TechniqueBadge';
import type { BuildInfoState } from '@/components/browser/detail/useBuildInfo';
import type { TestDetails } from '@/types/test';
import type { TestTabId } from '../testTabs';
import StageChain from './StageChain';
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
  const hasSource = files.some((f) => f.category === 'source');
  const showDeploy = canBuild && hasSource;
  const showShipsWith = files.some((f) => f.category === 'detection' || f.category === 'defense');
  const showChain = test.isMultiStage && test.stages.length > 0;
  const techniques = test.techniques ?? [];

  const main = (
    <div className="min-w-0 space-y-6">
      {test.description && (
        <section>
          <h2 className={LABEL}>Summary</h2>
          <p className="max-w-[72ch] text-sm leading-relaxed text-foreground">{test.description}</p>
        </section>
      )}
      {showChain ? (
        <section>
          <h2 className={LABEL}>Stages</h2>
          <StageChain stages={test.stages} />
        </section>
      ) : techniques.length > 0 && (
        <section>
          <h2 className={LABEL}>Techniques</h2>
          <div className="flex flex-wrap gap-1.5">
            {techniques.map((t) => <TechniqueBadge key={t} technique={t} size="sm" />)}
          </div>
        </section>
      )}
    </div>
  );

  if (!showDeploy && !showShipsWith) return main;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {main}
      <aside className="min-w-0 space-y-4">
        <DeployPanel uuid={test.uuid} canBuild={canBuild} hasSource={hasSource} build={build} />
        <ShipsWithPanel test={test} onOpen={onOpenFile} />
      </aside>
    </div>
  );
}
