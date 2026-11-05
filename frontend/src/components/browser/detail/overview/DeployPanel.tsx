import BuildSection from '@/components/browser/BuildSection';
import type { BuildInfoState } from '@/components/browser/detail/useBuildInfo';
import Panel from './Panel';

interface DeployPanelProps {
  uuid: string;
  /** `tests:builds:create`. */
  canBuild: boolean;
  /** The test has Go source to build. */
  hasSource: boolean;
  /** The page's single build state, shared with the header's Download. */
  build: BuildInfoState;
}

export default function DeployPanel({ uuid, canBuild, hasSource, build }: DeployPanelProps) {
  return (
    <Panel title="Deploy" hidden={!canBuild || !hasSource}>
      <BuildSection uuid={uuid} build={build} />
    </Panel>
  );
}
