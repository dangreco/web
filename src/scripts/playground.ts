// Light entry: discovers playgrounds and lazy-loads the heavy runtime
// (CodeMirror + esbuild-wasm) only when a section is about to be used. This
// keeps the multi-MB runtime out of the initial page weight.
//
// Discovered via `<script type="module" src="/scripts/playground.js">` injected
// by the build-time plugin for any page containing a `[data-pg]` section.

let heavyPromise: Promise<typeof import("./heavy.ts")> | null = null;

function loadHeavy(): Promise<typeof import("./heavy.ts")> {
  if (!heavyPromise) {
    // Lazy code-split: `heavy.ts` (CodeMirror + esbuild-wasm) becomes a sibling
    // chunk fetched only on first use. A static import would pull the whole
    // runtime into the initial bundle, so this dynamic import is the intended
    // loading boundary, not an avoidable indirection.
    heavyPromise = import("./heavy.ts");
  }
  return heavyPromise;
}

const initialized = new WeakSet<Element>();
const wantRun = new WeakSet<Element>();

/**
 * Mirrors the runtime's state chip for the two states that can occur before
 * `heavy.ts` exists. Inlined rather than imported so the light entry keeps no
 * runtime dependency on the chunk it is lazily fetching.
 */
function setChipState(
  section: HTMLElement,
  state: "loading" | "error",
  label: string,
): void {
  section.setAttribute("data-pg-state", state);
  const el = section.querySelector("[data-pg-state-label]");
  if (el) el.textContent = label;
}

function ensure(section: HTMLElement, run: boolean): void {
  if (run) wantRun.add(section);
  if (initialized.has(section)) return;
  initialized.add(section);
  setChipState(section, "loading", "Loading");
  loadHeavy().then(
    (heavy) => heavy.initPlayground(section, { autoRun: wantRun.has(section) }),
    (err) => {
      console.error("[playground] runtime load failed", err);
      setChipState(section, "error", "Error");
    },
  );
}

function setup(section: HTMLElement): void {
  // Clicking Run before preload still loads + runs (autoRun) on first use.
  section.querySelector<HTMLButtonElement>("[data-pg-run]")
    ?.addEventListener("click", () => ensure(section, true));

  if (typeof IntersectionObserver === "undefined") {
    ensure(section, true);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        ensure(section, true);
        io.disconnect();
      }
    }
  });
  io.observe(section);
}

function start(): void {
  const sections = document.querySelectorAll<HTMLElement>("[data-pg]");
  sections.forEach(setup);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
