import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { MovementRow, ScoreMovementResponse } from '@/services/api/analytics';
import { buildScoreMovementView } from '../../scoreMovementView';
import { FULL } from '../../__tests__/scoreMovementFixture';
import { ScoreMovementCard } from '../ScoreMovementCard';

const wrap = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const VIEW = buildScoreMovementView(FULL, 'last 30d');

const ROW: MovementRow = {
  testUuid: 'a0000000-1234-4abc-8def-000000000001',
  testName: 'Lumma-style infostealer',
  hostname: 'ws-014',
  origin: 'regression',
  failingSince: '2026-11-04T10:00:00Z',
  lastResultAt: '2026-11-12T10:00:00Z',
};

const LISTS: ScoreMovementResponse['lists'] = {
  ...FULL.lists,
  stillFailing: { total: 6, rows: [ROW] },
  notRetested: { total: 450, rows: Array(200).fill(ROW) },
};

function props(overrides: Partial<Parameters<typeof ScoreMovementCard>[0]> = {}) {
  return { view: VIEW, lists: LISTS, loading: false, error: false, ...overrides };
}

describe('ScoreMovementCard', () => {
  it('renders both panels, the pill and the footer', () => {
    wrap(<ScoreMovementCard {...props()} />);
    expect(screen.getByText('What moved the score · last 30d')).toBeInTheDocument();
    expect(screen.getByText('52 → 289 pairs in the score · 4 → 11 failing')).toBeInTheDocument();
    expect(screen.getByText('8 failures not re-tested')).toBeInTheDocument();
    expect(screen.getByText('32 of 46 fixed')).toBeInTheDocument();
    expect(screen.getByText('193 of 228 stopped')).toBeInTheDocument();
    expect(screen.getByText('1 open failure is counted twice by the score')).toBeInTheDocument();
  });

  it('names each bar with its counts', () => {
    wrap(<ScoreMovementCard {...props()} />);
    expect(
      screen.getByRole('img', { name: 'Fixed 32, Still failing 6, Not re-tested 5, Left the score untested 3' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Stopped on the first run 193, Got through on the first run 35' }),
    ).toBeInTheDocument();
  });

  it('opens the list behind a number', async () => {
    wrap(<ScoreMovementCard {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Still failing (6)' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Still failing')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Lumma-style infostealer' })).toHaveAttribute(
      'href',
      '/tests/a0000000-1234-4abc-8def-000000000001',
    );
    expect(within(dialog).getByText('ws-014')).toBeInTheDocument();
    expect(within(dialog).getByText('Regression')).toBeInTheDocument();
  });

  it('says when a list is capped', async () => {
    wrap(<ScoreMovementCard {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Not re-tested (5)' }));
    expect(screen.getByText('Showing 200 of 450')).toBeInTheDocument();
  });

  it('shows "before <start>" for a failure open before the period, and a Fixed column only on the fixed list', async () => {
    const open: MovementRow = { ...ROW, origin: 'open_at_start', failingSince: null, openBeforePeriod: true };
    const fixed: MovementRow = { ...ROW, fixedAt: '2026-11-09T10:00:00Z' };
    wrap(
      <ScoreMovementCard
        {...props({ lists: { ...LISTS, stillFailing: { total: 6, rows: [open] }, fixed: { total: 32, rows: [fixed] } } })}
        periodStart="2026-10-27T12:00:00Z"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'View Still failing (6)' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('before Oct 27')).toBeInTheDocument();
    expect(within(dialog).getByText('Open at the start')).toBeInTheDocument();
    expect(within(dialog).queryByRole('columnheader', { name: 'Fixed' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'View Fixed (32)' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('columnheader', { name: 'Fixed' })).toBeInTheDocument();
    expect(within(dialog).getByText('Nov 9')).toBeInTheDocument();
  });

  it('has no Origin or Failing since column on the first-run list, whatever the rows carry', async () => {
    const stopped: MovementRow = {
      ...ROW,
      origin: 'new_test',
      failingSince: '2026-11-04T10:00:00Z',
      fixedAt: '2026-11-09T10:00:00Z',
    };
    wrap(<ScoreMovementCard {...props({ lists: { ...LISTS, newStopped: { total: 193, rows: [stopped] } } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Stopped on the first run (193)' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('columnheader', { name: 'Fixed' })).toBeNull();
    expect(within(dialog).queryByRole('columnheader', { name: 'Origin' })).toBeNull();
    expect(within(dialog).queryByRole('columnheader', { name: 'Failing since' })).toBeNull();
    expect(within(dialog).getByRole('columnheader', { name: 'Last result' })).toBeInTheDocument();
    expect(within(dialog).queryByText('New test')).toBeNull();
    expect(within(dialog).queryByText('Nov 4')).toBeNull();
    expect(within(dialog).queryByText('Nov 9')).toBeNull();
    expect(within(dialog).getByText('Nov 12')).toBeInTheDocument();
  });

  it('names the dialog by its title', async () => {
    wrap(<ScoreMovementCard {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Still failing (6)' }));
    expect(screen.getByRole('dialog', { name: 'Still failing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Still failing' }).closest('span')).toBeNull();
  });

  it('writes counts of 1,000 and more with a thousands separator', async () => {
    const view = buildScoreMovementView({ ...FULL, failures: { ...FULL.failures, stillFailing: 1289 } }, 'last 30d');
    wrap(<ScoreMovementCard {...props({ view, lists: { ...LISTS, stillFailing: { total: 1289, rows: [ROW] } } })} />);
    expect(screen.getByText('1,289', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Fixed 32, Still failing 1,289, Not re-tested 5, Left the score untested 3' }))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Still failing (1,289)' }));
    expect(screen.getByText('Showing 1 of 1,289')).toBeInTheDocument();
  });

  it('keeps a control id on one line', async () => {
    const row: MovementRow = { ...ROW, controlId: 'CH-IEP-003' };
    wrap(<ScoreMovementCard {...props({ lists: { ...LISTS, stillFailing: { total: 6, rows: [row] } } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Still failing (6)' }));
    expect(within(screen.getByRole('dialog')).getByText('CH-IEP-003')).toHaveClass('whitespace-nowrap');
  });

  it('shows the failing-since date on the got-through list', async () => {
    const through: MovementRow = { ...ROW, origin: undefined };
    wrap(<ScoreMovementCard {...props({ lists: { ...LISTS, newGotThrough: { total: 35, rows: [through] } } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Got through on the first run (35)' }));
    expect(within(screen.getByRole('dialog')).getByText('Nov 4')).toBeInTheDocument();
  });

  it('moves focus into the dialog, names the close control and returns focus on close', async () => {
    wrap(<ScoreMovementCard {...props()} />);
    const opener = screen.getByRole('button', { name: 'View Still failing (6)' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('has no view control for a zero count', () => {
    const view = buildScoreMovementView({ ...FULL, failures: { ...FULL.failures, stillFailing: 0 } }, 'last 30d');
    wrap(<ScoreMovementCard {...props({ view })} />);
    expect(screen.queryByRole('button', { name: /View Still failing/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'View Fixed (32)' })).toBeInTheDocument();
  });

  it('shows the empty states', () => {
    const empty: ScoreMovementResponse = {
      ...FULL,
      failures: {
        total: 0,
        fixed: 0,
        stillFailing: 0,
        notRetested: 0,
        leftUntested: 0,
        fixRate: null,
        origins: { openAtStart: 0, olderRetested: 0, newTest: 0, firstOnEndpoint: 0, regression: 0 },
      },
      newTests: { tests: 0, pairs: 0, stopped: 0, gotThrough: 0, rate: null, gotThroughFixed: 0, gotThroughOpen: 0 },
      regressed: { total: 0, fixed: 0 },
      firstOnEndpoint: { pairs: 0, stopped: 0 },
      riskAccepted: null,
      scoreDifference: { fixedButCounted: 0, countedTwice: 0 },
    };
    wrap(<ScoreMovementCard {...props({ view: buildScoreMovementView(empty, 'last 30d') })} />);
    expect(screen.getByText('No failures in this period')).toBeInTheDocument();
    expect(screen.getByText('No new tests in this period')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: /^View/ })).toBeNull();
  });

  it('shows a skeleton while loading and an error when the request failed', () => {
    const { container, rerender } = wrap(<ScoreMovementCard view={null} lists={null} loading error={false} />);
    expect(container.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
    rerender(
      <MemoryRouter>
        <ScoreMovementCard view={null} lists={null} loading={false} error />
      </MemoryRouter>,
    );
    expect(screen.getByText("Couldn't load score movement, try again later")).toBeInTheDocument();
  });

  it('shows the skeleton, not the previous range, while a new range loads', () => {
    const { container } = wrap(<ScoreMovementCard {...props({ loading: true })} />);
    expect(container.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
    expect(screen.queryByText('32 of 46 fixed')).toBeNull();
    expect(screen.queryByText('What moved the score · last 30d')).toBeNull();
  });
});
