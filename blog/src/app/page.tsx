import { PostCard } from '@/components/PostCard';
import { getListedPosts } from '@/lib/posts';

export default function HomePage() {
  const posts = getListedPosts();
  if (posts.length === 0) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-muted">No posts yet.</div>;
  }
  const [featured, ...rest] = posts;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">
        // continuous security validation
      </p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
        The ProjectAchilles Blog
      </h1>
      <p className="mt-3 max-w-xl text-muted">
        Purple teaming, detection engineering, and what we learn building a continuous
        validation platform.
      </p>
      <div className="mt-12 space-y-10">
        <PostCard post={featured} featured />
        {rest.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
