import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import matter from "gray-matter";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const contentDir = path.join(rootDir, "content/blog");
const publicDir = path.join(rootDir, "public");
const baseUrl = "https://erengun.dev";

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const posts = readdirSync(contentDir)
  .filter((file) => file.endsWith(".md"))
  .map((file) => {
    const raw = readFileSync(path.join(contentDir, file), "utf8");
    const { data } = matter(raw);
    return data;
  })
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

function buildRss() {
  const items = posts
    .map((post) => {
      const link = `${baseUrl}/blog/${post.slug}/`;
      const categories = post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`).join("\n");
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <description>${escapeXml(post.summary)}</description>
${categories}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Eren Gün — Blog</title>
    <link>${baseUrl}/blog/</link>
    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Writing on Flutter, mobile engineering and building reliable software.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

function buildSitemap() {
  const staticUrls = [
    { loc: `${baseUrl}/`, changefreq: "monthly", priority: "1.0" },
    { loc: `${baseUrl}/blog/`, changefreq: "weekly", priority: "0.8" },
  ];
  const postUrls = posts.map((post) => ({
    loc: `${baseUrl}/blog/${post.slug}/`,
    lastmod: new Date(post.date).toISOString().slice(0, 10),
    changefreq: "yearly",
    priority: "0.6",
  }));

  const urls = [...staticUrls, ...postUrls]
    .map(
      (entry) => `  <url>
    <loc>${entry.loc}</loc>
${entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>\n` : ""}    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
}

writeFileSync(path.join(publicDir, "rss.xml"), buildRss());
writeFileSync(path.join(publicDir, "sitemap.xml"), buildSitemap());
writeFileSync(path.join(publicDir, "robots.txt"), buildRobots());

console.log(`Generated rss.xml, sitemap.xml and robots.txt for ${posts.length} posts.`);
