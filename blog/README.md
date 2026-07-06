# ProjectAchilles Blog

Static Next.js blog deployed as an independent Vercel project at
https://blog.projectachilles.io. Not coupled to `frontend/` or `backend/`.

## Writing a post

1. Create `content/posts/YYYY-MM-DD-my-slug.mdx` (filename = URL slug).
2. Frontmatter (validated at build time — a bad field fails the build):

   ```yaml
   ---
   title: My Post Title
   description: One-sentence summary used in cards and meta tags.
   date: "2026-07-05"
   tags:
     - detection        # kebab-case only
   author: james        # must exist in content/authors.ts
   draft: true          # optional; drafts never ship to production
   ---
   ```

3. `npm run dev` to preview (drafts visible in dev), commit and push.
   Vercel rebuilds and deploys automatically on merge to main.

## Commands

- `npm run dev` — dev server on port 4321
- `npm test` — Vitest unit tests (content loader)
- `npm run build` — production build (also the content validation gate)
