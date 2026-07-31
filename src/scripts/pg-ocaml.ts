// OCaml evaluator. The toplevel is @basthon/kernel-ocaml — a js_of_ocaml build
// of the real OCaml 5.3.0 compiler and runtime — fetched from jsDelivr when a
// reader first clicks Run. Nothing is vendored or redistributed here.
//
// It runs in a *classic* Worker, for two reasons. `__kernel__.js` is a classic
// script that assigns `self.__kernel__`, so it has to arrive through
// `importScripts`, which module workers do not have. And a snippet the reader
// edited into a non-terminating loop has to be killable, which is only possible
// off the main thread.

import type {
  ForeignRunner,
  RunDiagnostic,
  RunOutcome,
  Sink,
} from "./pg-types.ts";

const KERNEL_URL =
  "https://cdn.jsdelivr.net/npm/@basthon/kernel-ocaml@0.77.7/lib/__kernel__.js";

/** Long enough for a cold kernel plus real work, short enough to still be an
 * escape hatch from `let rec loop () = loop ()`. */
const TIMEOUT_MS = 15_000;

/**
 * `Line 3, characters 12-13:` heads each item in the toplevel's error report.
 * The line is 1-based within the submitted source and the character offsets are
 * 0-based columns within that line, which is exactly `RunDiagnostic`'s shape.
 * The `Lines a-b` plural form is the multi-line span variant.
 */
const OCAML_LOC = /^Lines? (\d+)(?:-(\d+))?, characters (\d+)-(\d+):/gm;

interface DoneMessage {
  type: "done";
  id: number;
  stdout: string;
  stderr: string;
  result: string;
}

// Classic worker body. `k.exec` returns the toplevel's rendering of the last
// phrase's value; printed output arrives through the `io` callbacks instead, so
// both have to be collected and posted back together.
const WORKER_SRC = `importScripts(${JSON.stringify(KERNEL_URL)});
var k = self.__kernel__;
k.init();
self.postMessage({ type: "ready" });
self.onmessage = function (e) {
  var out = [], err = [];
  k.io.stdout = function (s) { out.push(s); };
  k.io.stderr = function (s) { err.push(s); };
  var result = "";
  try { result = String(k.exec(e.data.code) || ""); }
  catch (ex) { err.push(String((ex && ex.message) || ex)); }
  self.postMessage({
    type: "done", id: e.data.id,
    stdout: out.join(""), stderr: err.join(""), result: result,
  });
};
`;

/**
 * Split the compiler's report into one diagnostic per location header, each
 * carrying the prose that follows it up to the next header.
 */
function parseDiagnostics(stderr: string): RunDiagnostic[] {
  const hits = [...stderr.matchAll(OCAML_LOC)];
  return hits.map((m, i) => ({
    line: Number(m[1]),
    endLine: Number(m[2] ?? m[1]),
    column: Number(m[3]),
    endColumn: Number(m[4]),
    message: stderr.slice(
      m.index + m[0].length,
      hits[i + 1]?.index ?? stderr.length,
    ).trim(),
  }));
}

function report(msg: DoneMessage, sink: Sink): RunOutcome {
  // stdout arrives as raw write chunks; the output pane is line-oriented.
  const lines = msg.stdout.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) sink.log(line);

  const result = msg.result.trim();
  // A *runtime* exception is not written to stderr — the toplevel renders it as
  // the phrase's value, so it has to be sniffed out of the result.
  if (result.startsWith("Exception:")) {
    return { ok: false, message: result, diagnostics: [] };
  }
  if (result) sink.log(result);

  if (!msg.stderr) return { ok: true, diagnostics: [] };
  return {
    ok: false,
    message: msg.stderr,
    diagnostics: parseDiagnostics(msg.stderr),
  };
}

export function createRunner(): ForeignRunner {
  let worker: Worker | undefined;
  let ready: Promise<void> | undefined;
  let seq = 0;

  // Drop the kernel entirely: the next `load()` builds a fresh one. Used when a
  // snippet has to be killed mid-evaluation, since the toplevel's state after a
  // `terminate()` is unknowable.
  function reset(): void {
    worker?.terminate();
    worker = undefined;
    ready = undefined;
  }

  return {
    load(): Promise<void> {
      if (ready) return ready;
      ready = new Promise<void>((resolve, reject) => {
        const url = URL.createObjectURL(
          new Blob([WORKER_SRC], { type: "text/javascript" }),
        );
        const w = new Worker(url);
        worker = w;
        w.addEventListener("error", (e) => {
          URL.revokeObjectURL(url);
          reset();
          reject(new Error(`OCaml kernel failed to load: ${e.message}`));
        }, { once: true });
        // Listeners rather than `onmessage`, so the handshake and each run can
        // detach independently instead of overwriting one another's handler.
        const onReady = (e: MessageEvent<{ type?: string }>) => {
          if (e.data?.type !== "ready") return;
          w.removeEventListener("message", onReady);
          URL.revokeObjectURL(url);
          resolve();
        };
        w.addEventListener("message", onReady);
      });
      return ready;
    },

    run(source: string, sink: Sink): Promise<RunOutcome> {
      const w = worker;
      if (!w) return Promise.reject(new Error("OCaml kernel not loaded"));

      // The toplevel needs a phrase terminator, and terminating twice is itself
      // a syntax error.
      const code = source.trimEnd().endsWith(";;") ? source : `${source}\n;;`;
      const id = ++seq;

      return new Promise<RunOutcome>((resolve) => {
        const onDone = (e: MessageEvent<DoneMessage>) => {
          if (e.data.type !== "done" || e.data.id !== id) return;
          clearTimeout(timer);
          w.removeEventListener("message", onDone);
          resolve(report(e.data, sink));
        };
        const timer = setTimeout(() => {
          w.removeEventListener("message", onDone);
          reset();
          resolve({
            ok: false,
            message: `OCaml evaluation timed out after ${TIMEOUT_MS / 1000}s`,
            diagnostics: [],
          });
        }, TIMEOUT_MS);

        w.addEventListener("message", onDone);
        w.postMessage({ id, code });
      });
    },
  };
}
