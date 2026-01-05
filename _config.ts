import lume from "lume/mod.ts";
import tailwindcss from "lume/plugins/tailwindcss.ts";
import postcss from "lume/plugins/postcss.ts";

const site = lume({
  src: "./src",
  dest: "./_build",
});

site.use(tailwindcss());
site.use(postcss());

site.add("/styles.css");

export default site;
