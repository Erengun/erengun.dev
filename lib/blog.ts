import matter from "gray-matter";
import { marked } from "marked";

import rawMakingTextsSelectable from "@/content/blog/2023-07-making-texts-selectable-in-flutter-web.md?raw";
import rawMaterialSymbolsIcons from "@/content/blog/2024-03-material-symbols-icons-flutter.md?raw";
import rawFlutterRetrofitDio from "@/content/blog/2024-08-flutter-retrofit-dio.md?raw";
import rawFlutterBuildTime from "@/content/blog/2024-10-flutter-build-time-optimization.md?raw";
import rawFlutterReliabilityRules from "@/content/blog/2025-04-flutter-reliability-rules.md?raw";

const rawPosts = [
  rawMakingTextsSelectable,
  rawMaterialSymbolsIcons,
  rawFlutterRetrofitDio,
  rawFlutterBuildTime,
  rawFlutterReliabilityRules,
];

export type BlogPost = {
  slug: string;
  title: string;
  summary: string;
  date: string;
  displayDate: string;
  tags: string[];
  html: string;
  readingTime: string;
};

type Frontmatter = {
  slug: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
};

function readingTimeFor(markdown: string): string {
  const wordCount = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return `${minutes} min read`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

const posts: BlogPost[] = rawPosts
  .map((raw) => {
    const { data, content } = matter(raw);
    const frontmatter = data as Frontmatter;
    return {
      slug: frontmatter.slug,
      title: frontmatter.title,
      summary: frontmatter.summary,
      date: frontmatter.date,
      displayDate: formatDate(frontmatter.date),
      tags: frontmatter.tags,
      html: marked.parse(content, { async: false }) as string,
      readingTime: readingTimeFor(content),
    };
  })
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export function getAllPosts(): BlogPost[] {
  return posts;
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find((post) => post.slug === slug);
}

export function getAdjacentPosts(slug: string): { prev: BlogPost | null; next: BlogPost | null } {
  const index = posts.findIndex((post) => post.slug === slug);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index < posts.length - 1 ? posts[index + 1] : null,
    next: index > 0 ? posts[index - 1] : null,
  };
}
