import lume from "lume/mod.ts";
import tailwindcss from "lume/plugins/tailwindcss.ts";
import postcss from "lume/plugins/postcss.ts";
import sitemap from "lume/plugins/sitemap.ts";
import robots from "lume/plugins/robots.ts";

const site = lume({
  src: "./src",
  dest: "./_build",
  location: new URL("https://dangre.co"),
});

site.use(tailwindcss());
site.use(postcss());
site.use(sitemap());
site.use(robots());

site.add("/styles.css");

export default site;
