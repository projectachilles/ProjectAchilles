---
title: "Publishing Blog Posts"
description: "How to write and publish a post on the ProjectAchilles blog — from the GitHub web UI or a local checkout."
---

# Publishing Blog Posts

The ProjectAchilles blog lives at [blog.projectachilles.io](https://blog.projectachilles.io). Posts are Markdown files in the main repository under `blog/content/posts/` — publishing a post is just merging a pull request. No CMS, no separate login.

Every post is validated when the site builds: if a required field is missing or malformed, the build fails and names the file and field, so a broken post can never reach production.

## Quick start (no local setup needed)

You can write and publish a post entirely from the GitHub web UI:

1. Open the repository on GitHub and navigate to `blog/content/posts/`.
2. Click **Add file → Create new file**.
3. Name the file following the pattern:

   ```
   YYYY-MM-DD-my-post-title.mdx
   ```

   The filename (minus `.mdx`) becomes the post's URL, e.g. `blog.projectachilles.io/posts/2026-07-10-my-post-title`. Only lowercase letters, digits, and hyphens are allowed — anything else fails the build.

4. Paste the template below and write your post.
5. Choose **Create a new branch and start a pull request**, then open the PR.
6. Wait for the **Blog** check on the PR — it builds the site with your post and catches any mistakes. Fix anything it flags (the error names your file and the exact field).
7. When the PR is approved and merged, the post goes live.

## Post template

Copy this into your new file and replace the values:

````mdx
---
title: My Post Title
description: One sentence shown in post cards, search results, and social shares.
date: "2026-07-10"
tags:
  - detection
author: james
---

Your opening paragraph.

## A section heading

Regular Markdown works: **bold**, _italics_, [links](https://example.com),
lists, tables, and blockquotes.

```go
// Code blocks get syntax highlighting — set the language after the backticks.
fmt.Println("hello")
```
````

## Frontmatter reference

The block between the `---` markers is the post's metadata. All validation happens at build time.

| Field | Required | Rules |
|-------|----------|-------|
| `title` | yes | Any text |
| `description` | yes | One sentence; used in cards, meta tags, and the RSS feed |
| `date` | yes | `"YYYY-MM-DD"` **in quotes**; controls sort order — newest post is featured on the home page |
| `tags` | yes (≥1) | Lowercase kebab-case only (`purple-team`, not `Purple Team`); each tag gets its own archive page at `/tags/<tag>` |
| `author` | yes | An author id from `blog/content/authors.ts` (see below) |
| `image` | no | Path to a hero image (place the file in `blog/public/`) |
| `draft` | no | `true` hides the post from production, the RSS feed, and the sitemap — it stays visible in local dev preview |

:::tip Drafts
Not ready to publish? Add `draft: true` to the frontmatter and merge anyway. The post won't appear anywhere publicly. Remove the line in a follow-up PR when it's ready.
:::

## Writing tips

- **Code blocks**: always set the language (` ```go `, ` ```typescript `, ` ```bash `) — you get themed syntax highlighting in both dark and light mode.
- **Tables and task lists** work (GitHub-flavored Markdown).
- **Images**: commit the file to `blog/public/` (e.g. `blog/public/my-diagram.png`) and reference it as `![Alt text](/my-diagram.png)`.
- **Reading time** is computed automatically — nothing to fill in.
- Keep the `description` under ~160 characters; it doubles as the SEO meta description.

## Adding a new author

Authors live in `blog/content/authors.ts`. Add an entry (or ask a maintainer to):

```typescript
export const authors: Record<string, Author> = {
  james: {
    id: 'james',
    name: 'James Pichardo',
    role: 'Founder, F0RT1KA',
  },
  newauthor: {
    id: 'newauthor',
    name: 'Full Name',
    role: 'Role, Company',
  },
};
```

Using an `author:` id that isn't registered fails the build with a clear error.

## Local preview (optional)

If you have the repository checked out:

```bash
cd blog
npm install        # first time only
npm run dev        # http://localhost:4321 — drafts are visible here
npm test           # content-loader unit tests
npm run build      # the same validation gate the PR check runs
```

## How publishing works

The blog deploys as its own Vercel project, completely independent of the platform frontend/backend — a blog post PR can never affect the product.

:::note Deployment
Once the Vercel git integration is connected for the `blog` project (Root Directory = `blog`), every merge to `main` that touches `blog/` deploys automatically. Until then, a maintainer publishes merged posts with `cd blog && vercel deploy --prod`.
:::

## Troubleshooting build failures

The **Blog** PR check (and `npm run build`) fails with a message naming your file and the problem:

| Error | Fix |
|-------|-----|
| `Invalid post filename … slug must be kebab-case` | Rename the file: lowercase letters, digits, and hyphens only |
| `Invalid frontmatter in … title: …` (or any field) | The named field is missing or malformed — compare against the template |
| `tags must be kebab-case` | Lowercase the tag, replace spaces with hyphens |
| `unknown author id` | Register the author in `blog/content/authors.ts` or use an existing id |
| `date must be YYYY-MM-DD` | Quote the date: `date: "2026-07-10"` |
