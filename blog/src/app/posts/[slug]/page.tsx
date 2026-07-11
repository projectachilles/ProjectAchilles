import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { Prose } from '@/components/Prose';
import { TagBadge } from '@/components/TagBadge';
import { mdxOptions } from '@/lib/mdx';
import { getAllPosts, getListedPosts, getPostBySlug, getTranslation } from '@/lib/posts';

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  const translation = getTranslation(post);
  const english = post.lang === 'en' ? post : translation;
  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: `/posts/${post.slug}`,
      ...(translation && {
        languages: {
          [post.lang]: `/posts/${post.slug}`,
          [translation.lang]: `/posts/${translation.slug}`,
          'x-default': `/posts/${(english ?? post).slug}`,
        },
      }),
    },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author.name],
      images: ['/og.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: ['/og.png'],
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  // Navigate across articles (one entry per translation pair), not across files —
  // otherwise a post's own translation would show up as its prev/next neighbor.
  const listed = getListedPosts();
  const index = listed.findIndex((p) => p.translationKey === post.translationKey);
  const newer = index > 0 ? listed[index - 1] : undefined;
  const older = index >= 0 && index < listed.length - 1 ? listed[index + 1] : undefined;
  const translation = getTranslation(post);

  return (
    <article lang={post.lang} className="mx-auto max-w-3xl px-4 py-12">
      <header>
        <p className="font-mono text-xs text-muted">
          {post.date} · {post.readingTimeMinutes} min read · {post.author.name}
        </p>
        {translation && (
          <Link
            href={`/posts/${translation.slug}`}
            rel="alternate"
            hrefLang={translation.lang}
            className="mt-2 inline-block font-mono text-xs text-accent transition-colors hover:underline"
          >
            {post.lang === 'es' ? 'Read in English →' : 'Leer en español →'}
          </Link>
        )}
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">{post.title}</h1>
        <p className="mt-3 text-lg text-muted">{post.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      </header>
      <div className="mt-10">
        <Prose>
          <MDXRemote source={post.content} options={mdxOptions} />
        </Prose>
      </div>
      <footer className="mt-12 border-t border-border pt-6">
        <p className="font-mono text-xs text-muted">
          {post.author.name} · {post.author.role}
        </p>
        <nav className="mt-6 flex justify-between gap-4 text-sm">
          {older ? (
            <Link href={`/posts/${older.slug}`} className="text-muted transition-colors hover:text-accent">
              ← {older.title}
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link href={`/posts/${newer.slug}`} className="text-right text-muted transition-colors hover:text-accent">
              {newer.title} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </footer>
    </article>
  );
}
