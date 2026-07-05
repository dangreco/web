import lume from "lume/mod.ts";
import tailwindcss from "lume/plugins/tailwindcss.ts";
import postcss from "lume/plugins/postcss.ts";
import sitemap from "lume/plugins/sitemap.ts";
import robots from "lume/plugins/robots.ts";
import extractDate from "lume/plugins/extract_date.ts";
import readingInfo from "lume/plugins/reading_info.ts";
import date from "lume/plugins/date.ts";
import shikiji from "https://deno.land/x/lume_shikiji/mod.ts";
import feed from "lume/plugins/feed.ts";
import { enCA } from "npm:date-fns@4.1.0/locale/en-CA";
import { frCA } from "npm:date-fns@4.1.0/locale/fr-CA";
import { format as dfFormat } from "lume/deps/date.ts";

import excerpt from "./src/_plugins/excerpt.ts";

const site = lume({
  src: "./src",
  dest: "./_build",
  location: new URL("https://dangre.co"),
});

site.use(tailwindcss());
site.use(postcss());
site.use(sitemap());
site.use(robots());
site.use(extractDate());
site.use(readingInfo());
site.use(
  shikiji({
    highlighter: {
      langs: [
        "javascript",
        "bash",
        "python",
        "rust",
        "ocaml",
        "haskell",
        "c",
        "c++",
        "yaml",
      ],
      themes: ["min-light", "min-dark"],
    },
    themes: {
      light: "min-light",
      dark: "min-dark",
    },
    defaultColor: "light",
    extraCSS: `
      .shiki {
        /* Use your dynamic OKLCH variables for the container */
        background-color: var(--color-panel) !important;
        border: 1px solid var(--color-rule);
        border-radius: 0.375rem; /* Optional: rounds the corners */
        padding: 1rem;           /* Optional: gives the code breathing room */

        transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
        transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        transition-duration: 150ms;
      }
    `,
  }),
);

site.use(
  date({
    locales: { enCA, frCA },
  }),
);

// Blog post dates are calendar dates taken from filenames, but JS parses a
// date-only string as UTC midnight. date-fns then formats that instant in the
// build host's local timezone, which (on a host behind UTC) shifts the date
// back a day. Re-register the filter to format the UTC calendar date instead,
// so a post dated 2026-07-04 renders as 2026-07-04 everywhere the site builds.
const DATE_FORMATS: Record<string, string> = {
  DATE: "yyyy-MM-dd",
  DATETIME: "yyyy-MM-dd HH:mm:ss",
  HUMAN_DATE: "PPP",
  HUMAN_DATETIME: "PPPppp",
  TIME: "HH:mm:ss",
};
const DATE_LOCALES = { enCA, frCA };
site.filter("date", (value: unknown, pattern = "DATE", lang = "enCA") => {
  if (!value) return "";
  const parsed = value === "now"
    ? new Date()
    : value instanceof Date
    ? value
    : new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return "";
  const fmt = DATE_FORMATS[pattern] ?? pattern;
  const locale = DATE_LOCALES[lang as keyof typeof DATE_LOCALES];
  const utc = new Date(parsed.getTime() + parsed.getTimezoneOffset() * 60000);
  return dfFormat(utc, fmt, locale ? { locale } : {});
});

site.use(excerpt({ length: 30 }));

site.use(
  feed({
    output: ["/blog.rss", "/blog.json"],
    query: "post",
    info: {
      title: "=site.title",
      description: "=site.description",
    },
    items: {
      title: "=title",
      description: "=excerpt",
    },
  }),
);

site.copy("assets");
site.add("/styles.css");

export default site;
