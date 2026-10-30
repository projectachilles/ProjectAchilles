import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConsoleIdentity } from '@/types/consoleIdentity';

const state = vi.hoisted(() => ({ identity: null as ConsoleIdentity | null }));

vi.mock('@/hooks/useConsoleIdentity', () => ({
  useConsoleIdentity: () => ({
    identity: state.identity,
    active: state.identity?.code != null,
    setIdentity: () => {},
    refresh: async () => {},
  }),
}));

import { PageHeader } from '../Layout';

describe('endpoints PageHeader', () => {
  beforeEach(() => {
    state.identity = null;
  });

  it('shows the identity pill beside the actions when identity is active', () => {
    state.identity = { code: 'ACME', name: 'Acme Financial Group', color: 'violet', source: 'saved' };
    render(<PageHeader title="Tasks" description="d" actions={<button>Go</button>} />);
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('renders no pill without an identity', () => {
    render(<PageHeader title="Tasks" actions={<button>Go</button>} />);
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });
});
