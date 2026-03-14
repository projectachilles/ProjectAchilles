import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleSection from '../CollapsibleSection';
import { FileText } from 'lucide-react';

// Stub localStorage (jsdom may not provide a fully functional one)
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(localStorageStore)) delete localStorageStore[k]; }),
  get length() { return Object.keys(localStorageStore).length; },
  key: vi.fn((i: number) => Object.keys(localStorageStore)[i] ?? null),
};
vi.stubGlobal('localStorage', mockLocalStorage);

// Clear localStorage before each test
beforeEach(() => {
  mockLocalStorage.clear();
  vi.clearAllMocks();
  // Re-stub the mock fns after clearAllMocks
  mockLocalStorage.getItem.mockImplementation((key: string) => localStorageStore[key] ?? null);
  mockLocalStorage.setItem.mockImplementation((key: string, value: string) => { localStorageStore[key] = value; });
  mockLocalStorage.removeItem.mockImplementation((key: string) => { delete localStorageStore[key]; });
  mockLocalStorage.clear.mockImplementation(() => { for (const k of Object.keys(localStorageStore)) delete localStorageStore[k]; });
  mockLocalStorage.key.mockImplementation((i: number) => Object.keys(localStorageStore)[i] ?? null);
});

describe('CollapsibleSection', () => {
  it('renders label text', () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs">
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });

  it('shows children when defaultOpen is true', () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen>
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Content')).toBeVisible();
  });

  it('hides children when defaultOpen is false', () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );
    const content = screen.getByText('Content');
    expect(content.closest('[data-collapsed="true"]')).toBeTruthy();
  });

  it('toggles open/closed on header click', async () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Content').closest('[data-collapsed="true"]')).toBeTruthy();

    await userEvent.click(screen.getByText('Documentation'));
    expect(screen.getByText('Content').closest('[data-collapsed="false"]')).toBeTruthy();

    await userEvent.click(screen.getByText('Documentation'));
    expect(screen.getByText('Content').closest('[data-collapsed="true"]')).toBeTruthy();
  });

  it('displays item count badge when provided', () => {
    render(
      <CollapsibleSection icon={FileText} label="Source Code" sectionKey="source" itemCount={8}>
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('does not display item count badge when omitted', () => {
    render(
      <CollapsibleSection icon={FileText} label="Build" sectionKey="build">
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('persists open state to localStorage', async () => {
    render(
      <CollapsibleSection icon={FileText} label="Docs" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    await userEvent.click(screen.getByText('Docs'));
    expect(localStorage.getItem('achilles-sidebar-docs')).toBe('true');
  });

  it('reads persisted state from localStorage on mount', () => {
    localStorage.setItem('achilles-sidebar-docs', 'true');

    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Content').closest('[data-collapsed="false"]')).toBeTruthy();
  });

  it('auto-expands when isActive becomes true', () => {
    const { rerender } = render(
      <CollapsibleSection icon={FileText} label="Source" sectionKey="source" defaultOpen={false} isActive={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Content').closest('[data-collapsed="true"]')).toBeTruthy();

    rerender(
      <CollapsibleSection icon={FileText} label="Source" sectionKey="source" defaultOpen={false} isActive={true}>
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Content').closest('[data-collapsed="false"]')).toBeTruthy();
  });
});
