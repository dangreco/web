import type Site from "lume/core/site.ts";
import { posix } from "lume/deps/path.ts";
// The runtime reads `data-pg-lang` back off the section, so the set of
// languages has one definition and both sides move together.
import type { PgLang } from "../scripts/pg-types.ts";

const LOADER_SRC = "/scripts/playground.js";
const LIB_DIR = "_playground/lib";

/**
 * Build-time HTML rewriter: expands `<div data-pg-embed snippet=…>` sentinels
 * into a themed, editable playground `<section>` whose snippet source is carried
 * in an inline JSON `<script>`. The client runtime (`/scripts/playground.js`)
 * is appended once per page that contains at least one embed.
 *
 * Snippets are co-located with the post under
 * `<post-name>/snippets/<snippet>/…` and read from disk at build time.
 */
export default function playground() {
  return (site: Site) => {
    site.process([".html"], (pages) => {
      const lib = readLib(site);
      for (const page of pages) {
        const doc = page.document;
        if (!doc) continue;

        const sentinels = Array.from(
          doc.querySelectorAll<HTMLElement>("[data-pg-embed]"),
        );
        if (sentinels.length === 0) continue;

        let expandedAny = false;
        for (const el of sentinels) {
          if (expand(site, doc, el, page)) expandedAny = true;
        }

        if (expandedAny) injectLib(doc, lib);

        // Append the runtime loader once per page (module scripts dedupe by URL
        // anyway, but this keeps the markup clean).
        if (
          expandedAny &&
          !doc.head?.querySelector(`script[src="${LOADER_SRC}"]`)
        ) {
          const loader = doc.createElement("script");
          loader.setAttribute("type", "module");
          loader.setAttribute("src", LOADER_SRC);
          doc.head.appendChild(loader);
        }
      }
    });
  };
}

// Language is inferred from the entry file's extension rather than from a new
// attribute: `entry` already exists and already defaults to `index.ts`, so an
// OCaml embed is simply `entry="main.ml"`.
const LANG_BY_EXT: Record<string, PgLang> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".js": "ts",
  ".jsx": "ts",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
};

