import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  getAllPosts,
  getAllTags,
  getListedPosts,
  getPostBySlug,
  getPostsByTag,
  getTranslation,
  parsePostFile,
} from '../posts.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const POSTS_DIR = path.join(FIXTURES, 'posts');
const INVALID_DIR = path.join(FIXTURES, 'invalid');
const I18N_DIR = path.join(FIXTURES, 'i18n');
const COLLISION_DIR = path.join(FIXTURES, 'collision');

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

  it('rejects filenames that produce non-kebab-case slugs', () => {
    expect(() => parsePostFile(path.join(INVALID_DIR, 'bad_slug.mdx'))).toThrowError(
      /bad_slug\.mdx.*slug must be kebab-case/s,
    );
  });
});

describe('language fields', () => {
  it('defaults lang to en and translationKey to the slug', () => {
    const post = parsePostFile(path.join(POSTS_DIR, 'alpha-post.mdx'));
    expect(post.lang).toBe('en');
    expect(post.translationKey).toBe('alpha-post');
  });

  it('rejects an invalid lang value', () => {
    expect(() => parsePostFile(path.join(INVALID_DIR, 'bad-lang.mdx'))).toThrowError(
      /bad-lang\.mdx.*lang/s,
    );
  });

  it('rejects a non-kebab-case translationKey', () => {
    expect(() => parsePostFile(path.join(INVALID_DIR, 'bad-translation-key.mdx'))).toThrowError(
      /bad-translation-key\.mdx.*translationKey/s,
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

describe('translation pairing', () => {
  const opts = { postsDir: I18N_DIR, includeDrafts: true };

  it('getListedPosts dedupes a pair preferring English', () => {
    const listed = getListedPosts(opts);
    const pair = listed.filter((p) => p.translationKey === 'hello-world');
    expect(pair).toHaveLength(1);
    expect(pair[0].lang).toBe('en');
  });

  it('getListedPosts keeps an unpaired post regardless of language', () => {
    const listed = getListedPosts(opts);
    expect(listed.some((p) => p.slug === 'solo-espanol')).toBe(true);
  });

  it('getTranslation resolves both directions and is undefined when unpaired', () => {
    const es = getPostBySlug('hola-mundo', opts)!;
    const en = getPostBySlug('hello-world', opts)!;
    expect(getTranslation(es, opts)?.slug).toBe('hello-world');
    expect(getTranslation(en, opts)?.slug).toBe('hola-mundo');
    expect(getTranslation(getPostBySlug('solo-espanol', opts)!, opts)).toBeUndefined();
  });

  it('throws when two posts share translationKey and lang', () => {
    expect(() => getAllPosts({ postsDir: COLLISION_DIR, includeDrafts: true })).toThrowError(
      /same-key/,
    );
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
