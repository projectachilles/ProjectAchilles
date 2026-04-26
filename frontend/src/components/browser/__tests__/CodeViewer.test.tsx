import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CodeViewer from '../CodeViewer';

describe('CodeViewer', () => {
  it('renders code content', () => {
    const { container } = render(<CodeViewer content="const x = 42;" language="go" />);

    // Syntax highlighter splits tokens into separate spans, so check the code element
    const code = container.querySelector('code.language-go');
    expect(code).toBeInTheDocument();
    expect(code!.textContent).toContain('const');
    expect(code!.textContent).toContain('42');
  });

  it('displays filename in header', () => {
    render(<CodeViewer content="package main" language="go" filename="main.go" />);

    expect(screen.getByText('main.go')).toBeInTheDocument();
  });

  it('shows "Code" when no filename provided', () => {
    render(<CodeViewer content="echo hello" language="bash" />);

    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('maps known languages to syntax highlighter names', () => {
    render(<CodeViewer content="{}" language="json" />);

    expect(screen.getByText('(json)')).toBeInTheDocument();
  });

  it('falls back to "text" for unknown languages', () => {
    render(<CodeViewer content="data" language="unknown" />);

    expect(screen.getByText('(text)')).toBeInTheDocument();
  });

  it('maps yara to clike', () => {
    render(<CodeViewer content="rule test {}" language="yara" />);

    expect(screen.getByText('(clike)')).toBeInTheDocument();
  });

  it('maps kql to sql', () => {
    render(<CodeViewer content="SELECT *" language="kql" />);

    expect(screen.getByText('(sql)')).toBeInTheDocument();
  });

  it('maps sigma to yaml', () => {
    render(<CodeViewer content="title: test" language="sigma" />);

    expect(screen.getByText('(yaml)')).toBeInTheDocument();
  });

  it('maps ndjson to json', () => {
    render(<CodeViewer content='{"a":1}' language="ndjson" />);

    expect(screen.getByText('(json)')).toBeInTheDocument();
  });

  it('has a copy button', () => {
    render(<CodeViewer content="test" language="go" />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('shows line numbers', () => {
    const { container } = render(
      <CodeViewer content={'line1\nline2\nline3'} language="go" />
    );

    // react-syntax-highlighter adds line number spans
    const lineNumbers = container.querySelectorAll('.linenumber, .react-syntax-highlighter-line-number');
    expect(lineNumbers.length).toBeGreaterThan(0);
  });
});
