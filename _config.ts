import lume from "lume/mod.ts";
import tailwindcss from "lume/plugins/tailwindcss.ts";
import postcss from "lume/plugins/postcss.ts";
import sitemap from "lume/plugins/sitemap.ts";
import robots from "lume/plugins/robots.ts";
import extractDate from "lume/plugins/extract_date.ts";
import readingInfo from "lume/plugins/reading_info.ts";
import date from "lume/plugins/date.ts";
import shikiji from "https://deno.land/x/lume_shikiji/mod.ts";
import { enCA } from "npm:date-fns@4.1.0/locale/en-CA";
import { frCA } from "npm:date-fns@4.1.0/locale/fr-CA";

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
      langs: ["javascript", "bash", "python"],
      themes: ["min-light", "min-dark"],
    },
    themes: {
      light: "min-light",
      dark: "min-dark",
    },
    defaultColor: "light",
    extraCSS: `
      .shiki {
        transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
        transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        transition-duration: 150ms;
      }
      [data-color="dark"] .shiki {
        background-color: #27272a !important;
        border-width: 2px;
        border-style: solid;
        border-color: #27272a;
      }
      [data-color="light"] .shiki {
        background-color: #f5f5f5 !important;
        border-width: 2px;
        border-style: solid;
        border-color: rgb(229 229 229 / var(--tw-border-opacity, 1));
      }
    `,
  }),
);

site.use(
  date({
    locales: { enCA, frCA },
  }),
);

site.add("/styles.css");

export default site;
