import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CoverageMatrixTestsResponse,
  ExtendedFilterParams,
  MatrixCell,
  MatrixCounts,
  MatrixHost,
  MatrixTestRow,
} from '@/services/api/analytics';

// The matrix draws one row per test and one mark per host from one response.
// The width a host gets picks the form; jsdom has no layout, so the measured
// width is supplied here.

const { getCoverageMatrix, width } = vi.hoisted(() => ({ getCoverageMatrix: vi.fn(), width: { value: 900 } }));

vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, getCoverageMatrix } };
});
vi.mock('../useElementWidth', () => ({ useElementWidth: () => [() => {}, width.value] }));

const { CoverageMatrix } = await import('../CoverageMatrix');
type Props = Parameters<typeof CoverageMatrix>[0];

const NOW = Date.parse('2026-01-20T12:00:00Z');
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const counts = (c: Partial<MatrixCounts> = {}): MatrixCounts => ({ protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0, ...c });
const ratio0 = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const hostsOf = (n: number): MatrixHost[] =>
  Array.from({ length: n }, (_, i) => ({ key: `org-1|HOST-${String(i + 1).padStart(2, '0')}`, hostname: `HOST-${String(i + 1).padStart(2, '0')}`, org: 'org-1', counts: counts(), ratio: ratio0 }));
const row = (over: Partial<MatrixTestRow> & { cells: MatrixCell[] | null }): MatrixTestRow => ({
  key: 't1', testUuid: 't1', name: 'Solo test', kind: 'test', counts: counts(), ...over,
});
const response = (over: Partial<CoverageMatrixTestsResponse>): CoverageMatrixTestsResponse => {
  const hosts = over.hosts ?? hostsOf(3);
  const tests = over.tests ?? [];
  return { rows: 'tests', windowLabel: '30d', hosts, hostCount: hosts.length, tests, testCount: tests.length, cellsIncluded: true, truncated: false, ...over };
};

/** A chain on three hosts (unprotected, detected with history, never run) and a bundle on the first. */
const SMALL = response({
  tests: [
    row({
      key: 'c1', testUuid: 'c1', name: 'Chain A', kind: 'chain', counts: counts({ unprotected: 1, detected: 1, neverRun: 1 }),
      cells: [
        { i: 0, verdict: 'unprotected', at: at(3) },
        { i: 1, verdict: 'detected', at: at(5), earlier: ['unprotected', 'protected'] },
      ],
    }),
    row({
      key: 'b1', testUuid: 'b1', name: 'Baseline', kind: 'controls', counts: counts({ neverRun: 2 }),
      ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 0 },
      cells: [{ i: 0, ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 0 }, at: at(1) }],
    }),
  ],
});

const PARAMS: ExtendedFilterParams = { from: 'now-30d', to: 'now' };
function setup(over: Partial<Props> = {}) {
  const props: Props = {
    params: PARAMS,
    reloadToken: 0,
    openPair: null,
    onOpenPair: vi.fn(),
    renderPair: () => null,
    renderSegment: () => null,
    now: NOW,
    ...over,
  };
  const view = render(<CoverageMatrix {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(<CoverageMatrix {...props} {...next} />) };
}
const rowOf = (name: string) => screen.getByRole('heading', { name }).closest('[data-matrix-row]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  width.value = 900;
  getCoverageMatrix.mockResolvedValue(SMALL);
});

