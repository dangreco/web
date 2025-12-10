import lume from "lume/mod.ts";
import unocss from "lume/plugins/unocss.ts";
import metas from "lume/plugins/metas.ts";
import sitemap from "lume/plugins/sitemap.ts";
import robots from "lume/plugins/robots.ts";
import pageFind from "lume/plugins/pagefind.ts";
import date from "lume/plugins/date.ts";
import presetWind4 from "@unocss/preset-wind4";

const site = lume({
  src: "./src",
  location: new URL("https://dangre.co"),
});

site.use(unocss({
  options: {
    presets: [
      presetWind4(),
    ],
  },
}));
site.use(metas());
site.use(sitemap());
site.use(robots());
site.use(
  pageFind({
    ui: {
      resetStyles: false,
      containerId: "search",
      showImages: false,
    },
  }),
);
site.use(date());
site.add("/styles");
site.copy("assets");
site.ignore("README.md", "CHANGELOG.md");

export default site;