function expand(
  site: Site,
  doc: Document,
  el: HTMLElement,
  page: { src: { path: string } },
): boolean {
  const snippet = el.getAttribute("snippet");
  if (!snippet) {
    console.error(
      "[playground] missing `snippet` attribute on [data-pg-embed]",
    );
    return false;
  }

  const entry = el.getAttribute("entry") ?? "index.ts";
  const id = el.getAttribute("id");

  const lang: PgLang | undefined =
    LANG_BY_EXT[posix.extname(entry).toLowerCase()];
  if (!lang) {
    console.error(`[playground] unsupported entry extension: ${entry}`);
    return false;
  }

  // The co-located resource dir is the post's own directory:
  //   /blog/posts/2026-07-28_safe_state_machines
  // which mirrors the site's per-post assets convention. `src.path` is the
  // source path minus extension, so a post authored as `<post>/index.md` ends in
  // `/index` -- drop that basename to land on the post directory instead of a
  // phantom `index/` inside it. A flat `<post>.md` keeps its path as-is.
  const postDir = posix.basename(page.src.path) === "index"
    ? posix.dirname(page.src.path)
    : page.src.path;
  const absDir = posix.join(site.src(), postDir, "snippets", snippet);

  const files: Record<string, string> = {};
  try {
    for (const ent of Deno.readDirSync(absDir)) {
      if (!ent.isFile || ent.name.startsWith(".")) continue;
      files[ent.name] = Deno.readTextFileSync(posix.join(absDir, ent.name));
    }
  } catch {
    console.error(`[playground] snippet dir not found: ${absDir}`);
    return false; // leave the sentinel's children in place (no-JS graceful)
  }

  const names = Object.keys(files);
  if (names.length === 0) {
    console.error(`[playground] no snippet files in ${absDir}`);
    return false;
  }

  // OCaml and Clojure snippets are evaluated as a single source string; neither
  // runtime has a module story here, so quietly ignoring the extra files would
  // be a trap. Fail the embed the same way a missing directory does.
  if (lang !== "ts" && names.length > 1) {
    console.error(
      `[playground] ${lang} snippets must be single-file, found ${names.length} in ${absDir}`,
    );
    return false;
  }

  const entryText = files[entry] ?? "";

  const section = doc.createElement("section");
  section.setAttribute("class", "pg");
  section.setAttribute("data-pg", "");
  if (id) section.setAttribute("data-pg-id", id);
  section.setAttribute("data-pg-entry", entry);
  section.setAttribute("data-pg-lang", lang);
  section.setAttribute("data-pg-state", "idle");
  // `code="hidden"` yields a diagram-only embed: the machine is the point, not
  // its source. CSS hides the editor and tabs; the editor is still constructed,
  // so Run and the state chip keep working.
  if (el.getAttribute("code") === "hidden") {
    section.setAttribute("data-pg-code", "hidden");
  }

  // The bar keeps tabs in their own container so the runtime can rebuild them
  // without clobbering the state chip beside them.
  const bar = doc.createElement("div");
  bar.setAttribute("class", "pg-bar");
  bar.setAttribute("data-pg-bar", "");
  const tabsWrap = doc.createElement("div");
  tabsWrap.setAttribute("class", "pg-tabs");
  tabsWrap.setAttribute("data-pg-tabs", "");
  bar.appendChild(tabsWrap);
  bar.appendChild(buildFormatButton(doc));
  bar.appendChild(buildRunButton(doc, lang !== "ts"));
  bar.appendChild(buildStateChip(doc));
  section.appendChild(bar);

  const editor = doc.createElement("div");
  editor.setAttribute("class", "pg-editor");
  editor.setAttribute("data-pg-editor", "");
  const pre = doc.createElement("pre");
  pre.setAttribute("data-pg-fallback", "");
  const code = doc.createElement("code");
  code.textContent = entryText;
  pre.appendChild(code);
  editor.appendChild(pre);
  section.appendChild(editor);

  // Output mode is implied by the embed: markup supplied by the author means the
  // snippet paints into the DOM, while an empty embed means it speaks through
  // console. Read before the children move out. The interpreted languages get no
  // DOM handle, so they are console-only whatever the author wrote.
  let mode = el.children.length > 0 ? "dom" : "console";
  if (lang !== "ts" && mode === "dom") {
    console.warn(
      `[playground] ${lang} embeds are console-only; ignoring markup in snippet ${snippet}`,
    );
    mode = "console";
  }
  section.setAttribute("data-pg-output", mode);

  // One output region holding every face — attached DOM, charts, console and the
  // error report. CSS picks which is visible from the section's state/mode, so
  // an error simply replaces whichever output was showing.
  const out = doc.createElement("div");
  out.setAttribute("class", "pg-out");

  const target = doc.createElement("div");
  target.setAttribute("class", "pg-target");
  target.setAttribute("data-pg-target", "");
  while (el.firstChild) target.appendChild(el.firstChild);
  out.appendChild(target);

  // Charts from any language land here. Empty by default and CSS-hidden; shown
  // the moment a plot is drawn into it.
  const plots = doc.createElement("div");
  plots.setAttribute("class", "pg-plots");
  plots.setAttribute("data-pg-plots", "");
  out.appendChild(plots);

  const consoleEl = doc.createElement("div");
  consoleEl.setAttribute("class", "pg-console");
  consoleEl.setAttribute("data-pg-console", "");
  out.appendChild(consoleEl);

  const errorEl = doc.createElement("pre");
  errorEl.setAttribute("class", "pg-error");
  errorEl.setAttribute("data-pg-error", "");
  out.appendChild(errorEl);

  section.appendChild(out);

  // Carry the snippet source. `<` → `\u003c` keeps the raw-text `<script>` safe
  // from `</script>` truncation and round-trips through JSON.parse untouched.
  const json = doc.createElement("script");
  json.setAttribute("type", "application/json");
  json.setAttribute("data-pg-files", "");
  json.textContent = JSON.stringify({ files, entry, lang }).replace(
    /</g,
    "\\u003c",
  );
  section.appendChild(json);

  el.replaceWith(section);
  return true;
}

