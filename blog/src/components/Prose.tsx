export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-display prose-headings:tracking-tight prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-accent prose-code:font-mono">
      {children}
    </div>
  );
}
