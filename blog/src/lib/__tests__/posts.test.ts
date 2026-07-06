import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  getAllPosts,
  getAllTags,
  getPostBySlug,
  getPostsByTag,
  parsePostFile,
} from '../posts.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const POSTS_DIR = path.join(FIXTURES, 'posts');
const INVALID_DIR = path.join(FIXTURES, 'invalid');

describe('parsePostFile', () => {
  it('parses valid frontmatter into a Post', () => {
    const post = parsePostFile(path.join(POSTS_DIR, 'alpha-post.mdx'));
    expect(post.slug).toBe('alpha-post');
    expect(post.title).toBe('Alpha Post');
    expect(post.tags).toEqual(['security']);
    expect(post.author.name).toBe('James Pichardo');
    expect(post.draft).toBe(false);
    expect(post.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    expect(post.content).toContain('Alpha body content');
  });

  it('throws naming the file and field when title is missing', () => {
    expect(() => parsePostFile(path.join(INVALID_DIR, 'missing-title.mdx'))).toThrowError(
      /missing-title\.mdx.*title/s,
    );
  });

  it('rejects non-kebab-case tags', () => {
    expect(() => parsePostFile(path.join(INVALID_DIR, 'bad-tag.mdx'))).toThrowError(
      /bad-tag\.mdx.*tags/s,
    );
  });

  it('rejects unknown author ids', () => {
    expect(() => parsePostFile(path.join(INVALID_DIR, 'unknown-author.mdx'))).toThrowError(
      /unknown-author\.mdx.*author/s,
    );
  });
});

describe('getAllPosts', () => {
  it('sorts newest first and excludes drafts by default option', () => {
    const posts = getAllPosts({ postsDir: POSTS_DIR, includeDrafts: false });
    expect(posts.map((p) => p.slug)).toEqual(['beta-post', 'alpha-post']);
  });

  it('includes drafts when asked', () => {
    const posts = getAllPosts({ postsDir: POSTS_DIR, includeDrafts: true });
    expect(posts.map((p) => p.slug)).toEqual(['draft-post', 'beta-post', 'alpha-post']);
  });

  it('excludes drafts by default when NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const posts = getAllPosts({ postsDir: POSTS_DIR });
      expect(posts.map((p) => p.slug)).toEqual(['beta-post', 'alpha-post']);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('getPostBySlug', () => {
  it('finds a post by slug', () => {
    const post = getPostBySlug('alpha-post', { postsDir: POSTS_DIR, includeDrafts: false });
    expect(post?.title).toBe('Alpha Post');
  });

  it('returns undefined for unknown slug', () => {
    expect(getPostBySlug('nope', { postsDir: POSTS_DIR, includeDrafts: false })).toBeUndefined();
  });
});

describe('tags', () => {
  it('counts tags across published posts, count desc then alpha', () => {
    const tags = getAllTags({ postsDir: POSTS_DIR, includeDrafts: false });
    expect(tags).toEqual([
      { tag: 'security', count: 2 },
      { tag: 'detection', count: 1 },
    ]);
  });

  it('filters posts by tag', () => {
    const posts = getPostsByTag('detection', { postsDir: POSTS_DIR, includeDrafts: false });
    expect(posts.map((p) => p.slug)).toEqual(['beta-post']);
  });
});
