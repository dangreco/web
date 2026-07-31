// TypeScript intelligence: hover types and inline diagnostics straight from the
// compiler, running in the page against a virtual filesystem holding the
// snippet's tabs plus the shared `@pg/…` library.
//
// Hand-rolled rather than @valtown/codemirror-ts. That package is two thin
// wrappers over the three language-service calls below, is no longer actively
// developed, and its ESM build imports bare "typescript" — which esm.sh resolves
// to the TypeScript 7 native port unless every consumer carries a matching
// `?deps=typescript@5.9.3`. A second 8 MB compiler instance is a steep price for
// sixty lines, and it gives no control over the tooltip DOM.

// `import * as`: the .d.ts is `export = ts`, and esm.sh's build re-exports the
// whole namespace as named exports, so this form is correct for both the types
// and the runtime.
import * as ts from "https://esm.sh/typescript@5.9.3";
// vfs takes the compiler as an explicit argument and imports none of its own at
// runtime, so this pin only redirects the .d.ts onto the same TypeScript above —
// without it, every `ts` we hand in fails to unify with the one it declares.
import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from "https://esm.sh/@typescript/vfs@1.6.4?deps=typescript@5.9.3";
import type { Extension } from "https://esm.sh/@codemirror/state@6.7.1";
import {
  type Diagnostic,
  linter,
} from "https://esm.sh/@codemirror/lint@6.9.7?deps=@codemirror/state@6.7.1,@codemirror/view@6.43.7";
import {
  EditorView,
  hoverTooltip,
} from "https://esm.sh/@codemirror/view@6.43.7?deps=@codemirror/state@6.7.1";

const TS_VERSION = "5.9.3";

// `allowImportingTsExtensions` together with `noEmit` is what makes the site's
// own `./machine.ts` import style legal; without the pair, every such import is
// reported as a 5097.
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "react",
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  types: [],
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
};

/**
 * Codes the virtual project cannot avoid reporting: it carries no `@types` for
 * react, xstate and the rest, and fetching them would multiply a setup whose
 * point is checking the reader's edits, not the libraries.
 */
const DROP_ALWAYS = new Set([2688, 2875, 7016, 7026]);

function isNoise(code: number, text: string): boolean {
  if (DROP_ALWAYS.has(code)) return true;
  if (code !== 2307) return false;
  // A missing *bare* module is one of the un-typed dependencies above. A missing
  // *relative* one is a real typo in a sibling tab's name, and must stay visible.
  const spec = /Cannot find module '([^']+)'/.exec(text)?.[1] ?? "";
  return !spec.startsWith(".");
}

// 79 lib.d.ts files, fetched once per page and copied per section.
let libsPromise: Promise<Map<string, string>> | undefined;

export interface TsIntel {
  /** Install through a Compartment so it survives a tab switch's state rebuild. */
  extensions: Extension;
  /** Point diagnostics and hover at another tab. `name` is the bare file name. */
  setActive(name: string): void;
  /** Push a non-active tab's buffer into the virtual filesystem. */
  setFile(name: string, code: string): void;
}

export async function createTsIntel(
  files: ReadonlyMap<string, string>,
  lib: ReadonlyMap<string, string>,
  active: string,
): Promise<TsIntel> {
  if (!libsPromise) {
    libsPromise = createDefaultMapFromCDN(
      COMPILER_OPTIONS,
      TS_VERSION,
      false,
      ts,
    ).catch((err: unknown) => {
      // Don't let one failed page-load poison every other section's attempt.
      libsPromise = undefined;
      throw err;
    });
  }
  const fs = new Map(await libsPromise);

  for (const [name, code] of files) fs.set(`/${name}`, code);
  // The shared library is already keyed by the specifier snippets import it
  // under (`@pg/flow.tsx`), so dropping it under node_modules is precisely what
  // lets the resolver answer a bare `@pg/flow`.
  for (const [name, code] of lib) fs.set(`/node_modules/${name}`, code);

  const env = createVirtualTypeScriptEnvironment(
    createSystem(fs),
    [...files.keys()].map((name) => `/${name}`),
    ts,
    COMPILER_OPTIONS,
  );

  // Which tab the two read-only sources below report on. Mutable because the
  // editor is one view showing one file at a time.
  let activePath = `/${active}`;

  const extensions: Extension = [
    EditorView.updateListener.of((u) => {
      if (u.docChanged) env.updateFile(activePath, u.state.doc.toString());
    }),

    linter(() => {
      const service = env.languageService;
      const out: Diagnostic[] = [];
      for (
        const d of [
          ...service.getSyntacticDiagnostics(activePath),
          ...service.getSemanticDiagnostics(activePath),
        ]
      ) {
        if (d.start === undefined || d.length === undefined) continue;
        const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
        if (isNoise(d.code, message)) continue;
        out.push({
          from: d.start,
          to: d.start + d.length,
          severity: d.category === ts.DiagnosticCategory.Warning
            ? "warning"
            : "error",
          message,
        });
      }
      return out;
    }),

    hoverTooltip((_view, pos) => {
      const qi = env.languageService.getQuickInfoAtPosition(activePath, pos);
      if (!qi) return null;

      const dom = document.createElement("div");
      dom.className = "pg-tip";
      const sig = document.createElement("div");
      sig.className = "pg-tip-sig";
      // textContent, never innerHTML: this is compiler output about source the
      // reader just typed, and it reaches the DOM unescaped otherwise.
      sig.textContent = ts.displayPartsToString(qi.displayParts);
      dom.appendChild(sig);

      if (qi.documentation?.length) {
        const doc = document.createElement("div");
        doc.className = "pg-tip-doc";
        doc.textContent = ts.displayPartsToString(qi.documentation);
        dom.appendChild(doc);
      }

      return {
        pos: qi.textSpan.start,
        end: qi.textSpan.start + qi.textSpan.length,
        create: () => ({ dom }),
      };
    }),
  ];

  return {
    extensions,
    setActive(name: string): void {
      activePath = `/${name}`;
    },
    setFile(name: string, code: string): void {
      env.updateFile(`/${name}`, code);
    },
  };
}
