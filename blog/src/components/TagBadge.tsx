import Link from 'next/link';

export function TagBadge({ tag }: { tag: string }) {
  return (
    <Link
      href={`/tags/${tag}`}
      className="rounded-full border border-border px-2.5 py-0.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
    >
      {tag}
    </Link>
  );
}
