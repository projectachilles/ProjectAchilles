import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedTestExecution, RiskAcceptance } from '@/services/api/analytics';

// The dialogs a run's detail opens, shared by the executions list and the
// matrix drawer: accept a risk, revoke one, confirm an archive, test info.

vi.mock('../../TestInfoModal', () => ({
  default: (props: { open: boolean; testName: string; onClose: () => void }) =>
    props.open ? <div data-testid="info">info of {props.testName}<button onClick={props.onClose}>close info</button></div> : null,
}));

const { useRunDetailDialogs } = await import('../RunDetailDialogs');
type Options = Parameters<typeof useRunDetailDialogs>[0];

const ITEMS = [
  { test_name: 'Solo test', hostname: 'HOST-01' },
  { test_name: 'Chain A', control_id: 'T1486', hostname: 'HOST-01' },
];

function Harness(options: Options) {
  const d = useRunDetailDialogs(options);
  return (
    <>
      <button onClick={() => d.panelProps.onRequestAcceptRisk(ITEMS)}>ask accept</button>
      <button onClick={() => d.requestAcceptRisk([ITEMS[0]])}>ask bulk accept</button>
      <button onClick={() => d.panelProps.onRequestRevoke({ id: 'acc-1', testName: 'Solo test' })}>ask revoke</button>
      <button onClick={() => d.panelProps.onRequestArchive(['run-1', 'run-2'])}>ask archive</button>
      <button onClick={() => d.requestArchive(['run-9'])}>ask bulk archive</button>
      <button onClick={() => d.panelProps.onOpenInfo({ testUuid: 'u', testName: 'Solo test', hasInfoCard: true, hasReadme: false })}>ask info</button>
      <output data-testid="state">
        {JSON.stringify({ anyOpen: d.anyOpen, risk: d.panelProps.riskEnabled, archive: d.panelProps.archiveEnabled })}
      </output>
      <output data-testid="acceptance">
        {d.panelProps.getAcceptanceForExec({ test_name: 'Solo test', hostname: 'HOST-01' } as EnrichedTestExecution)?.acceptance_id ?? 'none'}
      </output>
      {d.dialogs}
    </>
  );
}

function setup(over: Partial<Options> = {}) {
  const options: Options = {
    onAcceptRisk: vi.fn().mockResolvedValue(undefined),
    onRevokeRisk: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onArchived: vi.fn(),
    ...over,
  };
  const view = render(<Harness {...options} />);
  return { ...view, options, user: userEvent.setup() };
}
const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}');
const justification = () => screen.getByPlaceholderText(/why this risk is being accepted/);
const reason = () => screen.getByPlaceholderText(/why this acceptance is being revoked/);

describe('what the detail may offer', () => {
  it('offers risk and archive actions only where the page can carry them out', () => {
    setup();
    expect(state()).toEqual({ anyOpen: false, risk: true, archive: true });
  });

  it('offers neither without the handlers', () => {
    setup({ onAcceptRisk: undefined, onArchive: undefined });
    expect(state()).toMatchObject({ risk: false, archive: false });
  });

  it('finds the acceptance that covers a result', () => {
    const acceptance = { acceptance_id: 'acc-1', test_name: 'Solo test', scope: 'global' } as unknown as RiskAcceptance;
    setup({ riskAcceptances: new Map([['Solo test', [acceptance]]]) });
    expect(screen.getByTestId('acceptance')).toHaveTextContent('acc-1');
  });

  it('finds none without a lookup', () => {
    setup();
    expect(screen.getByTestId('acceptance')).toHaveTextContent('none');
  });
});

