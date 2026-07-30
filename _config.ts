import lume from "lume/mod.ts";
import tailwindcss from "lume/plugins/tailwindcss.ts";
import postcss from "lume/plugins/postcss.ts";
import esbuild from "lume/plugins/esbuild.ts";
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
import katex from "lume/plugins/katex.ts";

import excerpt from "./src/_plugins/excerpt.ts";
import playground from "./src/_plugins/playground.ts";
import { emberDark, emberLight } from "./src/_themes/ember.ts";

const site = lume({
  src: "./src",
  dest: "./_build",
  location: new URL("https://dangre.co"),
  // The one stylesheet <head> links is /styles.css (src/_components/meta/head.vto).
  // Lume's default is /style.css, so every plugin that emits CSS was writing to a
  // file the site never loads. Name it here rather than per-plugin, so the KaTeX
  // stylesheet — and any future CSS-emitting plugin — lands where it is served.
  cssFile: "/styles.css",
});

// Bundle client-side TS (playground runtime). Splitting is opt-in in esbuild;
// enabling it lets `import("./heavy.ts")` lazy-load as a sibling chunk. esm.sh
// imports stay external: the browser fetches the correct browser-targeted
// modules at runtime, and Lume's Deno loader avoids both the global-cache write
// and Deno-targeted (node:) builds it would otherwise pull.
site.use(
  esbuild({
    options: {
      splitting: true,
      keepNames: false, // avoid an extra shared helper chunk for this tiny runtime
      chunkNames: "scripts/heavy-[hash]",
      external: ["https://esm.sh/*"],
    },
  }),
);

// Must run before shikiji: katex claims the ```math fenced block via
// .language-math, and shikiji would otherwise tokenize it into .shiki spans
// first, leaving nothing for the selector to match.
//
// The stock delimiters only offer `\(…\)` for inline math, which markdown never
// delivers: `\(` is a backslash-escaped ASCII punctuation char, so CommonMark
// emits a bare `(` and the delimiter is gone before the DOM walk sees it. Add
// `$…$` instead — markdown passes it through untouched. `merge` replaces arrays
// rather than merging them, so the whole list is restated here, and `$$` must
// stay ahead of `$` because auto-render tries delimiters in order.
site.use(
  katex({
    options: {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\begin{equation}", right: "\\end{equation}", display: true },
        { left: "\\begin{align}", right: "\\end{align}", display: true },
        { left: "\\begin{alignat}", right: "\\end{alignat}", display: true },
        { left: "\\begin{gather}", right: "\\end{gather}", display: true },
        { left: "\\begin{CD}", right: "\\end{CD}", display: true },
      ],
    },
  }),
);

site.use(tailwindcss());
site.use(postcss());
// Snippet .ts files are browser-run (bundled in-page by esbuild-wasm), not
// part of the Deno build. Keep Lume's esbuild from treating them as pages.
site.ignore((path: string) => /(^|\/)snippets(\/|$)/.test(path));
site.use(sitemap());
site.use(robots());
site.use(extractDate());
site.use(readingInfo());
site.use(
  shikiji({
    highlighter: {
      langs: [
        "javascript",
        "typescript",
        "bash",
        "python",
        "rust",
        "ocaml",
        "haskell",
        "c",
        "c++",
        "yaml",
      ],
      themes: [emberLight, emberDark],
    },
    themes: {
      light: "ember-light",
      dark: "ember-dark",
    },
    defaultColor: "light",
    extraCSS: `
      .shiki {
        /* Background and token colours come from the ember-light/ember-dark
           themes (src/_themes/ember.ts), switched by the [data-color] rules
           this plugin generates — their editor.background is exactly --panel.
           Overriding it here with the --color-* alias would both out-specify
           that switch and freeze the container to prefers-color-scheme, since
           the @theme aliases resolve once at :root. Style only the chrome. */
        border: 1px solid var(--color-rule);
        border-radius: 0.375rem;
        padding: 1rem;

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
site.use(playground());

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
site.add("/scripts/playground.ts");

export default site;
