// On-demand formatters, and the reason this is its own module: prettier with its
// TypeScript parser and estree printer is well over a megabyte, so a Clojure
// snippet must not pay for it — nor a TypeScript one for cljfmt. Static imports
// would fuse both into whichever chunk this lands in, which is exactly what the
// dynamic imports below avoid.
//
// OCaml has no browser-capable formatter published anywhere, so it uses a
// hand-rolled indenter (see `pg-ocaml-format.ts`) loaded the same lazy way.

import type { PgLang } from "./pg-types.ts";
import { formatOcaml } from "./pg-ocaml-format.ts";

interface CljFmt {
  formatWithConfig(source: string, config: null): string;
}

export async function formatSource(
  lang: PgLang,
  source: string,
): Promise<string> {
  if (lang === "ocaml") return formatOcaml(source);
  if (lang === "clojure") {
    const mod = await import(
      "https://esm.sh/prettier-plugin-cljfmt@0.1.1/dist/cljfmt.js"
    );
    // A JS-only package: esm.sh ships no declarations, so the shape above is
    // asserted from its documented API rather than checked.
    const cljfmt = mod.default as CljFmt;
    // cljfmt returns without a trailing newline and prettier always adds one;
    // normalise so a format never depends on which language ran it.
    const out = cljfmt.formatWithConfig(source, null);
    return out.endsWith("\n") ? out : `${out}\n`;
  }

  // Three modules, not two: prettier's standalone build resolves the printer for
  // the parser's AST format separately, and omitting `plugins/estree` throws
  // `ConfigError: Couldn't find plugin for AST format "estree"`.
  const [standalone, tsPlugin, estree] = await Promise.all([
    import("https://esm.sh/prettier@3.9.6/standalone"),
    import("https://esm.sh/prettier@3.9.6/plugins/typescript"),
    import("https://esm.sh/prettier@3.9.6/plugins/estree"),
  ]);
  return await standalone.format(source, {
    parser: "typescript",
    plugins: [tsPlugin, estree],
  });
}
