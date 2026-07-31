// Contracts shared between the build plugin, the editor runtime and the
// per-language runners. Type-only on purpose: every consumer imports it with
// `import type`, so the module erases at build time and esbuild emits no chunk
// for it.

/** Snippet languages the runtime knows how to evaluate. */
export type PgLang = "ts" | "ocaml" | "clojure";

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

/** The output pane's console proxy, as handed to a runner. */
export type Sink = Record<ConsoleLevel, (...args: unknown[]) => void>;

/**
 * One squiggle in the editor. 1-based line, 0-based column — OCaml's native
 * shape, which the Clojure adapter converts to.
 */
export interface RunDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
}

export interface RunOutcome {
  ok: boolean;
  /** Long-form text for the `.pg-error` pane when `ok` is false. */
  message?: string;
  diagnostics: RunDiagnostic[];
}

/**
 * A non-TypeScript evaluator. `load()` is idempotent and pulls the language's
 * runtime off a CDN; `run()` evaluates one source string and reports what the
 * editor should show.
 */
export interface ForeignRunner {
  load(): Promise<void>;
  run(source: string, sink: Sink): Promise<RunOutcome>;
}
