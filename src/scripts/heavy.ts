// Heavy runtime: CodeMirror editor + in-page esbuild-wasm bundler. Loaded
// lazily by the light entry (`playground.ts`) only when a playground is about
// to be used, so this ~MB of code never blocks initial page paint.
// Every CodeMirror/Lezer package must resolve to a single instance: CM6 facets
// and Lezer tags are compared by object identity, so a duplicated
// @codemirror/state or @lezer/highlight silently breaks highlighting. The
// `?deps=` pins make esm.sh dedupe every transitive copy onto these versions.
// esm.sh keys each module URL on the exact `?deps=` string it is given, so these
// lists must stay verbatim — even a harmless-looking superset yields a different
// hashed URL, and with it a second copy of the package.
import {
  basicSetup,
  EditorView,
} from "https://esm.sh/codemirror@6.0.2?deps=@codemirror/autocomplete@6.20.3,@codemirror/language@6.12.4,@codemirror/lint@6.9.7,@codemirror/state@6.7.1,@codemirror/view@6.43.7,@lezer/highlight@1.2.3";
import {
  Compartment,
  EditorState,
  type Extension,
  type Text,
} from "https://esm.sh/@codemirror/state@6.7.1";
import { keymap } from "https://esm.sh/@codemirror/view@6.43.7?deps=@codemirror/state@6.7.1";
// `indentWithTab` is the one piece basicSetup omits: without it Tab leaves the
// editor and moves focus, which is the last thing a reader editing a snippet
// expects. Pinned to the shared instance the editor already resolves.
import { indentWithTab } from "https://esm.sh/@codemirror/commands@6.10.4?deps=@codemirror/language@6.12.4,@codemirror/state@6.7.1,@codemirror/view@6.43.7,@lezer/highlight@1.2.3";
// `setDiagnostics` installs the lint state field on demand, so the interpreted
// languages get squiggles without a `linter()` source polling for them.
import {
  type Diagnostic,
  setDiagnostics,
} from "https://esm.sh/@codemirror/lint@6.9.7?deps=@codemirror/state@6.7.1,@codemirror/view@6.43.7";
import {
  StreamLanguage,
  syntaxHighlighting,
} from "https://esm.sh/@codemirror/language@6.12.4?deps=@codemirror/state@6.7.1,@codemirror/view@6.43.7,@lezer/highlight@1.2.3";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.5?deps=@codemirror/autocomplete@6.20.3,@codemirror/language@6.12.4,@codemirror/state@6.7.1,@codemirror/view@6.43.7,@lezer/highlight@1.2.3";
// Clojure has a real Lezer grammar. OCaml has only a legacy stream parser, so it
// gets highlighting but no indent service — acceptable for read-and-tweak
// snippets, and the only browser option that exists.
import { clojure } from "https://esm.sh/@nextjournal/lang-clojure@1.0.0?deps=@codemirror/language@6.12.4,@codemirror/state@6.7.1,@codemirror/view@6.43.7,@lezer/highlight@1.2.3";
// `mode/mllike.mjs` has zero runtime imports — it is a self-contained token
// table — so its `?deps=` only redirects the .d.ts esm.sh serves. Without it the
// declaration resolves `StreamParser` from a second copy of
// @codemirror/language, whose `StringStream` then fails to unify with ours.
import { oCaml } from "https://esm.sh/@codemirror/legacy-modes@6.5.3/mode/mllike?deps=@codemirror/language@6.12.4,@codemirror/state@6.7.1,@codemirror/view@6.43.7,@lezer/highlight@1.2.3";
// `basicSetup` bundles a highlight style but no parser, so there was no syntax
// tree to colour. `classHighlighter` emits stable `tok-*` class names instead
// of hashed ones, which lets styles.css own the token colours (and track the
// palette) rather than baking them into the JS theme.
import { classHighlighter } from "https://esm.sh/@lezer/highlight@1.2.3";
// Same union the build plugin writes into `data-pg-lang`.
import type {
  ConsoleLevel,
  ForeignRunner,
  PgLang,
  PlotFn,
  RunDiagnostic,
  Sink,
} from "./pg-types.ts";
// The same module the TS snippets import as `@pg/charts`; the runtime reuses its
// renderer for the interpreted languages so every language draws identically.
import { renderChart } from "../_playground/lib/charts.ts";
// Type-only, so the module itself stays behind the dynamic import below.
import type { TsIntel } from "./pg-tsintel.ts";
import * as esbuild from "https://esm.sh/esbuild-wasm@0.25.5";
// esm.sh's browser build of esbuild-wasm exposes the API only on the default
// export — the `import * as` namespace object carries just `{ default }` at
// runtime, even though the bundled .d.ts declares the named exports. Keep
// `esbuild` for type positions and route the two runtime calls through `api`.
const api: typeof esbuild =
  (esbuild as unknown as { default?: typeof esbuild }).default ?? esbuild;

