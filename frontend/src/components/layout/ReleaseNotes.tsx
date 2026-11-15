import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

/**
 * Release notes in the About dialog. Some of this markdown comes from GitHub
 * release pages, so it is treated as untrusted: raw HTML is not rendered
 * (react-markdown's default, no rehype-raw), images are dropped so opening
 * About never loads anything from a third party, and links open in a new tab.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 text-sm font-medium text-foreground">{children}</h4>,
  p: ({ children }) => <p className="mt-2 first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1.5 pl-5">{children}</ol>,
  code: ({ children }) => <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  pre: ({ children }) => <pre className="mt-2 overflow-x-auto rounded bg-raised p-2 font-mono text-xs">{children}</pre>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
};

export function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <div className="text-sm leading-relaxed text-muted">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={['img']} unwrapDisallowed>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
