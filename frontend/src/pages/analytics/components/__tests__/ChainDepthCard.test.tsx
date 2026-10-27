import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChainDepthCard from '../ChainDepthCard';
import type { ChainDepthResponse } from '@/services/api/analytics';

const data: ChainDepthResponse = {
  chains: 8,
  buckets: [
    { stage: 1, blocked: 1, alertedNotBlocked: 0, bundleNames: ['APT29 Chain'] },
    { stage: 2, blocked: 0, alertedNotBlocked: 0, bundleNames: [] },
    { stage: 3, blocked: 1, alertedNotBlocked: 1, bundleNames: ['Lazarus Chain'] },
    { stage: 4, blocked: 3, alertedNotBlocked: 0, bundleNames: ['FIN7 Chain', 'Lazarus Chain'] },
  ],
  endToEnd: 3,
  endToEndAlerted: 1,
  endToEndBundleNames: ['APT29 Chain', 'FIN7 Chain'],
  endToEndAlertedBundleNames: ['FIN7 Chain'],
  endToEndUndetectedBundleNames: ['APT29 Chain', 'FIN7 Chain'],
  inconclusive: 0,
  blockedBeforeRun: 0,
  blockedBeforeRunBundleNames: [],
  stageErrors: 0,
};

describe('ChainDepthCard', () => {
  it('renders one row per stage plus detected and undetected end-to-end rows', () => {
    render(<ChainDepthCard data={data} />);
    expect(screen.getByText('How deep attack chains get')).toBeInTheDocument();
    expect(screen.getByText('8 chains')).toBeInTheDocument();
    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => within(r).getAllByText(/./)[0].textContent)).toEqual([
      'Stage 1',
      'Stage 2',
      'Stage 3',
      'Stage 4+',
      'Stage not run',
      'End to end',
      'End to end',
    ]);
    expect(within(rows[0]).getByText('1 chain')).toBeInTheDocument();
    expect(within(rows[3]).getByText('3 chains')).toBeInTheDocument();
    expect(rows[4]).toBeDisabled(); // no pre-execution blocks in this fixture
    expect(within(rows[5]).getByText('1 chain')).toBeInTheDocument();
    expect(within(rows[6]).getByText('2 chains')).toBeInTheDocument();
  });

  it('rows are buttons with accessible names that include the alerted count', () => {
    render(<ChainDepthCard data={data} />);
    expect(
      screen.getByRole('button', { name: 'Stage 3: 1 chain blocked, 1 after an earlier EDR alert. Show these runs' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'End to end · detected: 1 chain ran every stage, an EDR alerted. Show these runs' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'End to end · undetected: 2 chains ran every stage, no alert. Show these runs' }),
    ).toBeInTheDocument();
  });

  it('clicking a row passes that bucket’s bundle names', async () => {
    const onRowClick = vi.fn();
    render(<ChainDepthCard data={data} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByRole('button', { name: /^Stage 4\+/ }));
    expect(onRowClick).toHaveBeenLastCalledWith(['FIN7 Chain', 'Lazarus Chain']);
    await userEvent.click(screen.getByRole('button', { name: /^End to end · detected/ }));
    expect(onRowClick).toHaveBeenLastCalledWith(['FIN7 Chain']);
    await userEvent.click(screen.getByRole('button', { name: /^End to end · undetected/ }));
    expect(onRowClick).toHaveBeenLastCalledWith(['APT29 Chain', 'FIN7 Chain']);
  });

  it('rows without chains are disabled', async () => {
    const onRowClick = vi.fn();
    render(<ChainDepthCard data={data} onRowClick={onRowClick} />);
    const empty = screen.getByRole('button', { name: /^Stage 2/ });
    expect(empty).toBeDisabled();
    await userEvent.click(empty);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('bars scale to the largest row; the alerted share is its own segment', () => {
    render(<ChainDepthCard data={data} />);
    const stage3 = screen.getByRole('button', { name: /^Stage 3/ });
    expect(stage3.querySelector<HTMLElement>('[data-segment="main"]')?.style.width).toBe('0%');
    expect(stage3.querySelector<HTMLElement>('[data-segment="alerted"]')?.style.width).toBe(`${(1 / 3) * 100}%`);
    const stage4 = screen.getByRole('button', { name: /^Stage 4\+/ });
    expect(stage4.querySelector<HTMLElement>('[data-segment="main"]')?.style.width).toBe('100%');
    const detected = screen.getByRole('button', { name: /^End to end · detected/ });
    expect(detected.querySelector<HTMLElement>('[data-segment="main"]')?.style.backgroundColor).toBe('var(--chart-warn)');
    const undetected = screen.getByRole('button', { name: /^End to end · undetected/ });
    expect(undetected.querySelector<HTMLElement>('[data-segment="main"]')?.style.backgroundColor).toBe('var(--chart-bypassed)');
  });

  it('shows the empty state when there are no chains', () => {
    render(
      <ChainDepthCard
        data={{
          chains: 0,
          buckets: [1, 2, 3, 4].map((stage) => ({ stage: stage as 1 | 2 | 3 | 4, blocked: 0, alertedNotBlocked: 0, bundleNames: [] })),
          endToEnd: 0,
          endToEndAlerted: 0,
          endToEndBundleNames: [],
          endToEndAlertedBundleNames: [],
          endToEndUndetectedBundleNames: [],
          inconclusive: 0,
        }}
      />,
    );
    expect(screen.getByText('No multi-stage chains in this window')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('notes inconclusive chains in the footer and keeps them out of the rows (older backend)', () => {
    const legacy = { ...data, inconclusive: 2 } as Partial<ChainDepthResponse>;
    delete legacy.blockedBeforeRun;
    delete legacy.blockedBeforeRunBundleNames;
    delete legacy.stageErrors;
    render(<ChainDepthCard data={legacy as ChainDepthResponse} />);
    expect(
      screen.getByText('2 chains inconclusive — a stage errored or was blocked before it ran — not shown'),
    ).toBeInTheDocument();
    expect(screen.getByText('8 chains')).toBeInTheDocument();
  });

  it('with only inconclusive chains it shows the footer, not the empty state', () => {
    render(
      <ChainDepthCard
        data={{
          chains: 0,
          buckets: [1, 2, 3, 4].map((stage) => ({ stage: stage as 1 | 2 | 3 | 4, blocked: 0, alertedNotBlocked: 0, bundleNames: [] })),
          endToEnd: 0,
          endToEndAlerted: 0,
          endToEndBundleNames: [],
          endToEndAlertedBundleNames: [],
          endToEndUndetectedBundleNames: [],
          inconclusive: 1,
        }}
      />,
    );
    expect(screen.queryByText('No multi-stage chains in this window')).not.toBeInTheDocument();
    expect(
      screen.getByText('1 chain inconclusive — a stage errored or was blocked before it ran — not shown'),
    ).toBeInTheDocument();
  });

  it('says nothing about inconclusive chains when there are none', () => {
    render(<ChainDepthCard data={data} />);
    expect(screen.queryByText(/inconclusive/)).not.toBeInTheDocument();
  });

  it('shows the error state when the fetch failed', () => {
    render(<ChainDepthCard data={null} />);
    expect(screen.getByText("Couldn't load chain depth")).toBeInTheDocument();
  });

  it('renders only a skeleton while loading', () => {
    const { container } = render(<ChainDepthCard data={null} loading />);
    expect(screen.queryByText('How deep attack chains get')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('survives an older backend without the detected/undetected bundle lists', () => {
    const legacy = { ...data } as Partial<ChainDepthResponse>;
    delete legacy.endToEndAlertedBundleNames;
    delete legacy.endToEndUndetectedBundleNames;
    render(<ChainDepthCard data={legacy as ChainDepthResponse} />);
    expect(screen.getByRole('button', { name: /^End to end · undetected/ })).toBeInTheDocument();
  });

  it('keeps the label column narrow, with detected/undetected as a sub-label', () => {
    render(<ChainDepthCard data={data} />);
    const row = screen.getByRole('button', { name: /^End to end · detected/ });
    expect(row.className).toContain('grid-cols-[92px_');
    expect(within(row).getByText('detected')).toBeInTheDocument();
  });

  describe('blocked before running', () => {
    const withPreExec: ChainDepthResponse = {
      ...data,
      inconclusive: 3,
      blockedBeforeRun: 2,
      blockedBeforeRunBundleNames: ['APT33 Chain'],
      stageErrors: 1,
    };

    it('is its own row between Stage 4+ and the end-to-end rows', () => {
      render(<ChainDepthCard data={withPreExec} />);
      const labels = screen.getAllByRole('button').map((r) => within(r).getAllByText(/./)[0].textContent);
      expect(labels).toEqual(['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4+', 'Stage not run', 'End to end', 'End to end']);
    });

    it('is neutral, never the blocked colour, and says the technique was not tested', () => {
      render(<ChainDepthCard data={withPreExec} />);
      const row = screen.getByRole('button', {
        name: 'Stage not run · binary blocked: 2 chains — a control stopped the test binary before it ran, so the technique was not tested. Show these runs',
      });
      expect(within(row).getByText('binary blocked')).toBeInTheDocument();
      const bar = row.querySelector<HTMLElement>('[data-segment="main"]');
      expect(bar?.style.backgroundColor).toBe('var(--chart-cat-2)');
      expect(bar?.style.backgroundColor).not.toBe('var(--chart-protected)');
    });

    it('clicking it passes its bundle names', async () => {
      const onRowClick = vi.fn();
      render(<ChainDepthCard data={withPreExec} onRowClick={onRowClick} />);
      await userEvent.click(screen.getByRole('button', { name: /^Stage not run/ }));
      expect(onRowClick).toHaveBeenLastCalledWith(['APT33 Chain']);
    });

    it('leaves only stage errors in the footer, and the chip totals every row', () => {
      render(<ChainDepthCard data={withPreExec} />);
      expect(screen.getByText('1 chain with a stage error — not shown')).toBeInTheDocument();
      expect(screen.queryByText(/inconclusive/)).toBeNull();
      // 8 scored chains + 2 blocked before running
      expect(screen.getByText('10 chains')).toBeInTheDocument();
    });

    it('with an older backend (no split fields) keeps the single inconclusive footer and no new row', () => {
      const legacy = { ...withPreExec } as Partial<ChainDepthResponse>;
      delete legacy.blockedBeforeRun;
      delete legacy.blockedBeforeRunBundleNames;
      delete legacy.stageErrors;
      render(<ChainDepthCard data={legacy as ChainDepthResponse} />);
      expect(screen.queryByRole('button', { name: /^Stage not run/ })).toBeNull();
      expect(screen.getByText('3 chains inconclusive — a stage errored or was blocked before it ran — not shown')).toBeInTheDocument();
    });

    it('shows the row (not the empty state) when only pre-execution blocks exist', () => {
      render(
        <ChainDepthCard
          data={{
            ...withPreExec,
            chains: 0,
            buckets: [1, 2, 3, 4].map((stage) => ({ stage: stage as 1 | 2 | 3 | 4, blocked: 0, alertedNotBlocked: 0, bundleNames: [] })),
            endToEnd: 0,
            endToEndAlerted: 0,
            stageErrors: 0,
            inconclusive: 2,
          }}
        />,
      );
      expect(screen.queryByText('No multi-stage chains in this window')).toBeNull();
      expect(screen.getByRole('button', { name: /^Stage not run/ })).toBeEnabled();
    });
  });
});

describe('ChainDepthCard agent-terminated line', () => {
  it('shows the line and counts the runs in the total when > 0', () => {
    render(<ChainDepthCard data={{ ...data, chains: 10, agentTerminated: 2, agentTerminatedBundleNames: ['LockBit 3.0'] }} />);
    expect(screen.getByText('10 chains')).toBeInTheDocument();
    expect(screen.getByText(/Stopped by EDR, stage unknown: 2/)).toBeInTheDocument();
    expect(screen.getByText(/LockBit 3\.0/)).toBeInTheDocument();
  });

  it('is hidden when 0 or absent', () => {
    const { rerender } = render(<ChainDepthCard data={{ ...data, agentTerminated: 0, agentTerminatedBundleNames: [] }} />);
    expect(screen.queryByText(/Stopped by EDR/)).not.toBeInTheDocument();
    rerender(<ChainDepthCard data={data} />);
    expect(screen.queryByText(/Stopped by EDR/)).not.toBeInTheDocument();
  });

  it('renders when only kill runs exist', () => {
    render(
      <ChainDepthCard
        data={{
          ...data, chains: 1, endToEnd: 0, endToEndAlerted: 0, endToEndBundleNames: [], endToEndAlertedBundleNames: [], endToEndUndetectedBundleNames: [],
          buckets: data.buckets.map((b) => ({ ...b, blocked: 0, alertedNotBlocked: 0, bundleNames: [] })),
          agentTerminated: 1, agentTerminatedBundleNames: ['LockBit 3.0'],
        }}
      />,
    );
    expect(screen.getByText(/Stopped by EDR, stage unknown: 1/)).toBeInTheDocument();
  });
});