describe('rows', () => {
  it('writes each test once, with what was caught', async () => {
    setup();

    expect(await screen.findAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(within(rowOf('Chain A')).getByText('caught on 1 of 2 hosts')).toBeInTheDocument();
    expect(within(rowOf('Chain A')).getByText('chain')).toBeInTheDocument();
    expect(within(rowOf('Baseline')).getByText('31 of 48 controls compliant')).toBeInTheDocument();
    expect(within(rowOf('Baseline')).getByText('bundle')).toBeInTheDocument();
    expect(getCoverageMatrix).toHaveBeenCalledTimes(1);
    expect(getCoverageMatrix).toHaveBeenCalledWith(PARAMS);
  });

  it('draws a mark per host in the server\'s order, a hollow one where the test never ran', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Chain A' });

    const marks = within(rowOf('Chain A')).getAllByTestId('matrix-mark');

    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      'HOST-01: unprotected, 3 days ago',
      'HOST-02: detected, 5 days ago; earlier: unprotected, protected',
      'HOST-03: never run',
    ]);
    expect(marks.map((m) => m.tagName)).toEqual(['BUTTON', 'BUTTON', 'SPAN']);
  });

  it('says how many hosts and tests, the window, and what each glyph means', async () => {
    setup();

    expect(await screen.findByText('3 hosts · 2 tests · latest result in 30d')).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'States' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '✓protected', '▲detected', '✕unprotected', '?no verdict', '⊘risk accepted', 'never run',
    ]);
  });

  it('lets a long name take two lines, cuts it there, and keeps it whole in the title', async () => {
    const long = 'A long test name that says what the test does '.repeat(3).trim();
    getCoverageMatrix.mockResolvedValue(response({ tests: [row({ name: long, cells: [] })] }));
    setup();

    const heading = await screen.findByRole('heading', { name: long });

    expect(heading).toHaveAttribute('title', long);
    expect(heading.className).toContain('line-clamp-2');
    // One line would cut the name at the label column's width; a word longer than the column must still break.
    expect(heading.className).not.toContain('truncate');
    expect(heading.className).toContain('break-words');
  });
});

