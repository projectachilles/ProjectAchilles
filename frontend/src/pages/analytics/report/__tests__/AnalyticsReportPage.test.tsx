import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { counts, makeReport } from './fixtures';
import { stubMemoryStorage } from './memoryStorage';

const { getReportMock } = vi.hoisted(() => ({ getReportMock: vi.fn() }));
vi.mock('@/services/api/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api/reports')>()),
  reportsApi: { getExecutionReport: getReportMock },
}));

const { default: AnalyticsReportPage } = await import('../AnalyticsReportPage');
const { ReportDocument, cssString, pageCss } = await import('../ReportDocument');

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/analytics/report" element={<AnalyticsReportPage />} />
        <Route path="/analytics" element={<p>Analytics tab</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const pageStyle = () => document.querySelector('style[data-report-page]');

describe('AnalyticsReportPage', () => {
  let storage: Storage;
  beforeEach(() => {
    getReportMock.mockReset();
    storage = stubMemoryStorage();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests the report for the URL filters in the viewer time zone', async () => {
    getReportMock.mockResolvedValue(makeReport());
    renderAt('/analytics/report?date=30d&result=unprotected');
    expect(screen.getByText('Building report…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Executive summary' })).toBeInTheDocument();
    expect(getReportMock).toHaveBeenCalledWith({ org: undefined, from: 'now-30d', result: 'unprotected', tz: expect.any(String) });
    expect(getReportMock).toHaveBeenCalledTimes(1);
  });

  it('sends multi-value filters as comma-joined strings, never repeated or array params', async () => {
    getReportMock.mockResolvedValue(makeReport());
    renderAt('/analytics/report?hostnames=WS-1,WS-2&tests=a,b&org=org_1');
    await screen.findByRole('heading', { name: 'Executive summary' });
    const params = getReportMock.mock.calls[0][0];
    expect(params).toMatchObject({ org: 'org_1', hostnames: 'WS-1,WS-2', tests: 'a,b' });
    for (const value of Object.values(params)) expect(Array.isArray(value)).toBe(false);
  });

  it('sends a custom range as from/to and All time as the all-time lower bound', async () => {
    getReportMock.mockResolvedValue(makeReport());
    const { unmount } = renderAt('/analytics/report?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z');
    await screen.findByRole('heading', { name: 'Executive summary' });
    expect(getReportMock.mock.calls[0][0]).toMatchObject({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.000Z' });
    unmount();

    renderAt('/analytics/report?date=all');
    await screen.findByRole('heading', { name: 'Executive summary' });
    expect(getReportMock.mock.calls[1][0]).toMatchObject({ from: '2000-01-01T00:00:00.000Z' });
  });

  it.each([
    ['a 502', 'Report query failed: search_phase_execution_exception'],
    ['a 400', 'Invalid date bound: from'],
    ['a 403 org mismatch', 'org does not match your organization'],
  ])('shows the backend message for %s and retries on request', async (_label, message) => {
    getReportMock.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(makeReport());
    renderAt('/analytics/report');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Executive summary' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(getReportMock).toHaveBeenCalledTimes(2);
  });

  it('shows only the message, never a stack trace, and a generic line for a non-Error rejection', async () => {
    const err = new Error('Report query failed');
    err.stack = 'Error: Report query failed\n    at buildReport (/srv/backend/reports.ts:88:11)';
    getReportMock.mockRejectedValueOnce(err).mockRejectedValueOnce('boom');
    renderAt('/analytics/report');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Report query failed');
    expect(document.body.textContent).not.toContain('buildReport');
    expect(document.body.textContent).not.toContain('/srv/backend');

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('The report could not be built.')).toBeInTheDocument();
  });

  it('includes run timelines only for small, complete scopes', async () => {
    getReportMock.mockResolvedValue(makeReport());
    const { unmount } = renderAt('/analytics/report');
    expect(await screen.findByText('Appendix B · Run timelines')).toBeInTheDocument();
    unmount();

    const big = makeReport({ meta: { truncation: { runs: true, tests: false, lanes: false } } });
    big.totals.runs = 600;
    getReportMock.mockResolvedValue(big);
    renderAt('/analytics/report');
    await screen.findByRole('heading', { name: 'Executive summary' });
    expect(screen.queryByText('Appendix B · Run timelines')).toBeNull();
  });

  it('renders the empty state when nothing matches', async () => {
    const empty = makeReport({ runs: [] });
    empty.totals = { ...empty.totals, runs: 0, stageResults: 0, outcomes: counts() };
    getReportMock.mockResolvedValue(empty);
    renderAt('/analytics/report');
    expect(await screen.findByRole('heading', { name: 'No executions match these filters' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Executive summary' })).toBeNull();
    // Named as the console labels the tab.
    expect(screen.getByText(/remove filters on the All Executions tab/)).toBeInTheDocument();
  });

  it('says the per-page marking, headers and page numbers print only in Chromium-based browsers', () => {
    getReportMock.mockReturnValue(new Promise(() => {}));
    renderAt('/analytics/report');
    const toolbar = screen.getByRole('toolbar', { name: 'Report actions' });
    expect(toolbar).toHaveTextContent(
      'The marking on each page, the running headers and the page numbers print in Chromium-based browsers (Chrome, Edge); other browsers omit them.',
    );
  });

  it('still renders when browser storage throws (Review Focus #3)', async () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    getReportMock.mockResolvedValue(makeReport());
    renderAt('/analytics/report');
    expect(await screen.findByRole('heading', { name: 'Executive summary' })).toBeInTheDocument();
    expect(screen.getByLabelText('Paper')).toHaveValue('A4');
    expect(screen.getByLabelText('Marking')).toHaveValue('TLP:AMBER');

    // A write that fails must not break the in-memory choice for this visit.
    await userEvent.selectOptions(screen.getByLabelText('Paper'), 'Letter');
    expect(screen.getByLabelText('Paper')).toHaveValue('Letter');
    expect(pageStyle()?.textContent).toContain('size: letter');
  });

  it('remembers the paper size and marking for the next visit', async () => {
    getReportMock.mockResolvedValue(makeReport());
    const first = renderAt('/analytics/report');
    await screen.findByRole('heading', { name: 'Executive summary' });
    await userEvent.selectOptions(screen.getByLabelText('Paper'), 'Letter');
    await userEvent.selectOptions(screen.getByLabelText('Marking'), 'TLP:RED');
    expect(pageStyle()?.textContent).toContain('"TLP:RED · RPT-20261013-7F3A"');
    first.unmount();

    renderAt('/analytics/report');
    await screen.findByRole('heading', { name: 'Executive summary' });
    expect(screen.getByLabelText('Paper')).toHaveValue('Letter');
    expect(screen.getByLabelText('Marking')).toHaveValue('TLP:RED');
  });

  it('ignores a stored value that is not on the list', async () => {
    storage.setItem('achilles.report.paper', 'Tabloid');
    storage.setItem('achilles.report.marking', 'TLP:PINK');
    getReportMock.mockResolvedValue(makeReport());
    renderAt('/analytics/report');
    await screen.findByRole('heading', { name: 'Executive summary' });
    expect(screen.getByLabelText('Paper')).toHaveValue('A4');
    expect(screen.getByLabelText('Marking')).toHaveValue('TLP:AMBER');
  });

  it('prints from the toolbar once the report is ready', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    getReportMock.mockResolvedValue(makeReport());
    renderAt('/analytics/report');
    const button = screen.getByRole('button', { name: 'Print / Save as PDF' });
    expect(button).toBeDisabled();
    await screen.findByRole('heading', { name: 'Executive summary' });
    await userEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('links back to the Executions tab with the same filters', async () => {
    getReportMock.mockResolvedValue(makeReport());
    renderAt('/analytics/report?date=30d&hostnames=WS-1,WS-2');
    await screen.findByRole('heading', { name: 'Executive summary' });
    const href = screen.getByRole('link', { name: 'Back to analytics' }).getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/analytics');
    expect(url.searchParams.get('tab')).toBe('executions');
    expect(url.searchParams.get('date')).toBe('30d');
    expect(url.searchParams.get('hostnames')).toBe('WS-1,WS-2');
  });

  it('titles the document with the report id and restores the title on leave', async () => {
    document.title = 'ProjectAchilles';
    getReportMock.mockResolvedValue(makeReport());
    const { unmount } = renderAt('/analytics/report');
    await screen.findByRole('heading', { name: 'Executive summary' });
    // The title is set in a passive effect, which may flush after the heading is in the DOM.
    await waitFor(() => expect(document.title).toBe('Execution report RPT-20261013-7F3A'));
    unmount();
    expect(document.title).toBe('ProjectAchilles');
  });

  it('removes the injected page rules when the report unmounts', async () => {
    getReportMock.mockResolvedValue(makeReport());
    const { unmount } = renderAt('/analytics/report');
    await screen.findByRole('heading', { name: 'Executive summary' });
    expect(pageStyle()).not.toBeNull();
    unmount();
    expect(pageStyle()).toBeNull();
    expect(document.querySelectorAll('style').length).toBe(0);
  });
});

describe('ReportDocument', () => {
  afterEach(() => vi.restoreAllMocks());

  it('orders the sections cover, summary, coverage, test pages, findings, log, run strips, method', () => {
    render(<ReportDocument report={makeReport()} paper="A4" marking="TLP:AMBER" />);
    const labels = [...document.querySelectorAll('section.rp-sheet')].map((s) => s.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Cover',
      'Executive summary',
      'Threat actors and ATT&CK coverage',
      'LockBit 3.0 Double Extortion Kill Chain',
      'Findings and recommendations',
      'Execution log',
      'Run timelines',
      'Method',
    ]);
  });

  it('uses the Letter sheet class and drops the run strips above the cap', () => {
    const report = makeReport();
    report.totals.runs = 26;
    const { container } = render(<ReportDocument report={report} paper="Letter" marking="None" />);
    expect(container.querySelector('.rp-paper-letter')).not.toBeNull();
    expect(screen.queryByText('Appendix B · Run timelines')).toBeNull();
  });

  it('draws run strips at exactly the cap and drops them one run above it', () => {
    const run = makeReport().runs[0];
    const runs = Array.from({ length: 25 }, (_, i) => ({ ...run, key: `${run.key}-${i}` }));
    const at = makeReport({ runs });
    const { unmount } = render(<ReportDocument report={at} paper="A4" marking="None" />);
    expect(screen.getByText('Appendix B · Run timelines')).toBeInTheDocument();
    unmount();

    const over = makeReport({ runs: [...runs, { ...run, key: `${run.key}-25` }] });
    render(<ReportDocument report={over} paper="A4" marking="None" />);
    expect(screen.queryByText('Appendix B · Run timelines')).toBeNull();
  });

  it('names no EDR vendor anywhere when none is configured', () => {
    const report = makeReport({ meta: { edrVendors: [] } });
    const { container } = render(<ReportDocument report={report} paper="A4" marking="TLP:AMBER" />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Method/);
    expect(text).not.toMatch(/defender|crowdstrike|falcon/i);
    // Titles and labels inside SVG and aria attributes count too.
    expect(container.innerHTML).not.toMatch(/defender|crowdstrike|falcon/i);
  });

  it('renders every section when an alert has no time (the backend sends \'\' for a missing created_at)', () => {
    const report = makeReport();
    const [lsass, falcon] = report.runs[0].alerts;
    report.runs[0] = { ...report.runs[0], alerts: [{ ...lsass, createdAt: '' }, falcon] };
    const { container } = render(<ReportDocument report={report} paper="A4" marking="TLP:AMBER" />);
    // The run-strip appendix is included (2 runs), so every alert consumer has rendered.
    expect(screen.getByText('Appendix B · Run timelines')).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Invalid Date/);
    // The undated alert is still listed in the run's events, last and with a dash for its time.
    const events = Array.from(container.querySelectorAll('.rp-events li')).map((li) => li.textContent ?? '');
    expect(events.filter((e) => e.startsWith('—'))).toEqual([
      '—Defender · high · Suspicious access to LSASS service · S2 Privileged credential access · resolved · blocked',
    ]);
  });

  it('names the configured vendors on the Method page when they are', () => {
    render(<ReportDocument report={makeReport()} paper="A4" marking="TLP:AMBER" />);
    const method = screen.getByLabelText('Method');
    expect(within(method).getByText(/Microsoft Defender for Endpoint and CrowdStrike Falcon/)).toBeInTheDocument();
  });
});

describe('pageCss (Review Focus #5)', () => {
  it('escapes quotes and backslashes in margin-box strings', () => {
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
    const css = pageCss(makeReport({ meta: { org: { id: 'x', name: 'Acme "Bank"' } } }), 'Letter', 'TLP:AMBER');
    expect(css).toContain('size: letter');
    expect(css).toContain('"Acme \\"Bank\\" · Security Validation Report"');
    expect(css).toContain('"TLP:AMBER · RPT-20261013-7F3A"');
    expect(css).toContain('counter(pages)');
  });

  it('keeps a backslash, a closing brace and a newline in the org name inside the string', () => {
    const css = pageCss(makeReport({ meta: { org: { id: 'x', name: 'Back\\slash } @page { x: "y"\nNext' } } }), 'A4', 'None');
    expect(css).toContain('size: A4');
    expect(css).toContain('"Back\\\\slash } @page { x: \\"y\\" Next · Security Validation Report"');
    // Read back as CSS would: the string ends at the first unescaped quote, right before `;`.
    const top = css.split('\n').find((l) => l.includes('@top-left')) ?? '';
    const literal = top.match(/content: ("(?:[^"\\]|\\.)*")/)?.[1];
    expect(literal).toBe('"Back\\\\slash } @page { x: \\"y\\" Next · Security Validation Report"');
    expect(top.slice(top.indexOf(literal ?? '') + (literal?.length ?? 0))).toMatch(/^; font-family:/);
  });

  it('prints the report id alone when the marking is None', () => {
    const css = pageCss(makeReport(), 'A4', 'None');
    expect(css).toContain('@bottom-left { content: "RPT-20261013-7F3A"');
    expect(css).not.toContain('None');
  });
});
