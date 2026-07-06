import Link from 'next/link';
import type { Post } from '@/lib/posts';
import { TagBadge } from './TagBadge';

export function PostCard({ post, featured = false }: { post: Post; featured?: boolean }) {
  return (
    <article className={featured ? 'border-b border-border pb-10' : ''}>
      <p className="font-mono text-xs text-muted">
        {post.date} · {post.readingTimeMinutes} min read
      </p>
      <h2 className={`mt-2 font-display font-bold tracking-tight ${featured ? 'text-3xl' : 'text-xl'}`}>
        <Link href={`/posts/${post.slug}`} className="transition-colors hover:text-accent">
          {post.title}
        </Link>
      </h2>
      <p className="mt-2 text-muted">{post.description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {post.tags.map((tag) => (
          <TagBadge key={tag} tag={tag} />
        ))}
      </div>
    </article>
  );
}
