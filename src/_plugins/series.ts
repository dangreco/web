import type Site from "lume/core/site.ts";

export interface SeriesPart {
  title: string;
  url: string;
  part: number;
}

export default function series() {
  return (site: Site) => {
    site.preprocess([".md"], (pages) => {
      const groups = new Map<string, typeof pages>();

      for (const page of pages) {
        const id = page.data.series;
        if (typeof id !== "string" || !id) continue;
        const group = groups.get(id);
        if (group) group.push(page);
        else groups.set(id, [page]);
      }

      for (const [id, group] of groups) {
        for (const page of group) {
          const n = page.data.part;
          if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
            throw new Error(
              `series "${id}": ${page.data.sourcePath} needs a 1-based integer \`part\` in its front matter`,
            );
          }
        }

        const parts: SeriesPart[] = group
          .map((page) => ({
            title: page.data.title as string,
            url: page.data.url as string,
            part: page.data.part as number,
          }))
          .sort((a, b) => a.part - b.part);

        parts.forEach((p, i) => {
          if (p.part !== i + 1) {
            throw new Error(
              `series "${id}": \`part\` values must be unique and contiguous from 1; got ${
                parts.map((x) => x.part).join(", ")
              }`,
            );
          }
        });

        for (const page of group) {
          page.data.seriesParts = parts;
          page.data.seriesTotal = parts.length;
        }
      }
    });
  };
}