describe('forms', () => {
  it('3 hosts in 900 px are tiles: glyph, age, earlier results, hostnames above', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Chain A' });

    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'tile');
    expect(screen.getAllByTestId('matrix-host').map((h) => h.textContent)).toEqual(['HOST-01', 'HOST-02', 'HOST-03']);
    const [first, second] = within(rowOf('Chain A')).getAllByTestId('matrix-mark');
    expect(first).toHaveTextContent('✕');
    expect(first).toHaveTextContent('3d');
    expect(within(second).getAllByTestId('earlier-dot').map((d) => d.getAttribute('data-verdict'))).toEqual(['unprotected', 'protected']);
  });

  it('30 hosts are small tiles: a glyph each, hostnames angled above', async () => {
    getCoverageMatrix.mockResolvedValue(response({ hosts: hostsOf(30), tests: [row({ cells: [{ i: 0, verdict: 'protected', at: at(1) }] })] }));
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'small');
    expect(screen.getAllByTestId('matrix-host')).toHaveLength(30);
    const mark = within(rowOf('Solo test')).getAllByTestId('matrix-mark')[0];
    expect(mark).toHaveTextContent('✓');
    expect(mark).not.toHaveTextContent('1d');
  });

  it('100 hosts are squares with a name each and no header', async () => {
    getCoverageMatrix.mockResolvedValue(
      response({ hosts: hostsOf(100), tests: [row({ cells: [{ i: 99, verdict: 'unprotected', at: at(2) }] })] }),
    );
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'squares');
    expect(screen.queryAllByTestId('matrix-host')).toHaveLength(0);
    const marks = within(rowOf('Solo test')).getAllByTestId('matrix-mark');
    expect(marks).toHaveLength(100);
    expect(marks[99]).toHaveAccessibleName('HOST-100: unprotected, 2 days ago');
    expect(marks[99]).toHaveAttribute('title', 'HOST-100: unprotected, 2 days ago');
    expect(marks[99]).toHaveTextContent('');
  });

  it('150 hosts in 1,000 px are one bar per test', async () => {
    width.value = 1000;
    getCoverageMatrix.mockResolvedValue(
      response({ hosts: hostsOf(150), tests: [row({ counts: counts({ unprotected: 12, protected: 100, neverRun: 38 }), cells: [] })] }),
    );
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'bar');
    expect(screen.queryAllByTestId('matrix-mark')).toHaveLength(0);
    expect(within(rowOf('Solo test')).getByRole('button', { name: '12 unprotected' })).toBeInTheDocument();
    expect(within(rowOf('Solo test')).getByText('38 never run')).toBeInTheDocument();
  });

  it('draws a bundle on a host as a gauge filled to its compliant share, with the numbers', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Baseline' });

    const mark = within(rowOf('Baseline')).getAllByTestId('matrix-mark')[0];

    expect(mark).toHaveAccessibleName('HOST-01: 31 of 48 controls compliant, 2 not assessed, 1 day ago');
    expect(mark).toHaveTextContent('31/48');
    expect(mark).toHaveTextContent('1d');
    const fill = within(mark).getByTestId('gauge-fill');
    expect(fill.style.width).toBe(`${(31 / 48) * 100}%`);
  });

  it('draws a bundle with no evaluated control as an empty, neutral gauge, never as all red', async () => {
    const none = { compliant: 0, evaluated: 0, notAssessed: 4, accepted: 0 };
    const zero = { compliant: 0, evaluated: 10, notAssessed: 0, accepted: 0 };
    getCoverageMatrix.mockResolvedValue(response({
      tests: [
        row({ key: 'b0', testUuid: 'b0', name: 'Not assessed', kind: 'controls', ratio: none, cells: [{ i: 0, ratio: none, at: at(1) }] }),
        row({ key: 'b1', testUuid: 'b1', name: 'None compliant', kind: 'controls', ratio: zero, cells: [{ i: 0, ratio: zero, at: at(1) }] }),
      ],
    }));
    setup();
    await screen.findByRole('heading', { name: 'Not assessed' });

    const gauge = (name: string) => within(within(rowOf(name)).getAllByTestId('matrix-mark')[0]).getByTestId('gauge');

    expect(within(gauge('Not assessed')).queryByTestId('gauge-fill')).not.toBeInTheDocument();
    expect(gauge('Not assessed').className).not.toContain('danger');
    // Nothing compliant out of ten is a real result: the red track, with a fill of zero width.
    expect(gauge('None compliant').className).toContain('danger');
    expect(within(gauge('None compliant')).getByTestId('gauge-fill').style.width).toBe('0%');
  });

  it('gives a gauge the same classes whatever its share', async () => {
    const bundle = (compliant: number): MatrixTestRow =>
      row({ key: `b${compliant}`, testUuid: `b${compliant}`, name: `Bundle ${compliant}`, kind: 'controls', ratio: { compliant, evaluated: 10, notAssessed: 0, accepted: 0 },
        cells: [{ i: 0, ratio: { compliant, evaluated: 10, notAssessed: 0, accepted: 0 }, at: at(1) }] });
    getCoverageMatrix.mockResolvedValue(response({ tests: [bundle(1), bundle(9)] }));
    setup();
    await screen.findByRole('heading', { name: 'Bundle 1' });

    const [low, high] = ['Bundle 1', 'Bundle 9'].map((name) => within(rowOf(name)).getAllByTestId('matrix-mark')[0]);

    expect(low.className).toBe(high.className);
    expect(within(low).getByTestId('gauge-fill').className).toBe(within(high).getByTestId('gauge-fill').className);
  });
});