/**
 * Top-right state chip: a colour-coded dot plus its label. The runtime flips
 * `data-pg-state` on the section and rewrites the label; CSS owns the colour
 * and the animation, so the states stay declarative. Rendered server-side as
 * `Idle` so the chip is present before the runtime loads.
 */
function buildStateChip(doc: Document): HTMLElement {
  const chip = doc.createElement("span");
  chip.setAttribute("class", "pg-state");
  chip.setAttribute("role", "status");
  chip.setAttribute("aria-live", "polite");

  const dot = doc.createElement("span");
  dot.setAttribute("class", "pg-dot");
  dot.setAttribute("aria-hidden", "true");

  const label = doc.createElement("span");
  label.setAttribute("data-pg-state-label", "");
  label.textContent = "Idle";

  chip.appendChild(dot);
  chip.appendChild(label);
  return chip;
}

/**
 * Run control at the right of the tab bar. TypeScript embeds auto-run when
 * scrolled into view, so their glyph is decorative and the accessible name comes
 * from `aria-label`. The interpreted languages never auto-run, so their button
 * carries a visible "Run" — which then *is* the accessible name, and an
 * `aria-label` beside it would only override the text a reader can see.
 */
function buildRunButton(doc: Document, labeled: boolean): HTMLElement {
  const btn = doc.createElement("button");
  btn.setAttribute("type", "button");
  btn.setAttribute("class", labeled ? "pg-run pg-run-labeled" : "pg-run");
  btn.setAttribute("data-pg-run", "");
  if (!labeled) btn.setAttribute("aria-label", "Run snippet");
  btn.setAttribute("title", "Run");
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" ' +
    'aria-hidden="true" focusable="false">' +
    '<path d="M5 3.4v9.2l7.2-4.6L5 3.4Z" fill="currentColor"/></svg>';
  if (labeled) {
    const label = doc.createElement("span");
    label.textContent = "Run";
    btn.appendChild(label);
  }
  return btn;
}

/**
 * Format control. Rendered `disabled`: formatting needs the mounted editor, and
 * the runtime enables the button once it has one — so a click before the heavy
 * chunk lands is impossible rather than queued.
 */
function buildFormatButton(doc: Document): HTMLElement {
  const btn = doc.createElement("button");
  btn.setAttribute("type", "button");
  btn.setAttribute("class", "pg-format");
  btn.setAttribute("data-pg-format", "");
  btn.setAttribute("disabled", "");
  btn.setAttribute("aria-label", "Format code");
  btn.setAttribute("title", "Format (Shift+Alt+F)");
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" ' +
    'aria-hidden="true" focusable="false">' +
    '<path d="M2 3.5h12M2 7h8M2 10.5h12M2 14h8" stroke="currentColor" ' +
    'stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
  return btn;
}

/**
 * Shared playground modules, keyed by the specifier snippets import them under:
 * `lib/flow.tsx` becomes `@pg/flow.tsx`, which the bundler's extension probing
 * resolves from a bare `@pg/flow`. Read fresh each build so editing the library
 * shows up on the next rebuild.
 */
function readLib(site: Site): Record<string, string> {
  const dir = posix.join(site.src(), LIB_DIR);
  const lib: Record<string, string> = {};
  try {
    for (const ent of Deno.readDirSync(dir)) {
      if (!ent.isFile || !/\.tsx?$/.test(ent.name)) continue;
      lib[`@pg/${ent.name}`] = Deno.readTextFileSync(posix.join(dir, ent.name));
    }
  } catch {
    // No shared library in this project; `@pg/…` imports simply won't resolve.
  }
  return lib;
}

/**
 * Emit the shared library once per page rather than inside each embed's payload,
 * so a page with several playgrounds carries one copy of the source.
 */
function injectLib(doc: Document, lib: Record<string, string>): void {
  if (Object.keys(lib).length === 0) return;
  if (doc.querySelector("[data-pg-lib]")) return;
  const el = doc.createElement("script");
  el.setAttribute("type", "application/json");
  el.setAttribute("data-pg-lib", "");
  el.textContent = JSON.stringify(lib).replace(/</g, "\\u003c");
  doc.body.appendChild(el);
}