interface PlaygroundPayload {
  files: Record<string, string>;
  entry: string;
  lang?: PgLang;
}

// Pinned bare-specifier → esm.sh URL map. Unknown bare specifiers fall back to
// `https://esm.sh/<spec>` and are emitted as external runtime imports.
//
// React and everything layered on it MUST collapse to a single instance, or
// hooks throw and React Flow's context resolves empty — hence the shared
// `?deps=` pins, the same dedupe trick used for the CodeMirror packages above.
const REACT = "react@19.2.8";
const REACT_DOM = "react-dom@19.2.8";
const REACT_DEPS = `deps=${REACT},${REACT_DOM}`;
const PKG: Record<string, string> = {
  xstate: "https://esm.sh/xstate@5.19.0",
  "@xstate/react": `https://esm.sh/@xstate/react@5.0.5?${REACT_DEPS}`,
  effect: "https://esm.sh/effect@3.17.1",
  react: `https://esm.sh/${REACT}`,
  "react/jsx-runtime": `https://esm.sh/${REACT}/jsx-runtime`,
  "react-dom": `https://esm.sh/${REACT_DOM}?deps=${REACT}`,
  "react-dom/client": `https://esm.sh/${REACT_DOM}/client?deps=${REACT}`,
  "@xyflow/react": `https://esm.sh/@xyflow/react@12.11.2?${REACT_DEPS}`,
};

let sharedLib: Map<string, string> | null = null;

/**
 * Shared `@pg/…` modules, emitted once per page by the build plugin. Parsed
 * once per page load and merged into each snippet's virtual filesystem.
 */
function readSharedLib(): Map<string, string> {
  if (sharedLib) return sharedLib;
  const lib = new Map<string, string>();
  const el = document.querySelector("[data-pg-lib]");
  if (el?.textContent) {
    try {
      const parsed = JSON.parse(el.textContent) as Record<string, string>;
      for (const name of Object.keys(parsed)) lib.set(name, parsed[name]);
    } catch (err) {
      console.error("[playground] malformed shared lib payload", err);
    }
  }
  sharedLib = lib;
  return lib;
}

const ESBUILD_WASM = "https://esm.sh/esbuild-wasm@0.25.5/esbuild.wasm";
let initPromise: Promise<void> | null = null;
function ensureEsbuild(): Promise<void> {
  if (!initPromise) {
    initPromise = api
      .initialize({ wasmURL: ESBUILD_WASM })
      .then(() => undefined);
  }
  return initPromise;
}