describe('a fleet the server sends without cells', () => {
  const BIG = response({
    hosts: [], hostCount: 400, cellsIncluded: false,
    tests: [
      row({ counts: counts({ unprotected: 12, detected: 3, protected: 300, neverRun: 85 }), cells: null }),
      row({ key: 'b1', testUuid: 'b1', name: 'Baseline', kind: 'controls', counts: counts({ neverRun: 10 }), ratio: { compliant: 900, evaluated: 1200, notAssessed: 40, accepted: 5 }, cells: null }),
    ],
  });

  it('draws bars with the counts', async () => {
    getCoverageMatrix.mockResolvedValue(BIG);
    setup();

    expect(await screen.findByText('400 hosts · 2 tests · latest result in 30d')).toBeInTheDocument();
    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'bar');
    expect(within(rowOf('Solo test')).getByText('85 never run')).toBeInTheDocument();
    expect(within(rowOf('Baseline')).getByText('300 not compliant')).toBeInTheDocument();
    expect(within(rowOf('Baseline')).getByText('10 never run')).toBeInTheDocument();
  });

  it('opens a segment\'s hosts under the row, and closes them', async () => {
    const user = userEvent.setup();
    getCoverageMatrix.mockResolvedValue(BIG);
    const renderSegment = vi.fn((test, state) => <p>hosts of {test.name}: {state}</p>);
    setup({ renderSegment });
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(within(rowOf('Solo test')).getByRole('button', { name: '12 unprotected' }));

    expect(within(rowOf('Solo test')).getByText('hosts of Solo test: unprotected')).toBeInTheDocument();
    expect(within(rowOf('Solo test')).getByRole('button', { name: '12 unprotected' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(rowOf('Solo test')).getByRole('button', { name: '3 detected' }));
    expect(within(rowOf('Solo test')).getByText('hosts of Solo test: detected')).toBeInTheDocument();
    expect(screen.queryByText('hosts of Solo test: unprotected')).not.toBeInTheDocument();

    await user.click(within(rowOf('Solo test')).getByRole('button', { name: '3 detected' }));
    expect(screen.queryByText(/hosts of Solo test/)).not.toBeInTheDocument();
  });

  it('opens a segment under its own row only', async () => {
    const user = userEvent.setup();
    const two = response({
      hosts: [], hostCount: 400, cellsIncluded: false,
      tests: [
        row({ counts: counts({ unprotected: 12 }), cells: null }),
        row({ key: 't2', testUuid: 't2', name: 'Other test', counts: counts({ unprotected: 7 }), cells: null }),
      ],
    });
    getCoverageMatrix.mockResolvedValue(two);
    setup({ renderSegment: (test, state) => <p>hosts of {test.name}: {state}</p> });
    await screen.findByRole('heading', { name: 'Other test' });

    await user.click(within(rowOf('Solo test')).getByRole('button', { name: '12 unprotected' }));

    expect(screen.getAllByText(/^hosts of/)).toHaveLength(1);
    expect(within(rowOf('Other test')).getByRole('button', { name: '7 unprotected' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('drops an open segment when the row is no longer a bar', async () => {
    const user = userEvent.setup();
    width.value = 1000;
    getCoverageMatrix.mockResolvedValue(response({ hosts: hostsOf(150), tests: [row({ counts: counts({ unprotected: 12 }), cells: [] })] }));
    const { rerenderWith } = setup({ renderSegment: () => <p>hosts of the segment</p> });
    await screen.findByRole('heading', { name: 'Solo test' });
    await user.click(screen.getByRole('button', { name: '12 unprotected' }));
    expect(screen.getByText('hosts of the segment')).toBeInTheDocument();

    width.value = 3000; // the window grew: 20 px a host, squares
    rerenderWith({});

    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'squares');
    expect(screen.queryByText('hosts of the segment')).not.toBeInTheDocument();
  });

  it('lists a bundle\'s hosts from one button: its bar counts controls, not hosts', async () => {
    const user = userEvent.setup();
    getCoverageMatrix.mockResolvedValue(BIG);
    const renderSegment = vi.fn((test, state) => <p>hosts of {test.name}: {state ?? 'all'}</p>);
    setup({ renderSegment });
    await screen.findByRole('heading', { name: 'Baseline' });
    const row = within(rowOf('Baseline'));

    // The counts are text here: "300 not compliant" is controls, there is no such list of hosts.
    expect(row.getAllByRole('button').map((b) => b.textContent)).toEqual(['Show hosts']);
    await user.click(row.getByRole('button', { name: 'Show hosts' }));

    expect(row.getByText('hosts of Baseline: all')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Hide hosts' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(row.getByRole('button', { name: 'Hide hosts' }));
    expect(screen.queryByText(/hosts of Baseline/)).not.toBeInTheDocument();
  });

  it('keeps a segment\'s hosts above the runs of a host opened from them', async () => {
    const user = userEvent.setup();
    getCoverageMatrix.mockResolvedValue(BIG);
    const { rerenderWith } = setup({ renderSegment: () => <p>the hosts</p>, renderPair: () => <p>the runs</p> });
    await screen.findByRole('heading', { name: 'Solo test' });
    await user.click(within(rowOf('Solo test')).getByRole('button', { name: '12 unprotected' }));

    rerenderWith({ renderSegment: () => <p>the hosts</p>, renderPair: () => <p>the runs</p>, openPair: { testUuid: 't1', hostKey: 'org-1|HOST-77' } });

    const row = rowOf('Solo test');
    expect(within(row).getByText('the hosts')).toBeInTheDocument();
    expect(within(row).getByText('the runs')).toBeInTheDocument();
    expect(within(row).getByText('the hosts').compareDocumentPosition(within(row).getByText('the runs')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('closes a segment whose count fell to zero after a reload', async () => {
    const user = userEvent.setup();
    getCoverageMatrix.mockResolvedValue(BIG);
    const { rerenderWith } = setup({ renderSegment: () => <p>the hosts</p> });
    await screen.findByRole('heading', { name: 'Solo test' });
    await user.click(within(rowOf('Solo test')).getByRole('button', { name: '3 detected' }));
    expect(screen.getByText('the hosts')).toBeInTheDocument();
    getCoverageMatrix.mockResolvedValue({ ...BIG, tests: [{ ...BIG.tests[0], counts: { ...BIG.tests[0].counts, detected: 0 } }, BIG.tests[1]] });

    rerenderWith({ reloadToken: 1 });

    await waitFor(() => expect(screen.queryByText('the hosts')).not.toBeInTheDocument());
  });
});

describe('opening a pair', () => {
  it('asks to open the pair of the mark, and to close the open one', async () => {
    const user = userEvent.setup();
    const { props, rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'Chain A' });
    const first = () => within(rowOf('Chain A')).getAllByTestId('matrix-mark')[0];

    await user.click(first());
    // With the time of the result the mark shows, so the run opened is that one.
    expect(props.onOpenPair).toHaveBeenLastCalledWith({ testUuid: 'c1', hostKey: 'org-1|HOST-01' }, at(3));
    expect(first()).toHaveAttribute('aria-expanded', 'false');

    rerenderWith({ openPair: { testUuid: 'c1', hostKey: 'org-1|HOST-01' } });
    expect(first()).toHaveAttribute('aria-expanded', 'true');
    await user.click(first());
    expect(props.onOpenPair).toHaveBeenLastCalledWith(null);
  });

  it('shows the pair\'s runs under its row only', async () => {
    const renderPair = vi.fn((_pair, test, host) => <p>runs of {test.name} on {host?.hostname}</p>);
    setup({ openPair: { testUuid: 'c1', hostKey: 'org-1|HOST-02' }, renderPair });
    await screen.findByRole('heading', { name: 'Chain A' });

    expect(within(rowOf('Chain A')).getByText('runs of Chain A on HOST-02')).toBeInTheDocument();
    expect(within(rowOf('Baseline')).queryByText(/runs of/)).not.toBeInTheDocument();
    expect(renderPair).toHaveBeenCalledWith({ testUuid: 'c1', hostKey: 'org-1|HOST-02' }, expect.objectContaining({ testUuid: 'c1' }), expect.objectContaining({ hostname: 'HOST-02' }));
  });

  it('paints each state in its own colour', async () => {
    const verdicts = ['protected', 'detected', 'unprotected', 'no_verdict', 'risk_accepted'] as const;
    getCoverageMatrix.mockResolvedValue(response({ hosts: hostsOf(5), tests: [row({ cells: verdicts.map((verdict, i) => ({ i, verdict, at: at(1) })) })] }));
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });
    const colourOf = (el: HTMLElement) => ['accent', 'warning', 'danger', 'info'].find((tone) => el.className.includes(`text-${tone}`) || el.className.includes(`bg-${tone}`)) ?? 'neutral';

    expect(within(rowOf('Solo test')).getAllByTestId('matrix-mark').map(colourOf)).toEqual(['accent', 'warning', 'danger', 'neutral', 'info']);
  });

  it('keeps hostnames above small tiles inside the card: capped, and leaning towards their own column', async () => {
    const hosts = hostsOf(30).map((h, i) => (i === 29 ? { ...h, hostname: 'a-very-long-hostname.lab.example.test' } : h));
    getCoverageMatrix.mockResolvedValue(response({ hosts, tests: [row({ cells: [{ i: 0, verdict: 'protected', at: at(1) }] })] }));
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    const last = screen.getAllByTestId('matrix-host')[29];

    expect(last).toHaveAttribute('title', 'a-very-long-hostname.lab.example.test');
    // Anchored at its right end, so it never extends past the last column; cut at a fixed length.
    expect(last.className).toContain('origin-bottom-right');
    expect(last.className).toContain('truncate');
    expect(last.className).toMatch(/max-w-/);
  });

  it('shows an open pair of a fleet drawn as bars, where the host is not on the axis', async () => {
    getCoverageMatrix.mockResolvedValue(response({ hosts: [], hostCount: 400, cellsIncluded: false, tests: [row({ cells: null })] }));
    const renderPair = vi.fn(() => <p>runs</p>);
    setup({ openPair: { testUuid: 't1', hostKey: 'org-1|HOST-77' }, renderPair });

    expect(await screen.findByText('runs')).toBeInTheDocument();
    expect(renderPair).toHaveBeenCalledWith({ testUuid: 't1', hostKey: 'org-1|HOST-77' }, expect.anything(), null);
  });

  it('moves along a row with left and right, between rows in the same column with up and down, and opens with Enter', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await screen.findByRole('heading', { name: 'Chain A' });
    const [chain1, chain2] = within(rowOf('Chain A')).getAllByRole('button');
    const [baseline1] = within(rowOf('Baseline')).getAllByRole('button');

    chain1.focus();
    await user.keyboard('{ArrowRight}');
    expect(chain2).toHaveFocus();
    await user.keyboard('{ArrowRight}'); // the row's last mark: stays
    expect(chain2).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // Baseline has no mark in HOST-02's column: stays
    expect(chain2).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(chain1).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(baseline1).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(chain1).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onOpenPair).toHaveBeenLastCalledWith({ testUuid: 'c1', hostKey: 'org-1|HOST-01' }, at(3));
  });

  it('is one stop for the Tab key: the mark last focused, the first one before any was', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Chain A' });
    const buttons = screen.getAllByTestId('matrix-mark').filter((m) => m.tagName === 'BUTTON');
    const stops = () => buttons.map((b) => b.getAttribute('tabindex'));

    expect(stops()).toEqual(['0', '-1', '-1']);
    buttons[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(stops()).toEqual(['-1', '0', '-1']);

    await user.tab(); // leaves the matrix: no other mark takes focus
    expect(buttons.some((b) => b === document.activeElement)).toBe(false);
    await user.tab({ shift: true });
    expect(buttons[1]).toHaveFocus();
  });

  it('names each row\'s marks by its test, for a reader that lands on a mark', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Chain A' });

    const strip = within(rowOf('Chain A')).getByRole('group', { name: 'Chain A' });

    expect(within(strip).getAllByTestId('matrix-mark')).toHaveLength(3);
  });

  it('writes out the mark that has the focus or the pointer, where marks are too small to carry text', async () => {
    const user = userEvent.setup();
    getCoverageMatrix.mockResolvedValue(
      response({ hosts: hostsOf(100), tests: [row({ cells: [{ i: 0, verdict: 'protected', at: at(1) }, { i: 99, verdict: 'unprotected', at: at(2) }] })] }),
    );
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });
    const marks = within(rowOf('Solo test')).getAllByTestId('matrix-mark');
    const hint = screen.getByTestId('matrix-hint');
    expect(hint).toHaveTextContent('');

    marks[0].focus();
    expect(hint).toHaveTextContent('Solo test · HOST-01: protected, 1 day ago');
    await user.hover(marks[99]);
    expect(hint).toHaveTextContent('Solo test · HOST-100: unprotected, 2 days ago');
    await user.hover(marks[50]);
    expect(hint).toHaveTextContent('Solo test · HOST-51: never run');
    // A screen reader has each mark's own name; the line is for the eye.
    expect(hint).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no such line where each mark already shows its host and age', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Chain A' });

    expect(screen.queryByTestId('matrix-hint')).not.toBeInTheDocument();
  });
});

