# erengun.dev

Eren Gün's personal site — "EREN_OS", a bold neo-brutalist desktop-themed
portfolio, plus a blog with an RSS feed.

Built with [Next.js](https://nextjs.org/) on [vinext](https://github.com/cloudflare/vinext)
(the Next.js API surface reimplemented on Vite), statically exported and
deployed to GitHub Pages.

## Stack

- Next.js App Router (`output: "export"` static export)
- Markdown content collection for blog posts (`content/blog/*.md`, parsed with
  `gray-matter` + `marked`)
- Static `robots.txt`, `sitemap.xml` and `rss.xml` generated at build time by
  `scripts/generate-feeds.mjs`
- No client-side framework beyond React — plain CSS, no Tailwind

## Commands

```bash
npm install
npm run dev      # local dev server
npm run build    # static export to dist/client
npm run check    # typecheck + lint
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yaml`, which builds the
static export and publishes `dist/client` to GitHub Pages. The custom domain
is configured via `public/CNAME`.

## Adding a blog post

Add a new Markdown file to `content/blog/` with frontmatter:

```md
---
slug: "my-post-slug"
title: "Post Title"
summary: "One or two sentence summary."
date: "2026-01-01"
tags: ["Flutter", "Whatever"]
---

Post content in Markdown.
```

Then add the corresponding `?raw` import in `lib/blog.ts`. The post picks up
routing, the blog index, RSS feed and sitemap automatically.

## License

MIT