function extOf(path: string): esbuild.Loader {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

/**
 * Bundle a virtual multi-file TS project into a single ESM string. When
 * `consoleKey` is given, a banner rebinds `console` inside the bundle to that
 * global, capturing the snippet's output without patching the page's console.
 */
async function bundle(
  files: Map<string, string>,
  entry: string,
  consoleKey?: string,
): Promise<string> {
  const resolveKey = (p: string): string => {
    const clean = p.replace(/(?:^|\/)\.{1,2}\//g, "");
    for (const t of [clean, clean + ".ts", clean + ".tsx", clean + ".js"]) {
      if (files.has(t)) return t;
    }
    return clean;
  };

  const result = await api.build({
    bundle: true,
    format: "esm",
    target: "esnext",
    jsx: "automatic",
    entryPoints: [entry],
    logLevel: "silent",
    write: false,
    banner: consoleKey
      ? { js: `const console=globalThis[${JSON.stringify(consoleKey)}];` }
      : undefined,
    plugins: [{
      name: "pg-vfs",
      setup(b: esbuild.PluginBuild) {
        b.onResolve({ filter: /.*/ }, (a: esbuild.OnResolveArgs) => {
          const p = a.path;
          if (a.kind === "entry-point" || p.startsWith(".")) {
            return { path: resolveKey(p), namespace: "pg" };
          }
          if (p.startsWith("http")) return { path: p, external: true };
          // Shared library modules (`@pg/…`) live in the VFS, not on esm.sh.
          const local = resolveKey(p);
          if (files.has(local)) return { path: local, namespace: "pg" };
          return { path: PKG[p] ?? `https://esm.sh/${p}`, external: true };
        });
        b.onLoad(
          { filter: /.*/, namespace: "pg" },
          (a: esbuild.OnLoadArgs) => ({
            contents: files.get(a.path) ?? "",
            loader: extOf(a.path),
          }),
        );
      },
    }],
  });

  if (result.errors.length) {
    throw new Error(result.errors[0].text || "bundle failed");
  }
  const out = result.outputFiles[0];
  if (!out) throw new Error("bundle produced no output");
  return out.text;
}

// --- Theme (palette-driven, reactive) -------------------------------------

// `prefers-color-scheme` via globalThis keeps Deno's `no-window` lint happy;
// this module only ever runs in the page. `matchMedia` is a real browser global
// that Deno's type graph doesn't expose on globalThis, so bind it to a named
// const (well-known host API the compiler lost track of).
const globalWin = globalThis as unknown as {
  matchMedia?: (query: string) => MediaQueryList;
};
const darkMq = globalWin.matchMedia?.("(prefers-color-scheme: dark)");

function isDark(): boolean {
  const c = document.body.dataset.color;
  if (c === "dark" || c === "light") return c === "dark";
  return darkMq?.matches ?? false;
}

function readPalette() {
  const s = getComputedStyle(document.body);
  const g = (n: string) => s.getPropertyValue(n).trim();
  return {
    panel: g("--color-panel") || (isDark() ? "#1a1a1a" : "#f5f5f5"),
    ink: g("--color-ink") || (isDark() ? "#eee" : "#111"),
    inkMute: g("--color-ink-mute") || "#888",
    rule: g("--color-rule") || "rgba(127,127,127,.15)",
    accent: g("--color-accent") || "#c00",
  };
}

function makeTheme(dark: boolean) {
  const p = readPalette();
  return EditorView.theme({
    // The height cap lives here rather than on the `.pg-editor` wrapper: capping
    // the wrapper needs `overflow: auto` on it, which clips hover and lint
    // tooltips. `.cm-editor` stays `overflow: visible` and the scroller scrolls.
    "&": { backgroundColor: p.panel, color: p.ink, maxHeight: "420px" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.8125rem",
      overflow: "auto",
    },
    ".cm-content": { color: p.ink },
    ".cm-gutters": {
      backgroundColor: p.panel,
      color: p.inkMute,
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: p.rule },
    ".cm-activeLineGutter": { backgroundColor: p.rule },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: p.accent,
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.accent },
    "&.cm-focused": { outline: "none" },
  }, { dark });
}

interface EditorHandle {
  view: EditorView;
  compartment: Compartment;
}
const editors: EditorHandle[] = [];
let themeWired = false;
function wireTheme(): void {
  if (themeWired) return;
  themeWired = true;
  const apply = () => {
    const dark = isDark();
    for (const e of editors) {
      e.view.dispatch({ effects: e.compartment.reconfigure(makeTheme(dark)) });
    }
  };
  new MutationObserver(apply).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-color"],
  });
  darkMq?.addEventListener("change", apply);
}

// --- Mount ----------------------------------------------------------------

/**
 * Lifecycle of a single playground, surfaced by the state chip in its bar.
 * `bundling` is TypeScript-only; `done` exists for the interpreted languages,
 * whose snippets finish instead of staying mounted — leaving the chip pinging on
 * "Running" forever would lie about what the page is doing.
 */
type PgState = "idle" | "loading" | "bundling" | "running" | "done" | "error";

const STATE_LABELS: Record<PgState, string> = {
  idle: "Idle",
  loading: "Loading",
  bundling: "Bundling",
  running: "Running",
  done: "Done",
  error: "Error",
};

const CONSOLE_LEVELS: readonly ConsoleLevel[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
];

// Bound at module load. `pg-clojure.ts` swaps `console.log` and friends for the
// duration of an evaluation, so a sink forwarding through the live `console`
// object would end up feeding itself.
const RAW_CONSOLE: Sink = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let sinkSeq = 0;
const globalScope = globalThis as unknown as Record<string, unknown>;

/** Render one console argument for the output pane. */
function fmtArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Console proxy for one playground: appends a line per call and still forwards
 * to the real console so devtools keeps working.
 */
