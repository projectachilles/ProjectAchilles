import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { StageInfo } from '@/types/test';

const { default: StageChain } = await import('../overview/StageChain');

function stages(n: number): StageInfo[] {
  // Deliberately out of order: the chain sorts by stageId.
  return Array.from({ length: n }, (_, i) => n - i).map((id) => ({
    stageId: id,
    technique: `T10${id}`,
    techniques: [`T10${id}`, ...(id === 2 ? ['T1059.001'] : [])],
    name: `Stage name ${id}`,
    fileName: `stage-T10${id}.go`,
  }));
}

describe('StageChain', () => {
  it('renders one card per stage, in stage order, with technique chips', () => {
    render(<StageChain stages={stages(5)} />);
    const list = screen.getByRole('list', { name: 'Stages' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => within(c).getByText(/^0\d$/).textContent)).toEqual(['01', '02', '03', '04', '05']);
    expect(within(cards[0]).getByText('Stage name 1')).toBeInTheDocument();
    expect(within(cards[1]).getByText('T102')).toBeInTheDocument();
    expect(within(cards[1]).getByText('T1059.001')).toBeInTheDocument();
    expect(list.className).toContain('@xl:grid-cols-5');
  });

  it('keeps a single stage card full width', () => {
    render(<StageChain stages={stages(1)} />);
    const list = screen.getByRole('list', { name: 'Stages' });
    expect(list.className).not.toContain('@sm:grid-cols-2');
  });

  it('uses two columns on small containers for several stages', () => {
    render(<StageChain stages={stages(3)} />);
    expect(screen.getByRole('list', { name: 'Stages' }).className).toContain('@sm:grid-cols-2');
  });

  it('falls back to the single technique when techniques is absent', () => {
    render(<StageChain stages={[{ stageId: 1, technique: 'T1055', name: 'Inject', fileName: 'stage-T1055.go' }]} />);
    expect(screen.getByText('T1055')).toBeInTheDocument();
  });

  it('wraps more than six stages to a second row', () => {
    render(<StageChain stages={stages(8)} />);
    const list = screen.getByRole('list', { name: 'Stages' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(list.className).toContain('@xl:grid-cols-4');
    expect(list.className).not.toContain('@xl:grid-cols-8');
  });

  it('renders a fleet split or lab pill only when given', () => {
    render(
      <StageChain
        stages={stages(3)}
        pills={{ 1: { blocked: 9, detected: 2, through: 1, sharedWith: [3] }, 2: { lab: 'Blocked in lab' } }}
      />,
    );
    expect(screen.getByText('9 blocked · 2 detected · 1 through')).toBeInTheDocument();
    expect(screen.getByText('shared with stage 3')).toBeInTheDocument();
    expect(screen.getByText('Blocked in lab')).toBeInTheDocument();
  });
});
