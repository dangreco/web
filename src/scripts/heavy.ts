// Heavy runtime: CodeMirror editor + in-page esbuild-wasm bundler. Loaded
// lazily by the light entry (`playground.ts`) only when a playground is about
// to be used, so this ~MB of code never blocks initial page paint.
// Every CodeMirror/Lezer package must resolve to a single instance: CM6 facets
// and Lezer tags are compared by object identity, so a duplicated
// @codemirror/state or @lezer/highlight silently breaks highlighting. The
// `?deps=` pins make esm.sh dedupe every transitive copy onto these versions.
import {
  basicSetup,
  EditorView,
} from "https://esm.sh/codemirror@6.0.2?deps=@codemirror/state@6.7.1,@codemirror/language@6.12.4,@lezer/highlight@1.2.3";
import {
  Compartment,
  EditorState,
} from "https://esm.sh/@codemirror/state@6.7.1";
import { syntaxHighlighting } from "https://esm.sh/@codemirror/language@6.12.4?deps=@codemirror/state@6.7.1,@lezer/highlight@1.2.3";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.5?deps=@codemirror/state@6.7.1,@codemirror/language@6.12.4,@lezer/highlight@1.2.3";
// `basicSetup` bundles a highlight style but no parser, so there was no syntax
// tree to colour. `classHighlighter` emits stable `tok-*` class names instead
// of hashed ones, which lets styles.css own the token colours (and track the
// palette) rather than baking them into the JS theme.
import { classHighlighter } from "https://esm.sh/@lezer/highlight@1.2.3";
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
    "&": { backgroundColor: p.panel, color: p.ink, height: "100%" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "0.8125rem" },
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

/** Lifecycle of a single playground, surfaced by the state chip in its bar. */
type PgState = "idle" | "loading" | "bundling" | "running" | "error";

const STATE_LABELS: Record<PgState, string> = {
  idle: "Idle",
  loading: "Loading",
  bundling: "Bundling",
  running: "Running",
  error: "Error",
};

type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";
type SinkFn = (...args: unknown[]) => void;

const CONSOLE_LEVELS: readonly ConsoleLevel[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
];

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
function makeSink(pane: HTMLElement): Record<ConsoleLevel, SinkFn> {
  const sink = {} as Record<ConsoleLevel, SinkFn>;
  for (const level of CONSOLE_LEVELS) {
    sink[level] = (...args: unknown[]): void => {
      const line = document.createElement("div");
      line.className = `pg-line pg-line-${level}`;
      line.textContent = args.map(fmtArg).join(" ");
      pane.appendChild(line);
      pane.scrollTop = pane.scrollHeight;
      console[level](...args);
    };
  }
  return sink;
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

  const tabsEl = section.querySelector<HTMLElement>("[data-pg-tabs]");
  const editorHost = section.querySelector<HTMLElement>("[data-pg-editor]");
  const runBtn = section.querySelector<HTMLButtonElement>("[data-pg-run]");
  const errorOut = section.querySelector<HTMLElement>("[data-pg-error]");
  const target = section.querySelector<HTMLElement>("[data-pg-target]");
  if (!editorHost || !runBtn || !errorOut || !target) return;

  // Rebind to non-null locals so the closure below keeps its type narrowing
  // (TS won't carry querySelector narrowing into a hoisted function body).
  const host: HTMLElement = editorHost;
  const button: HTMLButtonElement = runBtn;
  const errorEl: HTMLElement = errorOut;
  const targetEl: HTMLElement = target;

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

  // Console mode: the bundler rewrites the snippet's `console` to this
  // per-playground sink, so output lands in the pane without patching the page's
  // console, and logs never leak between playgrounds.
  const consoleOut = section.querySelector<HTMLElement>("[data-pg-console]");
  const consoleKey =
    section.getAttribute("data-pg-output") === "console" && consoleOut
      ? `__pgConsole${++sinkSeq}`
      : undefined;
  if (consoleKey && consoleOut) globalScope[consoleKey] = makeSink(consoleOut);

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
  const buildExtensions = () =>
    [
      basicSetup,
      javascript({ typescript: true }),
      syntaxHighlighting(classHighlighter),
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

  function select(name: string): void {
    if (name === current) return;
    files.set(current, view.state.doc.toString());
    current = name;
    syncTabs();
    view.setState(
      EditorState.create({
        doc: files.get(current) ?? "",
        extensions: buildExtensions(),
      }),
    );
  }

  // Run
  let cleanup: (() => void) | undefined;
  const targetSnapshot = targetEl.innerHTML;

  async function run(): Promise<void> {
    setState("bundling");
    if (consoleOut) consoleOut.textContent = "";
    button.disabled = true;
    try {
      files.set(current, view.state.doc.toString());
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
      setState("running");
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
