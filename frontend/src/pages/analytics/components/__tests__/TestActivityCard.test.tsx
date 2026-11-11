import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TestActivityCard from '../TestActivityCard';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import type { DisplayRow } from '../executions/shared';

const exec = (o: Partial<EnrichedTestExecution>) =>
  ({ test_uuid: 'u', test_name: 'Standalone test', hostname: 'h1', timestamp: '2026-10-10T12:00:00.000Z', is_protected: false, error_code: 101, ...o }) as EnrichedTestExecution;

const standalone = (timestamp: string, name: string, o: Partial<EnrichedTestExecution> = {}): DisplayRow =>
  ({ type: 'standalone', key: `${name}-${timestamp}`, execution: exec({ test_uuid: name, test_name: name, timestamp, ...o }) });

/** A chain blocked at stage 1 that kept running: 1 blocked stage, 3 that ran. */
const chain = (timestamp: string, name: string): DisplayRow => ({
  type: 'bundle',
  key: `bundle::${name}::h1::${timestamp}`,
  bundle_id: 'b1',
  bundle_name: name,
  hostname: 'h1',
  timestamp,
  controls: [
    exec({ test_name: 'Stage one name', error_code: 126, is_protected: true, is_bundle_control: true }),
    exec({ test_name: 'Stage two name', error_code: 101, is_bundle_control: true }),
  ],
  protectedCount: 1,
  unprotectedCount: 3,
  totalCount: 4,
  category: 'intel-driven',
} as DisplayRow);

describe('TestActivityCard', () => {
  it('counts runs and takes last run from the latest run', () => {
    render(
      <TestActivityCard
        runCount={19}
        runs={[standalone('2026-10-10T12:00:00.000Z', 'older'), chain('2026-10-18T12:00:00.000Z', 'newer')]}
      />,
    );
    expect(screen.getByText('19 runs · last run Sun, Oct 18')).toBeInTheDocument();
  });

  it('shows a chain as one run with its run verdict, not one row per stage', () => {
    render(<TestActivityCard runCount={1} runs={[chain('2026-10-18T12:00:00.000Z', 'The Chain')]} />);
    expect(screen.getByText('The Chain')).toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.queryByText('Stage one name')).not.toBeInTheDocument();
  });

  it('shows a standalone result with the table\'s result label', () => {
    render(<TestActivityCard runCount={1} runs={[standalone('2026-10-18T12:00:00.000Z', 'Lone test')]} />);
    expect(screen.getByText('Lone test')).toBeInTheDocument();
    expect(screen.getByText('Unprotected')).toBeInTheDocument();
  });

  it('says "1 run" in the singular', () => {
    render(<TestActivityCard runCount={1} runs={[standalone('2026-10-18T12:00:00.000Z', 'Lone test')]} />);
    expect(screen.getByText('1 run · last run Sun, Oct 18')).toBeInTheDocument();
  });

  it('falls back to the plain description without runs', () => {
    render(<TestActivityCard runCount={null} runs={[]} />);
    expect(screen.getByText('Latest runs in window')).toBeInTheDocument();
  });

  describe('filling its row', () => {
    const originalRO = globalThis.ResizeObserver;
    const originalMM = window.matchMedia;
    afterEach(() => {
      globalThis.ResizeObserver = originalRO;
      window.matchMedia = originalMM;
    });

    it('renders up to 12 runs to measure on large screens', () => {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as typeof window.matchMedia;
      const runs = Array.from({ length: 15 }, (_, i) => standalone(`2026-10-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`, `run-${i}`));
      render(<TestActivityCard runCount={15} runs={runs} />);
      expect(screen.getAllByText(/^run-\d+$/)).toHaveLength(12);
    });

    it('shows its default 4 runs when nothing can be measured', () => {
      const runs = Array.from({ length: 15 }, (_, i) => standalone('2026-10-10T12:00:00.000Z', `run-${i}`));
      render(<TestActivityCard runCount={15} runs={runs} />);
      expect(screen.getAllByText(/^run-\d+$/)).toHaveLength(4);
    });
  });
});
