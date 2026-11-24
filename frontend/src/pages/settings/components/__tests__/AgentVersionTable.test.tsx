import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AgentVersionTable } from '../AgentVersionTable';
import type { AgentVersion } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({ agentApi: { deleteVersion: vi.fn() } }));

function version(over: Partial<AgentVersion>): AgentVersion {
  return {
    version: '0.7.6',
    os: 'windows',
    arch: 'amd64',
    binary_sha256: 'a'.repeat(64),
    binary_size: 7_800_000,
    release_notes: '',
    mandatory: false,
    signed: true,
    created_at: '2026-11-24T12:00:00Z',
    ...over,
  };
}

function rowOf(versionText: string): HTMLElement {
  return screen.getByText(versionText).closest('tr') as HTMLElement;
}

describe('AgentVersionTable source column', () => {
  it('shows the commit a version was built from', () => {
    render(
      <AgentVersionTable
        versions={[version({ release_notes: 'Built from source (windows/amd64) at 87c9bfd' })]}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    const commit = within(rowOf('0.7.6')).getByText('87c9bfd');
    expect(commit).toHaveAttribute('title', 'Built from source (windows/amd64) at 87c9bfd');
  });

  it('warns when the source was a different version than the one typed', () => {
    render(
      <AgentVersionTable
        versions={[version({ release_notes: 'Built from source (windows/amd64) at 9dd1b42 (source says 0.7.4)' })]}
        onDeleted={() => {}}
      />,
    );
    const row = within(rowOf('0.7.6'));
    expect(row.getByText('9dd1b42')).toBeInTheDocument();
    const warning = row.getByText('source says 0.7.4');
    expect(warning).toHaveClass('text-warning');
    expect(warning.getAttribute('title')).toContain('0.7.4');
  });

  it('says so when a build has no recorded commit', () => {
    render(
      <AgentVersionTable
        versions={[version({ release_notes: 'Built from source (windows/amd64)' })]}
        onDeleted={() => {}}
      />,
    );
    expect(within(rowOf('0.7.6')).getByText('commit not recorded')).toBeInTheDocument();
  });

  it('shows typed notes of an uploaded binary as text, and a dash when there are none', () => {
    render(
      <AgentVersionTable
        versions={[
          version({ version: '0.7.5', release_notes: 'Release binary from GitHub' }),
          version({ version: '0.7.4', release_notes: '' }),
        ]}
        onDeleted={() => {}}
      />,
    );
    const notes = within(rowOf('0.7.5')).getByText('Release binary from GitHub');
    expect(notes).toHaveAttribute('title', 'Release binary from GitHub');
    expect(within(rowOf('0.7.4')).getByTestId('version-source-none')).toHaveTextContent('—');
  });
});
