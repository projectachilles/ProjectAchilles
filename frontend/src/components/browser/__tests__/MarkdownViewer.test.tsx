import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownViewer from '../MarkdownViewer';

describe('MarkdownViewer', () => {
  it('renders an h1 heading', () => {
    render(<MarkdownViewer content={'# Title'} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title');
  });

  it('renders an h2 heading', () => {
    render(<MarkdownViewer content={'## Subtitle'} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Subtitle');
  });

  it('renders an h3 heading', () => {
    render(<MarkdownViewer content={'### Section'} />);

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Section');
  });

  it('renders paragraphs', () => {
    render(<MarkdownViewer content="Hello world" />);

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    render(<MarkdownViewer content="Use `console.log` here" />);

    const code = screen.getByText('console.log');
    expect(code.tagName).toBe('CODE');
  });

  it('renders code blocks', () => {
    render(<MarkdownViewer content={'```\nconst x = 1;\n```'} />);

    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders links with target=_blank', () => {
    render(<MarkdownViewer content="[Example](https://example.com)" />);

    const link = screen.getByRole('link', { name: 'Example' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders unordered lists', () => {
    render(<MarkdownViewer content={'- Item A\n- Item B\n- Item C'} />);

    const lists = screen.getAllByRole('list');
    expect(lists.some(l => l.tagName === 'UL')).toBe(true);
  });

  it('renders ordered lists', () => {
    render(<MarkdownViewer content={'1. First\n2. Second'} />);

    const lists = screen.getAllByRole('list');
    expect(lists.some(l => l.tagName === 'OL')).toBe(true);
  });

  it('renders tables (GFM)', () => {
    const markdown = '| Name | Value |\n| --- | --- |\n| A | 1 |';
    render(<MarkdownViewer content={markdown} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
  });

  it('renders blockquotes', () => {
    render(<MarkdownViewer content="> Important note" />);

    const bq = screen.getByRole('blockquote');
    expect(bq).toHaveTextContent('Important note');
  });

  it('renders bold and italic text', () => {
    render(<MarkdownViewer content="**bold** and *italic*" />);

    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
  });

  it('renders horizontal rules', () => {
    // Markdown requires blank lines around --- for it to be treated as hr
    const { container } = render(<MarkdownViewer content={'above\n\n---\n\nbelow'} />);

    const separators = container.querySelectorAll('hr');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('handles empty content', () => {
    const { container } = render(<MarkdownViewer content="" />);

    expect(container.querySelector('.prose')).toBeInTheDocument();
  });
});
