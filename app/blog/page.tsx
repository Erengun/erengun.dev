import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog — Eren Gün",
  description: "Writing on Flutter, mobile engineering and building reliable software.",
};

export default function BlogIndex() {
  const posts = getAllPosts();

  return (
    <main>
      <header className="blog-topbar">
        <Link className="blog-logo" href="/">EREN_OS <b>9.0</b></Link>
        <nav aria-label="Blog navigation">
          <Link href="/">← Home</Link>
          <a href="/rss.xml">RSS</a>
        </nav>
      </header>

      <section className="blog-hero">
        <span>READING_LIST / {String(posts.length).padStart(2, "0")} POSTS</span>
        <h1>Notes from<br /><em>the build.</em></h1>
        <p>Mostly Flutter — API clients, build times, reliability rules and whatever else broke and got fixed along the way.</p>
        <div className="blog-hero-actions">
          <a className="blog-rss-link" href="/rss.xml">SUBSCRIBE VIA RSS <b>↗</b></a>
        </div>
      </section>

      <section className="blog-list" aria-label="All posts">
        {posts.map((post) => (
          <Link className="blog-card" href={`/blog/${post.slug}`} key={post.slug}>
            <div className="blog-card-meta">
              <span>{post.displayDate}</span>
              <span>{post.readingTime}</span>
            </div>
            <div>
              <h2>{post.title}</h2>
              <p>{post.summary}</p>
              <div className="blog-card-tags">{post.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            </div>
            <span className="blog-card-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <footer className="os-footer">
        <span>© 2026 EREN GÜN</span>
        <span>MADE WITH CURIOSITY IN ISTANBUL</span>
        <Link href="/">HOME ↑</Link>
      </footer>
    </main>
  );
}