describe('accepting a risk', () => {
  it('lists what is accepted and needs a justification of ten characters', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask accept' }));

    expect(screen.getByText('Solo test')).toBeInTheDocument();
    expect(screen.getByText('Chain A::T1486')).toBeInTheDocument();
    expect(state().anyOpen).toBe(true);
    const confirm = screen.getByRole('button', { name: 'Accept Risk' });
    expect(confirm).toBeDisabled();

    await user.type(justification(), 'too short');
    expect(screen.getByText('Minimum 10 characters required')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.type(justification(), ', now long enough   ');
    expect(confirm).toBeEnabled();
    expect(options.onAcceptRisk).not.toHaveBeenCalled();
  });

  it('accepts for all hosts by default: the hostname is left out', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask accept' }));
    await user.type(justification(), '  not applicable to this fleet  ');
    await user.click(screen.getByRole('button', { name: 'Accept Risk' }));

    await waitFor(() => expect(options.onAcceptRisk).toHaveBeenCalledTimes(1));
    expect(options.onAcceptRisk).toHaveBeenCalledWith(
      [
        { test_name: 'Solo test', hostname: undefined, scope: 'global' },
        { test_name: 'Chain A', control_id: 'T1486', hostname: undefined, scope: 'global' },
      ],
      'not applicable to this fleet',
    );
    await waitFor(() => expect(state().anyOpen).toBe(false));
  });

  it('accepts for this host only when asked, keeping the hostname', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask bulk accept' }));
    await user.click(screen.getByRole('button', { name: 'This Host Only' }));
    await user.type(justification(), 'this host is a lab machine');
    await user.click(screen.getByRole('button', { name: 'Accept Risk' }));

    await waitFor(() => expect(options.onAcceptRisk).toHaveBeenCalledWith([{ test_name: 'Solo test', hostname: 'HOST-01', scope: 'host' }], 'this host is a lab machine'));
  });

  it('starts empty and for all hosts the next time, after a confirm and after a cancel', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask accept' }));
    await user.click(screen.getByRole('button', { name: 'This Host Only' }));
    await user.type(justification(), 'this host is a lab machine');
    await user.click(screen.getByRole('button', { name: 'Accept Risk' }));
    await waitFor(() => expect(state().anyOpen).toBe(false));

    await user.click(screen.getByRole('button', { name: 'ask accept' }));
    expect(justification()).toHaveValue('');
    await user.type(justification(), 'another reason, long enough');
    await user.click(screen.getByRole('button', { name: 'Accept Risk' }));
    await waitFor(() => expect(options.onAcceptRisk).toHaveBeenCalledTimes(2));
    expect((options.onAcceptRisk as ReturnType<typeof vi.fn>).mock.calls[1][0][0]).toMatchObject({ scope: 'global', hostname: undefined });

    await user.click(screen.getByRole('button', { name: 'ask accept' }));
    await user.type(justification(), 'typed, then cancelled');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state().anyOpen).toBe(false);
    await user.click(screen.getByRole('button', { name: 'ask accept' }));
    expect(justification()).toHaveValue('');
  });

  it('cannot be confirmed or dismissed while the request is running', async () => {
    const { user, options } = setup({ acceptingRisk: true });
    await user.click(screen.getByRole('button', { name: 'ask accept' }));
    await user.type(justification(), 'long enough justification');

    expect(screen.getByRole('button', { name: 'Accept Risk' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(options.onAcceptRisk).not.toHaveBeenCalled();
    expect(state().anyOpen).toBe(true);
  });
});

describe('revoking an acceptance', () => {
  it('needs a reason of ten characters, revokes that acceptance, closes and starts empty next time', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask revoke' }));

    expect(screen.getByText('Solo test')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Revoke Acceptance' });
    expect(confirm).toBeDisabled();
    await user.type(reason(), '  the control is in place now  ');
    await user.click(confirm);

    await waitFor(() => expect(options.onRevokeRisk).toHaveBeenCalledWith('acc-1', 'the control is in place now'));
    await waitFor(() => expect(state().anyOpen).toBe(false));
    await user.click(screen.getByRole('button', { name: 'ask revoke' }));
    expect(reason()).toHaveValue('');
  });

  it('does nothing on Cancel', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask revoke' }));
    await user.type(reason(), 'typed, then cancelled');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(options.onRevokeRisk).not.toHaveBeenCalled();
    expect(state().anyOpen).toBe(false);
    await user.click(screen.getByRole('button', { name: 'ask revoke' }));
    expect(reason()).toHaveValue('');
  });
});

describe('archiving', () => {
  it('says how many runs, archives exactly those, closes and reports it', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask archive' }));

    expect(screen.getByText(/execution groups to the archive/)).toHaveTextContent('This will move 2 execution groups to the archive.');
    expect(state().anyOpen).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(options.onArchive).toHaveBeenCalledWith(['run-1', 'run-2']));
    await waitFor(() => expect(options.onArchived).toHaveBeenCalledTimes(1));
    expect(state().anyOpen).toBe(false);
  });

  it('archives the runs of a bulk request, in the singular for one', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask bulk archive' }));

    expect(screen.getByText(/to the archive/)).toHaveTextContent('This will move 1 execution group to the archive.');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(options.onArchive).toHaveBeenCalledWith(['run-9']));
  });

  it('archives nothing on Cancel', async () => {
    const { user, options } = setup();
    await user.click(screen.getByRole('button', { name: 'ask archive' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(options.onArchive).not.toHaveBeenCalled();
    expect(options.onArchived).not.toHaveBeenCalled();
    expect(state().anyOpen).toBe(false);
  });
});

describe('test info', () => {
  it('opens for the test asked about and closes', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'ask info' }));

    expect(screen.getByTestId('info')).toHaveTextContent('info of Solo test');
    expect(state().anyOpen).toBe(true);
    await user.click(screen.getByRole('button', { name: 'close info' }));
    expect(screen.queryByTestId('info')).not.toBeInTheDocument();
    expect(state().anyOpen).toBe(false);
  });
});
