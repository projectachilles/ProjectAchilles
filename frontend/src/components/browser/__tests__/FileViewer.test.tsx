import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileViewer from '../FileViewer';
import type { FileContent } from '@/types/test';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

function mkFile(overrides: Partial<FileContent>): FileContent {
  return { name: 'x', content: '', type: 'other', ...overrides };
}

describe('FileViewer', () => {
  it('routes ndjson through CodeViewer with json highlighter', () => {
    const file = mkFile({
      name: 'rules.ndjson',
      type: 'ndjson',
      content: '{"name":"rule1","level":"high"}\n{"name":"rule2","level":"low"}',
    });

    render(<FileViewer file={file} />);

    expect(screen.getByText('(json)')).toBeInTheDocument();
    expect(screen.getByText('rules.ndjson')).toBeInTheDocument();
  });

  it('pretty-prints ndjson content for display', () => {
    const file = mkFile({
      name: 'rules.ndjson',
      type: 'ndjson',
      content: '{"name":"rule1","level":"high"}',
    });

    const { container } = render(<FileViewer file={file} />);
    const code = container.querySelector('code')!;

    // Pretty-printed JSON should contain indented keys on separate lines
    expect(code.textContent).toContain('"name"');
    expect(code.textContent).toContain('"high"');
    // JSON.stringify(..., null, 2) produces a space after the colon;
    // the raw NDJSON input does not — so finding "name": "rule1" proves we re-serialized.
    expect(code.textContent).toContain('"name": "rule1"');
  });

  it('keeps malformed ndjson lines untouched (graceful fallback)', () => {
    const file = mkFile({
      name: 'rules.ndjson',
      type: 'ndjson',
      content: 'not valid json\n{"name":"rule1"}',
    });

    const { container } = render(<FileViewer file={file} />);
    const code = container.querySelector('code')!;

    expect(code.textContent).toContain('not valid json');
    expect(code.textContent).toContain('"name"');
  });

  it('routes sigma through CodeViewer with yaml highlighter', () => {
    const file = mkFile({
      name: 'rules.yml',
      type: 'sigma',
      content: 'title: Suspicious Activity\nlogsource:\n  product: windows',
    });

    render(<FileViewer file={file} />);

    expect(screen.getByText('(yaml)')).toBeInTheDocument();
  });
});
