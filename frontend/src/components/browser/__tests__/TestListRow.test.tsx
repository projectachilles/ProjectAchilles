import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TestListRow from '../TestListRow';
import type { TestMetadata } from '@/types/test';

const baseTest: TestMetadata = {
  uuid: '5691f436-e630-4fd2-b930-911023cf638f',
  name: 'APT34 Exchange Server Weaponization',
  description: 'Simulates APT34 techniques',
  severity: 'critical',
  techniques: ['T1505.003', 'T1071.003', 'T1556.002', 'T1048.003', 'T1078'],
  score: 9.4,
  isMultiStage: true,
  stageCount: 4,
  stages: [],
  target: ['windows'],
  createdDate: '2026-03-07',
  lastModifiedDate: '2026-03-07',
  author: 'sectest-builder',
  hasDetectionFiles: true,
  hasAttackFlow: false,
  hasKillChain: true,
  hasDefenseGuidance: true,
  category: 'intel-driven',
};

describe('TestListRow', () => {
  it('renders test name', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('APT34 Exchange Server Weaponization')).toBeInTheDocument();
  });

  it('renders severity badge', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });

  it('renders score', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('9.4')).toBeInTheDocument();
  });

  it('renders technique badges (max 4 + overflow)', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('T1505.003')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<TestListRow test={baseTest} onClick={onClick} />);
    await userEvent.click(screen.getByText('APT34 Exchange Server Weaponization'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders checkbox in select mode', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} selectMode selected={false} onToggleSelect={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders without score when not provided', () => {
    const testNoScore = { ...baseTest, score: undefined };
    render(<TestListRow test={testNoScore} onClick={vi.fn()} />);
    expect(screen.queryByText('9.4')).not.toBeInTheDocument();
  });
});
