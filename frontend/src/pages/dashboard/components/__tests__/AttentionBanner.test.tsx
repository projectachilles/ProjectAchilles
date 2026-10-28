import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttentionBanner, type AttentionItem } from '../AttentionBanner';

const items: AttentionItem[] = [
  { id: 'offline-agents', count: 11, label: 'offline', title: '11 agent(s) offline', to: '/agents', severity: 'warning' },
  { id: 'failed-tasks', count: 2, label: 'tasks failed · 24h', title: '2 task(s) failed in the last 24h', to: '/tasks', severity: 'danger' },
  { id: 'sync-failed', label: 'library sync failed', title: 'Test library sync failed', to: '/tests', severity: 'danger' },
];

function renderBanner(list: AttentionItem[]) {
  render(
    <MemoryRouter>
      <AttentionBanner items={list} />
    </MemoryRouter>,
  );
}

describe('AttentionBanner count chips', () => {
  it('renders one link per item, named by its full sentence and pointing at its page', () => {
    renderBanner(items);
    const offline = screen.getByRole('link', { name: '11 agent(s) offline' });
    expect(offline.getAttribute('href')).toBe('/agents');
    expect(offline.textContent).toBe('11offline');
    expect(screen.getByRole('link', { name: 'Test library sync failed' }).textContent).toBe('library sync failed');
  });

  it('colours the dot by severity', () => {
    renderBanner(items);
    const dot = (name: string) => screen.getByRole('link', { name }).querySelector('[data-severity]');
    expect(dot('11 agent(s) offline')?.getAttribute('data-severity')).toBe('warning');
    expect(dot('2 task(s) failed in the last 24h')?.getAttribute('data-severity')).toBe('danger');
  });

  it('says all clear, with no links, when nothing needs attention', () => {
    renderBanner([]);
    expect(screen.getByText('all clear')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
