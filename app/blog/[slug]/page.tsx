import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdjacentPosts, getAllPosts, getPostBySlug } from "@/lib/blog";

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Eren Gün`,
    description: post.summary,
    openGraph: { title: post.title, description: post.summary, type: "article" },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const { prev, next } = getAdjacentPosts(slug);

  return (
    <main>
      <header className="blog-topbar">
        <Link className="blog-logo" href="/">EREN_OS <b>9.0</b></Link>
        <nav aria-label="Blog navigation">
          <Link href="/">← Home</Link>
          <a href="/rss.xml">RSS</a>
        </nav>
      </header>

      <article className="post-page">
        <Link className="post-back" href="/blog">← All posts</Link>
        <div className="post-header">
          <div className="post-meta"><span>{post.displayDate}</span><span>{post.readingTime}</span></div>
          <h1>{post.title}</h1>
          <p className="post-summary">{post.summary}</p>
          <div className="post-tags">{post.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </div>

        <div className="post-article" dangerouslySetInnerHTML={{ __html: post.html }} />

        {(prev || next) && (
          <div className="post-nav">
            {prev && (
              <Link href={`/blog/${prev.slug}`}>
                <span>← PREV</span>
                <b>{prev.title}</b>
              </Link>
            )}
            {next && (
              <Link className="post-nav-next" href={`/blog/${next.slug}`}>
                <span>NEXT →</span>
                <b>{next.title}</b>
              </Link>
            )}
          </div>
        )}
      </article>

      <footer className="os-footer">
        <span>© 2026 EREN GÜN</span>
        <span>MADE WITH CURIOSITY IN ISTANBUL</span>
        <Link href="/">HOME ↑</Link>
      </footer>
    </main>
  );
}
