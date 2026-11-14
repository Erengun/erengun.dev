import type { APIRoute } from 'astro';
import { getPosts, isoDate } from '../lib/blog';
import { PROJECTS } from '../lib/content';

// Generated so new posts land in the sitemap automatically.
export const GET: APIRoute = async () => {
  const base = 'https://erengun.dev';
  const posts = await getPosts();
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: '/', lastmod: today, freq: 'monthly', pri: '1.0' },
    { loc: '/work/', lastmod: today, freq: 'monthly', pri: '0.9' },
    ...PROJECTS.map((p) => ({ loc: `/work/${p.id}/`, lastmod: today, freq: 'monthly', pri: '0.8' })),
    { loc: '/blog/', lastmod: posts[0] ? isoDate(posts[0].data.date) : today, freq: 'monthly', pri: '0.8' },
    ...posts.map((p) => ({ loc: `/blog/${p.id}/`, lastmod: isoDate(p.data.date), freq: 'yearly', pri: '0.7' })),
    { loc: '/privacy/', freq: 'yearly', pri: '0.2' },
  ];
  const body = urls
    .map((u) => `  <url><loc>${base}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`)
    .join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