function makeSink(pane: HTMLElement): Sink {
  const sink = {} as Sink;
  for (const level of CONSOLE_LEVELS) {
    sink[level] = (...args: unknown[]): void => {
      const line = document.createElement("div");
      line.className = `pg-line pg-line-${level}`;
      line.textContent = args.map(fmtArg).join(" ");
      pane.appendChild(line);
      pane.scrollTop = pane.scrollHeight;
      RAW_CONSOLE[level](...args);
    };
  }
  return sink;
}

/**
 * A runner's 1-based line and 0-based column as a document offset. Clamped at
 * both ends: a compiler reporting a location past the end of the buffer — which
 * happens whenever the submitted source is not byte-for-byte the buffer — must
 * not be able to throw inside a dispatch.
 */
function offsetAt(doc: Text, line: number, column: number): number {
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  return Math.min(l.from + Math.max(column, 0), l.to);
}

/** Runner diagnostics as editor ranges, each at least one character wide. */
function toCmDiagnostics(
  doc: Text,
  ds: readonly RunDiagnostic[],
): Diagnostic[] {
  return ds.map((d) => {
    const from = offsetAt(doc, d.line, d.column);
    const to = Math.max(from + 1, offsetAt(doc, d.endLine, d.endColumn));
    return {
      from,
      to: Math.min(to, doc.length),
      severity: "error" as const,
      message: d.message,
    };
  });
}