describe('loading, failing, nothing', () => {
  it('says it is loading', () => {
    getCoverageMatrix.mockReturnValue(new Promise(() => {}));
    setup();

    expect(screen.getByRole('status')).toHaveTextContent('Loading the matrix…');
  });

  it('says when the window holds no result', async () => {
    getCoverageMatrix.mockResolvedValue(response({ hosts: [], tests: [] }));
    setup();

    expect(await screen.findByText('No results in this window')).toBeInTheDocument();
  });

  it('says when the request failed and asks again on request', async () => {
    const user = userEvent.setup();
    getCoverageMatrix.mockRejectedValueOnce(new Error('boom'));
    setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('The matrix could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Chain A' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when more tests exist than are listed', async () => {
    getCoverageMatrix.mockResolvedValue(response({ tests: [row({ cells: [] })], testCount: 512, truncated: true }));
    setup();

    expect(await screen.findByText('Showing 1 of 512 tests')).toBeInTheDocument();
  });

  it('says that outcome filters do not narrow it', async () => {
    setup({ params: { ...PARAMS, result: 'unprotected' } });

    expect(await screen.findByText('Outcome filters apply to the List view only.')).toBeInTheDocument();
    // They are not sent either: the request is the scope.
    expect(getCoverageMatrix).toHaveBeenCalledWith(PARAMS);
  });

  it('says nothing about outcome filters when none is set', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Chain A' });

    expect(screen.queryByText(/Outcome filters/)).not.toBeInTheDocument();
  });
});

