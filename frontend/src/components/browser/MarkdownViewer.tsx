import { useRef } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownViewerProps {
  content: string;
  /** When the document's first h1 repeats this text, the h1 is not rendered. */
  hideTitle?: string;
}

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

export default function MarkdownViewer({ content, hideTitle }: MarkdownViewerProps) {
  // Reset on every render so only the document's first h1 is considered.
  const firstH1Seen = useRef(false);
  firstH1Seen.current = false;

  const components: Components = {
    h1: ({ children }) => {
      const isFirst = !firstH1Seen.current;
      firstH1Seen.current = true;
      if (
        isFirst &&
        hideTitle &&
        nodeText(children).trim().toLowerCase() === hideTitle.trim().toLowerCase()
      ) {
        return null;
      }
      return <h1 className="text-lg font-semibold mt-6 mb-3 text-foreground">{children}</h1>;
    },
    h2: ({ children }) => (
      <h2 className="text-base font-semibold mt-6 mb-2 pb-1.5 border-b border-border text-foreground">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-semibold mt-4 mb-1.5 text-foreground">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-[13px] font-semibold mt-3 mb-1.5 text-muted">{children}</h4>
    ),
    p: ({ children }) => (
      <p className="text-sm leading-[1.7] mb-3 text-foreground">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-outside pl-5 mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-outside pl-5 mb-3 space-y-1">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-sm leading-[1.65] text-foreground">{children}</li>
    ),
    code: ({ children, className }) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="font-mono text-[12.5px] bg-raised border border-border rounded px-1 text-foreground">
            {children}
          </code>
        );
      }
      return (
        <code className="block p-4 rounded-lg bg-raised text-[12.5px] font-mono overflow-x-auto text-foreground">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-3 p-4 rounded-lg bg-raised text-[12.5px] overflow-x-auto text-foreground">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-accent/40 pl-4 text-muted not-italic mb-3">
        {children}
      </blockquote>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline"
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto mb-3">
        <table className="min-w-full text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-raised">{children}</thead>,
    th: ({ children }) => (
      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-faint border-b border-border">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 text-[13px] border-b border-border text-foreground">{children}</td>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    hr: () => <hr className="my-6 border-border" />,
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[72ch] px-8 py-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
