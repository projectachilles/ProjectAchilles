import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestDetails } from '@/types/test';

vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock('@/components/layout/ConsoleIdentity', () => ({
  IdentityPill: () => <span data-testid="identity-pill" />,
}));

const { default: TestDetailHeader } = await import('../TestDetailHeader');
const { severityPillClass } = await import('../severity');

const UUID = '7659eeba-f315-440e-9882-4aa015d68b27';

function makeTest(over: Partial<TestDetails> = {}): TestDetails {
  return {
    uuid: UUID,
    name: 'Credential Dump Test',
    category: 'intel-driven',
    subcategory: 'apt',
    severity: 'critical',
    techniques: [],
    stages: [],
    isMultiStage: false,
    files: [],
    ...over,
  } as unknown as TestDetails;
}

function renderHeader(props: Partial<Parameters<typeof TestDetailHeader>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TestDetailHeader
        test={makeTest()}
        backTo="/browser"
        canRun
        onRun={vi.fn()}
        canBuild
        hasBuild
        onDownload={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('severityPillClass', () => {
  it('maps severities to tokens', () => {
    expect(severityPillClass('critical')).toContain('text-danger');
    expect(severityPillClass('high')).toContain('text-warning');
    expect(severityPillClass('medium')).toContain('text-info');
    expect(severityPillClass('low')).toContain('text-muted');
    expect(severityPillClass(undefined)).toContain('text-muted');
  });
});

describe('TestDetailHeader', () => {
  it('renders one h1 with the name and a critical pill', () => {
    renderHeader();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Credential Dump Test');
    expect(screen.getByText('critical').className).toContain('text-danger');
  });

  it('hides Run when canRun is false and calls onRun otherwise', () => {
    const onRun = vi.fn();
    const { unmount } = renderHeader({ onRun });
    fireEvent.click(screen.getByRole('button', { name: /run on agents/i }));
    expect(onRun).toHaveBeenCalled();
    unmount();
    renderHeader({ canRun: false });
    expect(screen.queryByRole('button', { name: /run on agents/i })).toBeNull();
  });

  it('hides Download when there is no build', () => {
    renderHeader({ hasBuild: false });
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });

  it('shows Download only with canBuild and a build', () => {
    const onDownload = vi.fn();
    renderHeader({ onDownload });
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(onDownload).toHaveBeenCalled();
  });

  it('copies the full UUID', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderHeader();
    expect(screen.getByText(UUID.slice(0, 8))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy test ID' }));
    expect(writeText).toHaveBeenCalledWith(UUID);
  });

  it('omits complexity when undefined and shows the score chip when present', () => {
    const { unmount } = renderHeader();
    expect(screen.queryByText(/complexity/)).toBeNull();
    expect(screen.queryByText(/★/)).toBeNull();
    unmount();
    renderHeader({ test: makeTest({ complexity: 'high', score: 8.7 }) });
    expect(screen.getByText(/high complexity/)).toBeInTheDocument();
    expect(screen.getByText('★ 8.7')).toBeInTheDocument();
  });
});
