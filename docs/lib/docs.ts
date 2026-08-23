import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";

import { flatNav, type NavItem } from "./nav";

const docsDir = path.join(process.cwd(), "content", "docs");

export type DocHeading = {
  level: 2 | 3;
  text: string;
  id: string;
};

export type Doc = {
  slug: string;
  title: string;
  description: string;
  /** Markdown body (frontmatter stripped). */
  content: string;
  /** h2/h3 outline for the "On this page" rail. */
  headings: DocHeading[];
};

function readRaw(slug: string): string | null {
  const file = path.join(docsDir, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

/**
 * Extract the h2/h3 outline. Ids are computed with github-slugger in document
 * order — exactly what rehype-slug does — so anchors line up.
 */
function extractHeadings(markdown: string): DocHeading[] {
  // Remove fenced code blocks first so `# comments` inside them are ignored.
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  const slugger = new GithubSlugger();
  const headings: DocHeading[] = [];

  for (const line of withoutCode.split("\n")) {
    const match = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line.trim());
    if (!match) continue;
    const text = match[2].replace(/`/g, "");
    headings.push({
      level: match[1].length === 2 ? 2 : 3,
      text,
      id: slugger.slug(text),
    });
  }
  return headings;
}

export function getDoc(slug: string): Doc | null {
  const raw = readRaw(slug);
  if (!raw) return null;

  const { data, content } = matter(raw);
  const title = typeof data.title === "string" ? data.title : slug;
  const description =
    typeof data.description === "string" ? data.description : "";

  return {
    slug,
    title,
    description,
    content: content.trimStart(),
    headings: extractHeadings(content),
  };
}

/** Every doc on disk — used to prerender all /docs/[slug] routes. */
export function getAllSlugs(): string[] {
  if (!fs.existsSync(docsDir)) return [];
  return fs
    .readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}

/** Previous/next docs in nav order. */
export function getNeighbors(slug: string): {
  prev: NavItem | undefined;
  next: NavItem | undefined;
} {
  const flat = flatNav();
  const index = flat.findIndex((item) => item.slug === slug);
  if (index === -1) return { prev: undefined, next: undefined };
  return { prev: flat[index - 1], next: flat[index + 1] };
}
