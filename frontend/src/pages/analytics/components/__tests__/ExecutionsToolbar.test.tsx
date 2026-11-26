import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import { ExecutionsToolbar } from '../ExecutionsToolbar';
import { useExecutionsExport } from '../executions/useExecutionsExport';

// Export and "Archive by date": the same controls above the list and above the matrix.

const exec = (over: Partial<EnrichedTestExecution> = {}): EnrichedTestExecution =>
  ({ test_uuid: 'a0000000-1234-4abc-8def-000000000001', test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [], org: 'org-1', ...over }) as unknown as EnrichedTestExecution;

type HookOptions = Parameters<typeof useExecutionsExport>[0];
type ToolbarProps = Omit<Parameters<typeof ExecutionsToolbar>[0], 'exportState'>;

function Harness({ hook, toolbar }: { hook: HookOptions; toolbar?: ToolbarProps }) {
  const exportState = useExecutionsExport(hook);
  return <ExecutionsToolbar exportState={exportState} {...toolbar} />;
}

let downloaded: Array<{ name: string; type: string; text: string }>;

beforeEach(() => {
  downloaded = [];
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href) ?? blobs.get(this.getAttribute('href') ?? '');
    void blob?.text().then((text) => downloaded.push({ name: this.download, type: blob.type, text }));
  });
});

const setup = (hook: Partial<HookOptions> = {}, toolbar: ToolbarProps = {}) => {
  const options: HookOptions = { pageExecutions: [], showVersions: false, ...hook };
  render(<Harness hook={options} toolbar={toolbar} />);
  return { user: userEvent.setup(), options };
};

