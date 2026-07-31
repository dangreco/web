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

/** Chart kinds the runtime can draw. */
export type ChartKind = "bar" | "line" | "scatter";

/** Hands a drawn chart to the runtime, which renders it into the plot pane. */
export type PlotFn = (kind: ChartKind, data: unknown) => void;

/**
 * A non-TypeScript evaluator. `load()` is idempotent and pulls the language's
 * runtime off a CDN; `run()` evaluates one source string and reports what the
 * editor should show. `plot`, when set, is called whenever the source asks for a
 * chart — OCaml reaches it through the worker bridge, Clojure through a host
 * global.
 */
export interface ForeignRunner {
  load(): Promise<void>;
  run(source: string, sink: Sink, plot?: PlotFn): Promise<RunOutcome>;
}
