import type Site from "lume/core/site.ts";
import createSlugifier from "lume/core/slugifier.ts";

export interface TocHeading {
  id: string;
  text: string;
}

export interface TocResult {
  html: string;
  headings: TocHeading[];
}

// Only h2: every existing post is a flat run of h2 sections (no h3+), and a
// flat "on this page" list matches that structure. A post that later adds h3
// simply won't surface it here rather than forcing a nested list this site
// has no content to justify yet.
const HEADING = /<h2((?:\s[^>]*)?)>([\s\S]*?)<\/h2>/g;
const TAGS = /<[^>]+>/g;

/** Slugify already-rendered heading text for a stable, readable anchor id. */
function idFor(text: string, slugify: (s: string) => string): string {
  const id = slugify(text);
  return id || "section";
}

export default function toc() {
  return (site: Site) => {
    site.filter("toc", (html: unknown): TocResult => {
      if (typeof html !== "string" || !html) {
        return { html: typeof html === "string" ? html : "", headings: [] };
      }

      const slugify = createSlugifier();
      const seen = new Set<string>();
      const headings: TocHeading[] = [];

      const out = html.replace(HEADING, (match, attrs, inner) => {
        const text = inner.replace(TAGS, "").trim();
        if (!text) return match;

        let id = idFor(text, slugify);
        while (seen.has(id)) id += "-1";
        seen.add(id);

        headings.push({ id, text });

        const withId = /\sid=/.test(attrs) ? attrs : `${attrs} id="${id}"`;
        return `<h2${withId}>${inner}</h2>`;
      });

      return { html: out, headings };
    });
  };
}
