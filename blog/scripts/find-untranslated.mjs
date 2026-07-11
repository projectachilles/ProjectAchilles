import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

/**
 * Spanish posts whose translationKey has no `lang: en` counterpart.
 * Frontmatter is read leniently (missing lang counts as 'en', matching the
 * Zod default in src/lib/posts.ts) — full validation is the test suite's job.
 */
export function findUntranslated(postsDir) {
  const files = fs.readdirSync(postsDir).filter((file) => file.endsWith('.mdx'));
  const posts = files.map((file) => {
    const { data } = matter(fs.readFileSync(path.join(postsDir, file), 'utf8'));
    const slug = file.replace(/\.mdx$/, '');
    return {
      file: path.join(postsDir, file),
      slug,
      lang: data.lang ?? 'en',
      translationKey: data.translationKey ?? slug,
      title: data.title ?? slug,
    };
  });
  const englishKeys = new Set(posts.filter((p) => p.lang === 'en').map((p) => p.translationKey));
  return posts
    .filter((p) => p.lang === 'es' && !englishKeys.has(p.translationKey))
    .map(({ file, slug, translationKey, title }) => ({ file, slug, translationKey, title }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(process.cwd(), 'content', 'posts');
  process.stdout.write(`${JSON.stringify(findUntranslated(dir))}\n`);
}