describe('reloading', () => {
  const deferred = () => {
    let resolve!: (v: CoverageMatrixTestsResponse) => void;
    const promise = new Promise<CoverageMatrixTestsResponse>((r) => { resolve = r; });
    return { promise, resolve };
  };
  const named = (name: string) => response({ tests: [row({ name, cells: [] })] });

  it('asks again for another scope, and never shows the old scope\'s rows as the new one\'s', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'Chain A' });
    const next = deferred();
    getCoverageMatrix.mockReturnValue(next.promise);

    rerenderWith({ params: { from: 'now-7d', to: 'now' } });

    expect(getCoverageMatrix).toHaveBeenLastCalledWith({ from: 'now-7d', to: 'now' });
    expect(screen.queryByRole('heading', { name: 'Chain A' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => next.resolve(named('Seven days')));
    expect(screen.getByRole('heading', { name: 'Seven days' })).toBeInTheDocument();
  });

  it('ignores an answer that arrives after a newer request', async () => {
    const first = deferred();
    const second = deferred();
    getCoverageMatrix.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerenderWith } = setup();

    rerenderWith({ params: { from: 'now-7d', to: 'now' } });
    await act(async () => second.resolve(named('Newer')));
    await act(async () => first.resolve(named('Older')));

    expect(screen.getByRole('heading', { name: 'Newer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Older' })).not.toBeInTheDocument();
  });

  it('does not ask again for the same scope in a new object', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'Chain A' });

    rerenderWith({ params: { ...PARAMS } });
    rerenderWith({ params: { ...PARAMS, result: 'protected' } });

    expect(getCoverageMatrix).toHaveBeenCalledTimes(1);
  });

  it('on a reload of the same scope keeps the rows on screen until the answer comes', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'Chain A' });
    const next = deferred();
    getCoverageMatrix.mockReturnValue(next.promise);

    rerenderWith({ reloadToken: 1 });

    expect(getCoverageMatrix).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Chain A' })).toBeInTheDocument();
    await act(async () => next.resolve(named('After the reload')));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'After the reload' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Chain A' })).not.toBeInTheDocument();
  });

  it('keeps the rows when a reload fails, and says so', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'Chain A' });
    getCoverageMatrix.mockRejectedValueOnce(new Error('boom'));

    rerenderWith({ reloadToken: 1 });

    expect(await screen.findByRole('alert')).toHaveTextContent('The matrix could not be loaded.');
    expect(screen.getByRole('heading', { name: 'Chain A' })).toBeInTheDocument();
  });
});