describe('export', () => {
  it('exports every matching result as CSV, with a header row', async () => {
    const onFetchAllExecutions = vi.fn().mockResolvedValue({ executions: [exec(), exec({ hostname: 'HOST, 02' })], total: 2 });
    const { user } = setup({ onFetchAllExecutions });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0]).toMatchObject({ name: 'executions.csv', type: 'text/csv' });
    const lines = downloaded[0].text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Hostname');
    // A value with a comma is quoted.
    expect(lines[2]).toContain('"HOST, 02"');
    expect(onFetchAllExecutions).toHaveBeenCalledTimes(1);
  });

  it('exports JSON', async () => {
    const { user } = setup({ onFetchAllExecutions: vi.fn().mockResolvedValue({ executions: [exec()], total: 1 }) });

    await user.click(screen.getByRole('button', { name: 'Export JSON' }));

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0]).toMatchObject({ name: 'executions.json', type: 'application/json' });
    expect(JSON.parse(downloaded[0].text)).toEqual([expect.objectContaining({ test_name: 'Solo test' })]);
  });

  it('exports the page it was given when it cannot fetch every result', async () => {
    const { user } = setup({ pageExecutions: [exec(), exec()] });

    await user.click(screen.getByRole('button', { name: 'Export JSON' }));

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(JSON.parse(downloaded[0].text)).toHaveLength(2);
  });

  it('says when it exported the newest part only', async () => {
    const { user } = setup({ onFetchAllExecutions: vi.fn().mockResolvedValue({ executions: [exec()], total: 12345 }) });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Exported the newest 1 of 12,345 results.');
  });

  it('says when the results could not be loaded, and downloads nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = setup({ onFetchAllExecutions: vi.fn().mockRejectedValue(new Error('boom')) });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Export failed: could not load the results.');
    expect(downloaded).toHaveLength(0);
  });

  it('downloads nothing when there is no result', async () => {
    const onFetchAllExecutions = vi.fn().mockResolvedValue({ executions: [], total: 0 });
    const { user } = setup({ onFetchAllExecutions });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(onFetchAllExecutions).toHaveBeenCalled());
    expect(downloaded).toHaveLength(0);
  });

  it('quotes a value that holds a quote or a line break', async () => {
    const onFetchAllExecutions = vi.fn().mockResolvedValue({ executions: [exec({ test_name: 'Says "hi"' }), exec({ test_name: 'two\nlines' })], total: 2 });
    const { user } = setup({ onFetchAllExecutions });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0].text).toContain('"Says ""hi"""');
    expect(downloaded[0].text).toContain('"two\nlines"');
  });

  it('says it is exporting while the results load, and takes no second click meanwhile', async () => {
    let resolve!: (v: { executions: EnrichedTestExecution[]; total: number }) => void;
    const onFetchAllExecutions = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const { user } = setup({ onFetchAllExecutions });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    const busy = screen.getAllByRole('button', { name: 'Exporting…' });
    expect(busy).toHaveLength(2);
    for (const button of busy) expect(button).toBeDisabled();
    resolve({ executions: [exec()], total: 1 });
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('drops the note of an earlier export when a new one starts', async () => {
    const onFetchAllExecutions = vi.fn()
      .mockResolvedValueOnce({ executions: [exec()], total: 9 })
      .mockResolvedValueOnce({ executions: [exec()], total: 1 });
    const { user } = setup({ onFetchAllExecutions });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByRole('status');

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('adds the version columns only where versions are shown', async () => {
    const fetchAll = () => vi.fn().mockResolvedValue({ executions: [exec()], total: 1 });
    const first = setup({ onFetchAllExecutions: fetchAll(), showVersions: true });
    await first.user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(downloaded).toHaveLength(1));

    expect(downloaded[0].text.split('\n')[0]).toMatch(/version_state$/);
  });

  it('offers the PDF report and the SB export only where the page provides them', async () => {
    const onExportSbReport = vi.fn().mockResolvedValue(undefined);
    const { user } = setup({}, { reportHref: '/analytics/report?x=1', onExportSbReport });

    expect(screen.getByRole('link', { name: 'Report (PDF)' })).toHaveAttribute('href', '/analytics/report?x=1');
    await user.click(screen.getByRole('button', { name: 'SB Export' }));
    expect(onExportSbReport).toHaveBeenCalledTimes(1);
  });

  it('offers neither without them', () => {
    setup();

    expect(screen.queryByRole('link', { name: 'Report (PDF)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SB Export/ })).not.toBeInTheDocument();
  });
});

describe('archive by date', () => {
  it('is offered only where the page can archive', () => {
    setup();
    expect(screen.queryByRole('button', { name: /Archive by date/ })).not.toBeInTheDocument();
  });

  it('needs a date, archives everything before it, and closes', async () => {
    const onArchiveByDate = vi.fn().mockResolvedValue(undefined);
    const { user } = setup({}, { onArchiveByDate });

    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    const confirm = screen.getByRole('button', { name: 'Archive' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Archive all executions before:'), '2026-01-15');
    await user.click(confirm);

    await waitFor(() => expect(onArchiveByDate).toHaveBeenCalledWith('2026-01-15'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument());
    // The next time it starts without a date: the one just used must not be one click from being used again.
    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    expect(screen.getByLabelText('Archive all executions before:')).toHaveValue('');
  });

  it('says that it archives everything before the date, whatever the filters', async () => {
    // It sends the date alone. Above a view filtered to one host, a user must not think it archives that host only.
    const { user } = setup({}, { onArchiveByDate: vi.fn() });
    await user.click(screen.getByRole('button', { name: /Archive by date/ }));

    expect(screen.getByText('Every execution before this date is archived, whatever the filters above.')).toBeInTheDocument();
  });

  it('stays open, with its date, when the archive did not go through', async () => {
    const onArchiveByDate = vi.fn().mockResolvedValue(false);
    const { user } = setup({}, { onArchiveByDate });
    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    await user.type(screen.getByLabelText('Archive all executions before:'), '2026-01-15');

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(onArchiveByDate).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Archive all executions before:')).toHaveValue('2026-01-15');
  });

  it('cannot be confirmed or dismissed while the archive runs', async () => {
    const { user } = setup({}, { onArchiveByDate: vi.fn(), archiving: true });
    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    await user.type(screen.getByLabelText('Archive all executions before:'), '2026-01-15');

    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('archives nothing on Cancel, and starts without a date the next time', async () => {
    const onArchiveByDate = vi.fn().mockResolvedValue(undefined);
    const { user } = setup({}, { onArchiveByDate });
    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    await user.type(screen.getByLabelText('Archive all executions before:'), '2026-01-15');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onArchiveByDate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    expect(screen.getByLabelText('Archive all executions before:')).toHaveValue('');
  });
});

describe('the list\'s own controls', () => {
  it('sit before the shared ones', () => {
    const options: HookOptions = { pageExecutions: [], showVersions: false };
    function WithSort() {
      const exportState = useExecutionsExport(options);
      return <ExecutionsToolbar exportState={exportState}><button>sort control</button></ExecutionsToolbar>;
    }
    render(<WithSort />);

    const sort = screen.getByRole('button', { name: 'sort control' });
    const exportButton = screen.getByRole('button', { name: /^Export$/ });
    expect(sort.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
