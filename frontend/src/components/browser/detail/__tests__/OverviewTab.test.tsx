import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TestDetails, TestOverview } from '@/types/test';
import type { BuildInfoState } from '../useBuildInfo';

vi.mock('../overview/DeployPanel', () => ({ default: () => <div>deploy-panel</div> }));
// No fleet support: keeps the suite off the network (useTestFleet never fetches).
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ loaded: true, testFleet: false }) }));

const { default: OverviewTab } = await import('../overview/OverviewTab');

const build = {} as BuildInfoState;

const fullOverview: TestOverview = {
  expectedOutcomes: [
    { label: 'Blocked', code: 126, text: 'EDR quarantines the dropper' },
    { label: 'Unprotected', code: 101, text: 'Payload runs to completion' },
    { label: 'Error', code: 999, text: 'Test could not run' },
    { label: 'Note', text: 'No code here' },
  ],
  safety: ['Runs only in C:\\F0', 'Cleans up artifacts'],
  safetySource: 'SAFETY.md',
  quality: { rubric: 'v2.1', realism: 5.7, structure: 3, validation: 'Validated in lab' },
  detectionAudit: Array.from({ length: 16 }, (_, i) => ({
    stage: (i % 3) + 1, primitive: `prim-${i}`, sensor: 'EDR', pattern: `pat-${i}`,
  })),
  labStageOutcomes: [
    { stage: 1, outcome: 'blocked', detail: 'x' },
    { stage: 2, outcome: 'ran', detail: 'y' },
  ],
  primarySource: { title: 'Qilin report', url: 'https://example.com/r', publisher: 'Vendor', date: '2026-01-01' },
  stageBudgetsSec: { 1: 30, 2: 45 },
};

function make(over: Partial<TestDetails> = {}): TestDetails {
  return {
    uuid: 'u-1', name: 'Test', category: 'intel-driven', techniques: ['T1486'],
    isMultiStage: true,
    stages: [
      { stageId: 1, technique: 'T1059', name: 'Stage one', fileName: 'a.go' },
      { stageId: 2, technique: 'T1486', name: 'Stage two', fileName: 'b.go' },
    ],
    description: 'A summary',
    files: [
      { name: 'x.go', path: 'x.go', type: 'go', size: 1, category: 'source' },
      { name: 'rules.kql', path: 'rules.kql', type: 'kql', size: 1, category: 'detection' },
      { name: 'u-1_info.md', path: 'u-1_info.md', type: 'markdown', size: 1, category: 'documentation' },
    ],
    hasAttackFlow: false, hasKillChain: false, hasReadme: true, hasInfoCard: true,
    hasSafetyDoc: true, hasDetectionFiles: true, hasDefenseGuidance: false, hasReferences: false,
    overview: fullOverview,
    ...over,
  } as TestDetails;
}

const renderTab = (test: TestDetails, onOpenFile = vi.fn()) =>
  render(<OverviewTab test={test} canBuild build={build} onOpenFile={onOpenFile} />);

