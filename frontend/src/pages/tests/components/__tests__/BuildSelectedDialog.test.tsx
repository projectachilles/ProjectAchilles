import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TestVersionRow, TestVersionStatus } from '@/types/testVersion';

const q = vi.hoisted(() => ({
  status: 'idle' as string,
  start: vi.fn((_items: unknown[]) => true),
  stop: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('@/hooks/useBuildQueue', () => ({
  useBuildQueue: () => ({
    state: { status: q.status, total: 0, current: null, results: [], end: null },
    start: q.start,
    stop: q.stop,
    dismiss: q.dismiss,
  }),
}));

import { BuildSelectedDialog } from '../BuildSelectedDialog';

const t = (id: string) => ({ uuid: id, name: `test ${id}` });
const row = (status: TestVersionStatus): TestVersionRow => ({
  status,
  custom: false,
  published: null,
  synced: null,
  built: null,
});

function renderDialog(
  tests = [t('a'), t('b'), t('c')],
  versions: Record<string, TestVersionRow> | null = null,
) {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(<BuildSelectedDialog open tests={tests} versions={versions} onClose={onClose} onStarted={onStarted} />);
  return { onClose, onStarted };
}

const confirm = () => screen.getByRole('button', { name: 'Build and sign' }) as HTMLButtonElement;

describe('BuildSelectedDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.status = 'idle';
    q.start.mockReturnValue(true);
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <BuildSelectedDialog open={false} tests={[t('a')]} versions={null} onClose={vi.fn()} onStarted={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('names the count and how the run behaves', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Build and sign 3 tests' })).toBeTruthy();
    expect(screen.getByText('One at a time. Each takes a few minutes.')).toBeTruthy();
    expect(screen.getByText('Keeps running while this console stays open in this tab.')).toBeTruthy();
  });

  it('with no version rows, says uploaded binaries are left as they are', () => {
    renderDialog();
    expect(screen.getByText('Tests with an uploaded binary are left as they are.')).toBeTruthy();
  });

  it('leaves out the tests the version rows say are uploaded, and says how many', () => {
    renderDialog([t('a'), t('b'), t('c'), t('d')], {
      a: row('unknown_build'),
      b: row('uploaded'),
      c: row('uploaded'),
      d: row('not_built'),
    });
    expect(screen.getByRole('heading', { name: 'Build and sign 2 tests' })).toBeTruthy();
    expect(screen.getByText('2 tests have an uploaded binary and are left as they are.')).toBeTruthy();
    expect(screen.queryByText('Tests with an uploaded binary are left as they are.')).toBeNull();
  });

  it('uses the singular for one uploaded test, and for one test to build', () => {
    renderDialog([t('a'), t('b')], { a: row('uploaded'), b: row('unknown_build') });
    expect(screen.getByRole('heading', { name: 'Build and sign 1 test' })).toBeTruthy();
    expect(screen.getByText('1 test has an uploaded binary and is left as it is.')).toBeTruthy();
  });

  it('says nothing about uploads when the version rows show none', () => {
    renderDialog([t('a')], { a: row('unknown_build') });
    expect(screen.queryByText(/uploaded binary/)).toBeNull();
  });

  it('disables Build and sign when nothing is left to build', () => {
    renderDialog([t('a')], { a: row('uploaded') });
    expect(screen.getByRole('heading', { name: 'Build and sign 0 tests' })).toBeTruthy();
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    expect(q.start).not.toHaveBeenCalled();
  });

  it('disables Build and sign while a run is going', () => {
    q.status = 'running';
    renderDialog();
    expect(confirm().disabled).toBe(true);
  });

  it('Build and sign starts the run with the tests in the order given, then reports it started', () => {
    const { onStarted, onClose } = renderDialog([t('c'), t('a'), t('b')], {
      a: row('unknown_build'),
      b: row('uploaded'),
      c: row('rebuild_needed'),
    });
    fireEvent.click(confirm());
    expect(q.start).toHaveBeenCalledTimes(1);
    expect(q.start).toHaveBeenCalledWith([t('c'), t('a')]);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts with only uuid and name per test', () => {
    renderDialog([{ ...t('a'), category: 'intel-driven' } as ReturnType<typeof t>]);
    fireEvent.click(confirm());
    expect(q.start).toHaveBeenCalledWith([{ uuid: 'a', name: 'test a' }]);
  });

  it('closes without starting when the run is refused', () => {
    q.start.mockReturnValue(false);
    const { onStarted, onClose } = renderDialog();
    fireEvent.click(confirm());
    expect(onStarted).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without starting', () => {
    const { onClose, onStarted } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(q.start).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
