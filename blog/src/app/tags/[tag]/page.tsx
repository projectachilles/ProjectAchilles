import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PostCard } from '@/components/PostCard';
import { getAllTags, getPostsByTag } from '@/lib/posts';

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllTags().map(({ tag }) => ({ tag }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  return {
    title: `#${tag}`,
    description: `Posts tagged ${tag} on the ProjectAchilles blog.`,
    alternates: { canonical: `/tags/${tag}` },
  };
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const posts = getPostsByTag(tag);
  if (posts.length === 0) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">// tag</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">#{tag}</h1>
      <p className="mt-2 font-mono text-xs text-muted">
        {posts.length} post{posts.length === 1 ? '' : 's'}
      </p>
      <div className="mt-10 space-y-10">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
