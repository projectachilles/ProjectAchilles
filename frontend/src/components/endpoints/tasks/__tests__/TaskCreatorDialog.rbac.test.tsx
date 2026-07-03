import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AppRole } from '@/types/roles';
import { getPermissionsForRole } from '@/types/roles';

// The Command task type runs arbitrary shell on the endpoint and is admin-only
// on the backend (requirePermission('endpoints:tasks:command')). The frontend
// must not surface the affordance to roles that would only hit a 403 on submit.
// This mirrors the backend guarantee in backend/src/__tests__/types/roles.test.ts.

// Mutable role driven per-test; useHasPermission runs the REAL RBAC matrix so
// the test breaks if the permission is ever (wrongly) granted to a lower role.
let currentRole: AppRole | undefined;

vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => currentRole,
  useHasPermission: (...permissions: string[]) => {
    const granted = getPermissionsForRole(currentRole);
    return permissions.every((p) => granted.has(p as never));
  },
  useCanAccessModule: () => true,
}));

// Keep the dialog's on-open data fetches inert and deterministic.
vi.mock('@/services/api/agent', () => ({
  agentApi: { listAgents: vi.fn().mockResolvedValue({ agents: [] }) },
}));
vi.mock('@/services/api/browser', () => ({
  browserApi: { getAllTests: vi.fn().mockResolvedValue([]), getBuildInfo: vi.fn() },
}));
vi.mock('@/services/api/analytics', () => ({
  analyticsApi: { listIndices: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: { getAzureSettings: vi.fn().mockResolvedValue({ configured: false }) },
}));

import TaskCreatorDialog from '../TaskCreatorDialog';

function renderDialog() {
  return render(<TaskCreatorDialog open onClose={() => {}} />);
}

describe('TaskCreatorDialog — command task RBAC gating', () => {
  beforeEach(() => {
    cleanup();
  });

  it('shows the Command task type for admins', () => {
    currentRole = 'admin';
    renderDialog();
    expect(screen.getByText('Task Type')).toBeInTheDocument();
    expect(screen.getByText('Command')).toBeInTheDocument();
  });

  it('hides the Command task type for operators', () => {
    currentRole = 'operator';
    renderDialog();
    // The whole Task Type toggle collapses to nothing when the only other
    // option is unavailable — no lone single-option chooser.
    expect(screen.queryByText('Task Type')).not.toBeInTheDocument();
    expect(screen.queryByText('Command')).not.toBeInTheDocument();
  });

  it('hides the Command task type for analysts and explorers', () => {
    for (const role of ['analyst', 'explorer', undefined] as const) {
      currentRole = role;
      renderDialog();
      expect(screen.queryByText('Command')).not.toBeInTheDocument();
      cleanup();
    }
  });
});