export function initPlayground(
  section: HTMLElement,
  opts: { autoRun: boolean },
): void {
  const filesEl = section.querySelector<HTMLScriptElement>("[data-pg-files]");
  if (!filesEl?.textContent) return;

  let payload: PlaygroundPayload;
  try {
    payload = JSON.parse(filesEl.textContent);
  } catch (err) {
    console.error("[playground] malformed files payload", err);
    return;
  }

  const files = new Map<string, string>(Object.entries(payload.files));
  if (files.size === 0) return;
  const entry = payload.entry;
  const lang: PgLang = payload.lang ?? "ts";

  const tabsEl = section.querySelector<HTMLElement>("[data-pg-tabs]");
  const editorHost = section.querySelector<HTMLElement>("[data-pg-editor]");
  const runBtn = section.querySelector<HTMLButtonElement>("[data-pg-run]");
  const errorOut = section.querySelector<HTMLElement>("[data-pg-error]");
  const target = section.querySelector<HTMLElement>("[data-pg-target]");
  const plots = section.querySelector<HTMLElement>("[data-pg-plots]");
  if (!editorHost || !runBtn || !errorOut || !target || !plots) return;

  // Rebind to non-null locals so the closure below keeps its type narrowing
  // (TS won't carry querySelector narrowing into a hoisted function body).
  const host: HTMLElement = editorHost;
  const button: HTMLButtonElement = runBtn;
  const errorEl: HTMLElement = errorOut;
  const targetEl: HTMLElement = target;
  const plotsEl: HTMLElement = plots;

  const stateLabel = section.querySelector<HTMLElement>(
    "[data-pg-state-label]",
  );
  // A single attribute drives the chip's colour and animation; `detail` carries
  // the long-form message (build errors) that would not fit in the bar.
  const setState = (next: PgState, detail = ""): void => {
    section.setAttribute("data-pg-state", next);
    if (stateLabel) stateLabel.textContent = STATE_LABELS[next];
    errorEl.textContent = detail;
  };

  // Console mode: for TypeScript the bundler rewrites the snippet's `console` to
  // this per-playground sink, so output lands in the pane without patching the
  // page's console and logs never leak between playgrounds. The interpreted
  // runners are handed the same sink directly, so build it for any section with
  // a console pane rather than only on the esbuild path.
  const consoleOut = section.querySelector<HTMLElement>("[data-pg-console]");
  const sink = consoleOut ? makeSink(consoleOut) : undefined;
  const consoleKey = lang === "ts" &&
      section.getAttribute("data-pg-output") === "console" && sink
    ? `__pgConsole${++sinkSeq}`
    : undefined;
  if (consoleKey && sink) globalScope[consoleKey] = sink;

  host.querySelector("[data-pg-fallback]")?.remove();

  let current = files.has(entry) ? entry : files.keys().next().value!;

  // Tabs
  const tabs = new Map<string, HTMLButtonElement>();
  if (tabsEl) {
    tabsEl.textContent = "";
    for (const name of files.keys()) {
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.textContent = name;
      tabBtn.addEventListener("click", () => select(name));
      tabsEl.appendChild(tabBtn);
      tabs.set(name, tabBtn);
    }
  }
  function syncTabs(): void {
    tabs.forEach((tabBtn, name) =>
      tabBtn.setAttribute("aria-selected", String(name === current))
    );
  }

  // Editor
  const themeCompartment = new Compartment();
  // Built once: extensions are immutable descriptors, so the same language mode
  // survives the `view.setState` rebuild that a tab switch performs.
  const langMode = lang === "ocaml"
    ? StreamLanguage.define(oCaml)
    : lang === "clojure"
    ? clojure()
    : javascript({ typescript: true });
  // Shift+Alt+F is the editor-standard binding, and the bar button runs the same
  // path. OCaml has no formatter, so it contributes nothing.
  const formatKeys: Extension = lang === "ocaml" ? [] : keymap.of([{
    key: "Shift-Alt-f",
    run: () => {
      void formatDoc();
      return true;
    },
  }]);
  // Type intelligence arrives long after mount, so it lives in a compartment:
  // that is also what carries it through the `view.setState` rebuild in
  // `select()`, which would otherwise drop it on the first tab switch.
  const intelCompartment = new Compartment();
  let intelExt: Extension = [];
  let intel: TsIntel | undefined;
  const buildExtensions = () =>
    [
      basicSetup,
      keymap.of([indentWithTab]),
      langMode,
      syntaxHighlighting(classHighlighter),
      formatKeys,
      intelCompartment.of(intelExt),
      themeCompartment.of(makeTheme(isDark())),
    ] as const;
  const view = new EditorView({
    state: EditorState.create({
      doc: files.get(current) ?? "",
      extensions: buildExtensions(),
    }),
    parent: host,
  });
  editors.push({ view, compartment: themeCompartment });
  wireTheme();
  syncTabs();
  setState("idle");
  // The bar renders Format disabled because formatting needs an editor. It has
  // one now.
  const formatBtn = section.querySelector<HTMLButtonElement>(
    "[data-pg-format]",
  );
  if (formatBtn) {
    formatBtn.disabled = false;
    formatBtn.addEventListener("click", () => void formatDoc());
  }

  // TypeScript plus 79 lib files is ~8 MB and about a second of work, so it
  // loads on the first click into the editor — the gesture that means "I am
  // going to edit this" — rather than because a reader scrolled past. Hover
  // works without further clicks once it is in.
  if (lang === "ts") {
    host.addEventListener("focusin", () => {
      void (async () => {
        try {
          files.set(current, view.state.doc.toString());
          // Lazy for the same reason as everything else in this file: no reader
          // who does not touch an editor should download a compiler.
          const { createTsIntel } = await import("./pg-tsintel.ts");
          intel = await createTsIntel(files, readSharedLib(), current);
          intelExt = intel.extensions;
          view.dispatch({
            effects: intelCompartment.reconfigure(intelExt),
          });
        } catch (err) {
          // A working editor without tooltips beats a broken one.
          console.error("[playground] type intelligence failed", err);
        }
      })();
    }, { once: true });
  }

  function select(name: string): void {
    if (name === current) return;
    files.set(current, view.state.doc.toString());
    // The outgoing buffer is only in the editor; the virtual filesystem needs it
    // before diagnostics for the incoming file can resolve imports of it.
    intel?.setFile(current, files.get(current) ?? "");
    current = name;
    intel?.setActive(name);
    syncTabs();
    view.setState(
      EditorState.create({
        doc: files.get(current) ?? "",
        extensions: buildExtensions(),
      }),
    );
  }

  /**
   * Reformat the active buffer in place. A failure is reported through the one
   * error surface the section has and leaves the document untouched — a
   * formatter that cannot parse the source has nothing useful to write.
   */
  async function formatDoc(): Promise<void> {
    if (lang === "ocaml") return;
    const before = view.state.doc.toString();
    try {
      // Lazy for the same reason as the runners: prettier is over a megabyte and
      // most readers never press the button.
      const { formatSource } = await import("./pg-format.ts");
      const after = await formatSource(lang, before);
      if (after === before) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: after },
        // Whole-document replacement discards the selection, so carry the cursor
        // over by offset. Clamped: formatting usually shortens the text.
        selection: {
          anchor: Math.min(view.state.selection.main.anchor, after.length),
        },
      });
      files.set(current, after);
    } catch (err) {
      setState("error", String((err as Error)?.message ?? err));
    }
  }

  // Run
  let cleanup: (() => void) | undefined;
  // Disposers for charts the interpreted languages draw through the plot
  // callback (TS charts are the snippet's own responsibility, returned from
  // `main`). Tracked so a pane clear between Runs also drops their observers.
  const chartCleanups: (() => void)[] = [];
  const targetSnapshot = targetEl.innerHTML;

  async function runTs(): Promise<void> {
    setState("bundling");
    await ensureEsbuild();
    // Shared library first so a snippet file of the same name wins.
    const vfs = new Map([...readSharedLib(), ...files]);
    const code = await bundle(vfs, entry, consoleKey);

    try {
      cleanup?.();
    } catch (err) {
      console.warn("[playground] cleanup threw", err);
    }
    targetEl.innerHTML = targetSnapshot; // fresh DOM drops prior listeners
    cleanup = undefined;

    const url = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    // The blob URL is genuinely runtime-selected (built from user-edited
    // source on every Run), so a dynamic import is unavoidable here.
    let mod: { default?: unknown };
    try {
      mod = await import(
        /* @vite-ignore */ url as string
      ) as { default?: unknown };
    } finally {
      URL.revokeObjectURL(url);
    }

    const fn = mod.default;
    if (typeof fn !== "function") {
      throw new Error("snippet must default-export main(target)");
    }
    const ret = (fn as (t: HTMLElement) => unknown)(targetEl);
    if (typeof ret === "function") cleanup = ret as () => void;
    // A TypeScript snippet keeps running: it owns DOM, listeners and timers
    // until the next Run, so "running" is its resting state.
    setState("running");
  }

  // One runner per section, kept across Runs — the OCaml worker holds a warm
  // toplevel, and scittle is a page-wide singleton either way.
  let runner: ForeignRunner | undefined;

  async function runForeign(): Promise<void> {
    if (!sink) throw new Error("console output pane missing");
    setState("loading");
    if (!runner) {
      // Dynamic on purpose, and the reason this feature is affordable: a static
      // import would pull both language runtimes into the editor chunk that
      // every playground loads. Only the language on the page is fetched, and
      // only when its Run is clicked.
      const mod = lang === "ocaml"
        ? await import("./pg-ocaml.ts")
        : await import("./pg-clojure.ts");
      runner = mod.createRunner();
    }
    await runner.load();
    setState("running");
    // Charts drawn during evaluation land in the section's plot pane. Errors in
    // a single chart must not abort the run, so they are reported to devtools
    // and skipped.
    const plot: PlotFn = (kind, data, opts) => {
      try {
        chartCleanups.push(renderChart(plotsEl, kind, data, opts));
      } catch (err) {
        console.error("[playground] plot failed", err);
      }
    };
    const outcome = await runner.run(files.get(entry) ?? "", sink, plot);
    if (outcome.ok) {
      // Unlike a TS snippet, an evaluated one is over. Say so.
      setState("done");
      return;
    }
    setState("error", outcome.message ?? "evaluation failed");
    if (outcome.diagnostics.length) {
      view.dispatch(
        setDiagnostics(
          view.state,
          toCmDiagnostics(view.state.doc, outcome.diagnostics),
        ),
      );
    }
  }

  async function run(): Promise<void> {
    button.disabled = true;
    if (consoleOut) consoleOut.textContent = "";
    for (const c of chartCleanups) c();
    chartCleanups.length = 0;
    plotsEl.textContent = "";
    // TS charts (`@pg/charts`) draw into whichever section is running, found
    // through this global; the interpreted languages reach the same pane via the
    // plot callback handed to their runner.
    globalScope.__pgPlotPane = plotsEl;
    // TypeScript sections are left alone: their diagnostics come from the type
    // checker, and clearing the lint field here would erase them until the next
    // keystroke re-triggered it.
    if (lang !== "ts") view.dispatch(setDiagnostics(view.state, []));
    files.set(current, view.state.doc.toString());
    try {
      if (lang === "ts") await runTs();
      else await runForeign();
    } catch (err) {
      console.error("[playground] run failed", err);
      setState("error", String((err as Error)?.message ?? err));
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener("click", run);
  if (opts.autoRun) void run();
}
