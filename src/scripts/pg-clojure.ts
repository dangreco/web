// ClojureScript evaluator. scittle is the Small Clojure Interpreter compiled to
// JS; it wants `document`, so unlike the OCaml kernel it cannot be put in a
// worker and evaluates on the main thread — the same hazard profile the
// TypeScript snippets already have, and why there is no timeout here.
//
// scittle publishes no ESM build, so a `<script>` tag is the only way in. That
// is also the only option compatible with `external: ["https://esm.sh/*"]` in
// _config.ts: a build-time `import` of a non-esm.sh URL would be fetched and
// inlined into the bundle by Lume's esbuild.

import type { ForeignRunner, RunOutcome, Sink } from "./pg-types.ts";

const SCITTLE_URL =
  "https://cdn.jsdelivr.net/npm/scittle@0.8.32/dist/scittle.js";

interface Scittle {
  core: {
    eval_string(source: string): unknown;
    disable_auto_eval?: () => void;
  };
}

/**
 * sci reports where a failure happened only inside its ex-data map, which is a
 * ClojureScript value rather than a JS object — `err.data.line` is `undefined`,
 * so the printed EDN form is what has to be read. Both numbers are 1-based.
 */
const SCI_LINE = /:line (\d+)/;
const SCI_COLUMN = /:column (\d+)/;

/**
 * `println` writes through `console.log`, so capturing output means patching the
 * page's console for the duration of an evaluation. `error` is deliberately left
 * alone: sci prints a ten-line diagnostic report through it that belongs in
 * devtools, not in a reader's output pane.
 */
const PATCHED = ["log", "info", "warn", "debug"] as const;

// One interpreter per page, not per section: scittle installs itself on a global
// and there is nothing to gain from a second copy.
let scittlePromise: Promise<Scittle> | undefined;

// scittle attaches itself to the page global and publishes no module, so this
// unchecked view of `globalThis` is the only handle there is.
const pageScope = globalThis as unknown as { scittle?: Scittle };

function ensureScittle(): Promise<Scittle> {
  if (scittlePromise) return scittlePromise;
  scittlePromise = new Promise<Scittle>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCITTLE_URL;
    el.addEventListener("load", () => {
      const scittle = pageScope.scittle;
      if (!scittle) {
        scittlePromise = undefined;
        reject(new Error("scittle loaded but installed no global"));
        return;
      }
      // Its DOMContentLoaded hook fired long before this script arrived, so
      // nothing was going to auto-evaluate. Say so rather than rely on timing.
      scittle.core.disable_auto_eval?.();
      resolve(scittle);
    }, { once: true });
    el.addEventListener("error", () => {
      scittlePromise = undefined;
      reject(new Error(`failed to load ${SCITTLE_URL}`));
    }, { once: true });
    document.head.appendChild(el);
  });
  return scittlePromise;
}

function failure(err: unknown): RunOutcome {
  // sci throws a real Error carrying the report as `.message` and the source
  // location as ex-data on `.data`. Read both by narrowing: a plain JS throw from
  // interop has neither, and must not be assumed into shape.
  const thrown = err && typeof err === "object" ? err : undefined;
  const message = thrown && "message" in thrown
    ? String(thrown.message)
    : String(err);
  const printed = thrown && "data" in thrown ? String(thrown.data) : "";
  const line = SCI_LINE.exec(printed);
  const column = SCI_COLUMN.exec(printed);
  // No location in the ex-data (a plain JS throw from interop, say): the message
  // still reaches the error pane, there is just nothing to underline.
  if (!line || !column) return { ok: false, message, diagnostics: [] };
  return {
    ok: false,
    message,
    diagnostics: [{
      line: Number(line[1]),
      endLine: Number(line[1]),
      column: Number(column[1]) - 1, // sci counts from 1, RunDiagnostic from 0
      endColumn: Number(column[1]),
      message,
    }],
  };
}

export function createRunner(): ForeignRunner {
  return {
    async load(): Promise<void> {
      await ensureScittle();
    },

    async run(source: string, sink: Sink): Promise<RunOutcome> {
      const scittle = await ensureScittle();
      const saved = PATCHED.map((level) => console[level]);
      for (const level of PATCHED) console[level] = sink[level];
      try {
        // Evaluates every form and hands back the last one's value. sci exposes
        // one global context, so `def`s outlive a run and are visible to other
        // snippets on the page; each Run re-evaluates its own source top to
        // bottom, which re-establishes its own definitions, so that is benign.
        const value = scittle.core.eval_string(source);
        if (value !== null && value !== undefined) sink.log(String(value));
        return { ok: true, diagnostics: [] };
      } catch (err) {
        return failure(err);
      } finally {
        PATCHED.forEach((level, i) => {
          console[level] = saved[i];
        });
      }
    },
  };
}
