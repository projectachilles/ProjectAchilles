import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { PluggableList } from 'unified';

interface MarkdownViewerProps {
  content: string;
  /** When the document's first h1 repeats this text, the h1 is not rendered. */
  hideTitle?: string;
}

interface MdNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdNode[];
}

function mdText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(mdText).join('');
}

/** Pure AST transform: removes the first depth-1 heading when its text equals `title`. */
function remarkDropTitle(title: string) {
  const wanted = title.trim().toLowerCase();
  return () => (tree: MdNode) => {
    const first = (tree.children ?? []).findIndex(n => n.type === 'heading' && n.depth === 1);
    if (first >= 0 && mdText(tree.children![first]).trim().toLowerCase() === wanted) {
      tree.children!.splice(first, 1);
    }
  };
}

export default function MarkdownViewer({ content, hideTitle }: MarkdownViewerProps) {
  const remarkPlugins: PluggableList = hideTitle ? [remarkGfm, remarkDropTitle(hideTitle)] : [remarkGfm];

  const components: Components = {
    h1: ({ children }) => <h1 className="max-w-[72ch] text-lg font-semibold mt-6 mb-3 text-foreground">{children}</h1>,
    h2: ({ children }) => (
      <h2 className="max-w-[72ch] text-base font-semibold mt-6 mb-2 pb-1.5 border-b border-border text-foreground">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="max-w-[72ch] text-sm font-semibold mt-4 mb-1.5 text-foreground">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="max-w-[72ch] text-[13px] font-semibold mt-3 mb-1.5 text-muted">{children}</h4>
    ),
    p: ({ children }) => (
      <p className="max-w-[72ch] text-sm leading-[1.7] mb-3 text-foreground">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="max-w-[72ch] list-disc list-outside pl-5 mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="max-w-[72ch] list-decimal list-outside pl-5 mb-3 space-y-1">{children}</ol>
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
      <blockquote className="max-w-[72ch] border-l-2 border-accent/40 pl-4 text-muted not-italic mb-3">
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

  // Prose keeps a 72ch reading measure (set per element above); tables and
  // code blocks use the full width and scroll sideways when wider.
  return (
    <div className="h-full overflow-auto">
      <div className="px-1 py-2 sm:px-8 sm:py-6">
        <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
