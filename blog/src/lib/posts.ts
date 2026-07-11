import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { authors, type Author } from '../../content/authors';
import { readingTimeMinutes } from './readingTime';

const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const postFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
  tags: z
    .array(z.string().regex(TAG_RE, 'tags must be kebab-case (a-z, 0-9, hyphens)'))
    .min(1),
  author: z.string().refine((id) => id in authors, { message: 'unknown author id' }),
  lang: z.enum(['en', 'es']).default('en'),
  translationKey: z
    .string()
    .regex(TAG_RE, 'translationKey must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
  image: z.string().optional(),
  draft: z.boolean().default(false),
});

export interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  author: Author;
  lang: 'en' | 'es';
  translationKey: string;
  image?: string;
  draft: boolean;
  readingTimeMinutes: number;
  content: string;
}

export interface GetPostsOptions {
  postsDir?: string;
  includeDrafts?: boolean;
}

const DEFAULT_POSTS_DIR = path.join(process.cwd(), 'content', 'posts');

// Slugs become URL path segments verbatim; anything outside kebab-case would
// ship a broken (or scheme-smuggling) href, so reject it at build time.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parsePostFile(filePath: string): Post {
  const slug = path.basename(filePath).replace(/\.mdx$/, '');
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid post filename ${path.basename(filePath)} — slug must be kebab-case (a-z, 0-9, hyphens)`,
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  const parsed = postFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter in ${path.basename(filePath)} — ${issues}`);
  }
  const fm = parsed.data;
  return {
    slug,
    title: fm.title,
    description: fm.description,
    date: fm.date,
    tags: fm.tags,
    author: authors[fm.author],
    lang: fm.lang,
    translationKey: fm.translationKey ?? slug,
    image: fm.image,
    draft: fm.draft,
    readingTimeMinutes: readingTimeMinutes(content),
    content,
  };
}

export function getAllPosts(opts: GetPostsOptions = {}): Post[] {
  const dir = opts.postsDir ?? DEFAULT_POSTS_DIR;
  const includeDrafts = opts.includeDrafts ?? process.env.NODE_ENV !== 'production';
  const posts = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => parsePostFile(path.join(dir, file)))
    .filter((post) => includeDrafts || !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Map<string, string>();
  for (const post of posts) {
    const key = `${post.translationKey}:${post.lang}`;
    const clash = seen.get(key);
    if (clash) {
      throw new Error(
        `Posts "${clash}" and "${post.slug}" both declare translationKey "${post.translationKey}" with lang "${post.lang}" — a pair must have one file per language`,
      );
    }
    seen.set(key, post.slug);
  }
  return posts;
}

/**
 * Posts for listing surfaces (homepage, tags, feed): translation pairs are
 * collapsed to a single entry, preferring the English version.
 */
export function getListedPosts(opts: GetPostsOptions = {}): Post[] {
  const posts = getAllPosts(opts);
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const group = groups.get(post.translationKey) ?? [];
    group.push(post);
    groups.set(post.translationKey, group);
  }
  const listed = new Set<string>();
  for (const group of groups.values()) {
    const preferred = group.find((post) => post.lang === 'en') ?? group[0];
    listed.add(preferred.slug);
  }
  return posts.filter((post) => listed.has(post.slug));
}

export function getTranslation(post: Post, opts: GetPostsOptions = {}): Post | undefined {
  return getAllPosts(opts).find(
    (candidate) => candidate.translationKey === post.translationKey && candidate.lang !== post.lang,
  );
}

export function getPostBySlug(slug: string, opts: GetPostsOptions = {}): Post | undefined {
  return getAllPosts(opts).find((post) => post.slug === slug);
}

export function getAllTags(opts: GetPostsOptions = {}): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of getAllPosts(opts)) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function getPostsByTag(tag: string, opts: GetPostsOptions = {}): Post[] {
  return getAllPosts(opts).filter((post) => post.tags.includes(tag));
}
