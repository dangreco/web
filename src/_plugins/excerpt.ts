import type Site from "lume/core/site.ts";
import { merge } from "lume/core/utils/object.ts";

import parse from "https://esm.sh/remark-parse@11";
import { unified } from "https://esm.sh/unified@11";
import { visit } from "https://esm.sh/unist-util-visit@5";

interface Options {
  extensions?: string[];
  lang?: string;
  length?: number;
  ellipsis?: boolean;
}

export const defaults: Options = {
  extensions: [".md"],
  lang: "en",
  length: 50,
  ellipsis: true,
};

function apply(
  options: { [K in keyof Options]-?: NonNullable<Options[K]> },
  page,
) {
  if (!page || !page.data) return;
  if (page.data.excerpt) return;

  const tree = unified()
    .use(parse)
    .parse(page.data.content || "");

  const parts = [];

  visit(tree, (node) => {
    if (node.type === "text") {
      parts.push(node.value);
    }

    // Optional: keep link text but not URLs
    if (node.type === "link") {
      visit(node, (node_) => {
        if (node_.type === "text") parts.push(node_.value);
      });
    }
  });

  const lang = page.data.lang || options.lang;
  const segmenter = new Intl.Segmenter(lang, { granularity: "word" });
  const segments = Array.from(segmenter.segment(parts.join(" ")));

  let count = 0;
  const words = [];

  for (const { segment, isWordLike } of segments) {
    if (count >= options.length) break;

    if (isWordLike) {
      count++;
    }

    words.push(segment);
  }

  let excerpt = words.join("").trim();
  if (options.ellipsis && segments.length > words.length) {
    excerpt += "…";
  }

  page.data.excerpt = excerpt;
}

export default function excerpt(userOptions: Options = {}) {
  const options = merge(defaults, userOptions);

  return (site: Site) => {
    site.preprocess(
      options.extensions,
      (pages) => pages.forEach(apply.bind(null, options)),
    );
  };
}