describe('OverviewTab panels', () => {
  it('renders all seven panels for a full overview', () => {
    renderTab(make());
    for (const t of ['Expected outcomes', 'Safety', 'Detection', 'Quality', 'Source', 'Ships with']) {
      expect(screen.getByRole('heading', { level: 2, name: t })).toBeInTheDocument();
    }
    expect(screen.getByText('deploy-panel')).toBeInTheDocument();
    expect(screen.getByText('A summary')).toBeInTheDocument();
  });

  it('renders only summary, Deploy and Ships with for an empty overview', () => {
    renderTab(make({ overview: {} }));
    expect(screen.getByText('A summary')).toBeInTheDocument();
    expect(screen.getByText('deploy-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ships with' })).toBeInTheDocument();
    for (const t of ['Expected outcomes', 'Safety', 'Detection', 'Quality', 'Source']) {
      expect(screen.queryByRole('heading', { level: 2, name: t })).not.toBeInTheDocument();
    }
  });

  it('colours outcome codes by meaning', () => {
    renderTab(make());
    expect(screen.getByText('126').className).toContain('text-accent');
    expect(screen.getByText('101').className).toContain('text-danger');
    expect(screen.getByText('999').className).toContain('text-warning');
  });

  it('shows top 4 detection rows and an All n link that opens the info tab', async () => {
    const onOpen = vi.fn();
    renderTab(make(), onOpen);
    expect(screen.getByText('pat-3')).toBeInTheDocument();
    expect(screen.queryByText('pat-4')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /All 16/ }));
    expect(onOpen).toHaveBeenCalledWith('info', 'u-1_info.md');
  });

  it('opens the safety source from Full safety', async () => {
    const onOpen = vi.fn();
    renderTab(make(), onOpen);
    await userEvent.click(screen.getByRole('button', { name: /Full safety/ }));
    expect(onOpen).toHaveBeenCalledWith('readme', 'SAFETY.md');
  });

  it('shows v2.1 quality bars', () => {
    renderTab(make());
    expect(screen.getByText('5.7 / 7')).toBeInTheDocument();
    expect(screen.getByText('3.0 / 3')).toBeInTheDocument();
    expect(screen.getByText('Validated in lab')).toBeInTheDocument();
  });

  it('shows legacy quality breakdown rows, skipping empty fields', () => {
    renderTab(make({ overview: { quality: { rubric: 'legacy', breakdown: { realWorldAccuracy: 2.5, safetyMechanisms: 1 } } } }));
    expect(screen.getByText('Real-world accuracy')).toBeInTheDocument();
    expect(screen.getByText('Safety mechanisms')).toBeInTheDocument();
    expect(screen.queryByText('Logging & observability')).not.toBeInTheDocument();
  });

  it('gives multi-stage tests a StageChain with lab pills and budgets', () => {
    renderTab(make());
    expect(screen.getByRole('list', { name: 'Stages' })).toBeInTheDocument();
    expect(screen.getByText('blocked in lab')).toBeInTheDocument();
    expect(screen.getByText('ran in lab')).toBeInTheDocument();
    expect(screen.getByText('30 s budget')).toBeInTheDocument();
  });

  it('gives cyber-hygiene tests a ControlGrid and no StageChain', () => {
    renderTab(make({
      category: 'cyber-hygiene',
      validatorDescriptions: { 'validator-defender': 'Checks Defender settings' },
    }));
    expect(screen.getByText('validator-defender')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Stages' })).not.toBeInTheDocument();
  });

  it('gives single-binary tests the technique card', () => {
    renderTab(make({ isMultiStage: false, stages: [], overview: {} }));
    expect(screen.getByRole('heading', { name: 'What it does' })).toBeInTheDocument();
    expect(screen.getByText('T1486')).toBeInTheDocument();
  });

  it('shows test techniques no stage card shows in a Techniques row', () => {
    renderTab(make({ techniques: ['T1486', 'T1003.001'] }));
    const row = screen.getByRole('region', { name: 'Techniques' });
    expect(within(row).getByText('T1003.001')).toBeInTheDocument();
    expect(within(row).queryByText('T1486')).not.toBeInTheDocument();
    expect(screen.getAllByText('T1486')).toHaveLength(1);
  });

  it('hides the Techniques row when every technique is on a stage card', () => {
    renderTab(make({ techniques: ['T1486', 'T1059'] }));
    expect(screen.queryByRole('region', { name: 'Techniques' })).not.toBeInTheDocument();
  });

  it('shows all test techniques for a cyber-hygiene ControlGrid', () => {
    renderTab(make({
      category: 'cyber-hygiene', isMultiStage: false, stages: [], techniques: ['T1110', 'T1562.001'],
      validatorDescriptions: { Defender: 'Checks Defender settings' },
    }));
    const row = screen.getByRole('region', { name: 'Techniques' });
    expect(within(row).getByText('T1110')).toBeInTheDocument();
    expect(within(row).getByText('T1562.001')).toBeInTheDocument();
  });

  it('does not add a Techniques row next to the What it does card', () => {
    renderTab(make({ isMultiStage: false, stages: [], overview: {} }));
    expect(screen.queryByRole('region', { name: 'Techniques' })).not.toBeInTheDocument();
  });

  it('gives a lone Outcomes or Safety panel the full width', () => {
    renderTab(make({ overview: { safety: ['Only safety'] } }));
    const grid = screen.getByRole('heading', { name: 'Safety' }).closest('section')!.parentElement!;
    expect(grid.className).not.toContain('md:grid-cols-2');
  });

  it('puts Outcomes and Safety side by side when both render', () => {
    renderTab(make());
    const grid = screen.getByRole('heading', { name: 'Safety' }).closest('section')!.parentElement!;
    expect(grid.className).toContain('md:grid-cols-2');
  });

  it('does not link a javascript: primary source', () => {
    renderTab(make({ overview: { primarySource: { title: 'Evil', url: 'javascript:alert(1)' } } }));
    expect(screen.getByText('Evil')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Evil' })).not.toBeInTheDocument();
  });

  it('links an https primary source', () => {
    renderTab(make());
    expect(screen.getByRole('link', { name: 'Qilin report' })).toHaveAttribute('href', 'https://example.com/r');
  });

  it('omits quality bars with non-finite values without throwing', () => {
    renderTab(make({ overview: { quality: { rubric: 'v2.1', realism: 5.7, structure: NaN } } }));
    expect(screen.getByText('5.7 / 7')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText('Structure')).not.toBeInTheDocument();
  });

  it('hides All n when there is no info card file', () => {
    const t = make();
    t.files = t.files.filter((f) => !f.name.endsWith('_info.md'));
    renderTab(t);
    expect(screen.getByRole('heading', { level: 2, name: 'Detection' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /All 16/ })).not.toBeInTheDocument();
  });
});
