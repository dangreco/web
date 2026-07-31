// Hand-rolled OCaml indenter. No browser-capable ocamlformat or ocp-indent build
// is published (npm/jsDelivr both have none), and compiling ocamlformat to
// JS/WASM here would mean an opam + js_of_ocaml pipeline with Unix stubs to host
// and maintain. So this reindents OCaml the way ocp-indent does: a token walk
// that fixes indentation from a small block model while leaving the author's
// structure — line breaks, argument layout — completely untouched.
//
// It is an *indenter*, not a pretty-printer: it will not collapse or split
// lines. That is the right tool for a playground, where a Format action should
// tidy whitespace, not rewrite what the reader typed. It handles the layouts
// snippets actually use (let/in, match arms, if/then/else, fun, multi-line
// brackets, struct/sig/begin, `;;`). The one thing it deliberately does not do
// is continuation indent for a body that begins on the same line as its binding
// header (`let f = e in\n  body`) — that is a heuristic ocp-indent itself only
// approximates, and the common case (body on its own line) is handled exactly.

const INDENT = 2;

// Bindings whose `=` introduces an indented value on the following line.
const BINDING = new Set([
  "let",
  "val",
  "external",
  "and",
  "type",
  "module",
  "class",
  "method",
]);

// Openers that, when their content continues on a new line, indent that line.
const OPENS: Record<string, string> = {
  "(": "paren",
  "[": "bracket",
  "{": "brace",
  begin: "block",
  struct: "block",
  sig: "block",
  object: "block",
  do: "do",
  then: "then",
  else: "else",
};

// Closers that pop the indent stack back to their matching opener.
const CLOSE: Record<string, string> = {
  ")": "paren",
  "]": "bracket",
  "}": "brace",
  end: "block",
  done: "do",
};

interface Tok {
  v: string;
  line: number;
  col: number;
  nextNewLine: boolean;
}

const isWordStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isWordPart = (c: string): boolean => /[A-Za-z0-9_']/.test(c);

/** Lex OCaml into the tokens the indenter weighs, skipping comments, strings and
 * character literals (which can otherwise unbalance the bracket count). Numbers
 * become a placeholder token so a number-only line still gets an indent. */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 0;
  let col = 0;
  const n = src.length;
  const adv = (c: string): void => {
    if (c === "\n") {
      line++;
      col = 0;
    } else col++;
    i++;
  };
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      adv(c);
      continue;
    }
    const startLine = line;
    const startCol = col;
    if (c === "(" && src[i + 1] === "*") { // nested comment
      let depth = 1;
      adv("(");
      adv("*");
      while (i < n && depth > 0) {
        if (src[i] === "(" && src[i + 1] === "*") {
          depth++;
          adv("(");
          adv("*");
        } else if (src[i] === "*" && src[i + 1] === ")") {
          adv("*");
          adv(")");
          depth--;
        } else adv(src[i]);
      }
      continue;
    }
    if (c === '"') {
      adv('"');
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          adv(src[i]);
          adv(src[i]);
        } else adv(src[i]);
      }
      if (i < n) adv('"');
      continue;
    }
    if (c === "'") { // char literal, or a leading-' type variable — swallow one atom
      adv("'");
      if (src[i] === "\\") {
        adv(src[i]);
        if (i < n) adv(src[i]);
        if (src[i] === "'") adv("'");
      } else if (src[i + 1] === "'") {
        if (i < n) adv(src[i]);
        adv("'");
      } else if (src[i] === "'") adv("'");
      continue;
    }
    if (c === ";" && src[i + 1] === ";") {
      adv(";");
      adv(";");
      toks.push({
        v: ";;",
        line: startLine,
        col: startCol,
        nextNewLine: false,
      });
      continue;
    }
    if ("()[]{}|=".includes(c)) {
      adv(c);
      toks.push({ v: c, line: startLine, col: startCol, nextNewLine: false });
      continue;
    }
    if (c === "-" && src[i + 1] === ">") {
      adv("-");
      adv(">");
      toks.push({
        v: "->",
        line: startLine,
        col: startCol,
        nextNewLine: false,
      });
      continue;
    }
    if (c === ";") {
      adv(";");
      toks.push({ v: ";", line: startLine, col: startCol, nextNewLine: false });
      continue;
    }
    if (isWordStart(c)) {
      let w = "";
      while (i < n && isWordPart(src[i])) {
        w += src[i];
        adv(src[i]);
      }
      toks.push({ v: w, line: startLine, col: startCol, nextNewLine: false });
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (
        i < n && /[0-9.eE+\-_a-zA-Z]/.test(src[i]) && !isWordStart(src[i])
      ) {
        adv(src[i]);
      }
      toks.push({ v: "#", line: startLine, col: startCol, nextNewLine: false }); // number
      continue;
    }
    adv(c); // any other operator/punctuation: ignored by the indenter
  }
  return toks;
}

interface Frame {
  type: string;
  level: number;
}

function popType(stack: Frame[], type: string): boolean {
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k].type === type) {
      stack.length = k;
      return true;
    }
  }
  return false;
}

export function formatOcaml(src: string): string {
  const toks = tokenize(src);
  for (let k = 0; k < toks.length; k++) {
    toks[k].nextNewLine = k + 1 < toks.length &&
      toks[k + 1].line > toks[k].line;
  }
  const numLines = src.split("\n").length;
  const indents: number[] = new Array(numLines).fill(NaN);
  const stack: Frame[] = [{ type: "root", level: 0 }];
  const top = (): number => stack[stack.length - 1].level;

  let lastBinding: string | null = null;
  // Each `let`/`and` gets a frame recording whether its `=` indented a value
  // block, so the matching `in` pops exactly that — never an outer binding's.
  let letFrames: { hasLetval: boolean }[] = [];
  let prevLine = -1;
  const reset = (): void => {
    stack.length = 1;
    letFrames = [];
    lastBinding = null;
  };

  for (const t of toks) {
    const v = t.v;
    // A closer takes effect before this line's indent is fixed, so a line that
    // *starts* with `)`, `end`, `else`, `in` ... lands at its opener's level.
    if (v === ";;") {
      reset();
    } else if (v === "in") {
      // Pop only the value block this `let ... =` actually opened (paired via
      // the frame), never an enclosing binding's.
      if (letFrames.length) {
        const f = letFrames.pop()!;
        if (f.hasLetval) popType(stack, "letval");
      }
    } else if (v === "else") {
      popType(stack, "then");
    } else if (CLOSE[v]) {
      popType(stack, CLOSE[v]);
    }

    if (t.line !== prevLine) {
      indents[t.line] = top();
      prevLine = t.line;
    }

    if (v === ";;") continue;
    if (BINDING.has(v)) {
      lastBinding = v;
      if (v === "let" || v === "and") letFrames.push({ hasLetval: false });
    }
    if (v === "=" && lastBinding) {
      lastBinding = null;
      if (t.nextNewLine) {
        if (letFrames.length) letFrames[letFrames.length - 1].hasLetval = true;
        stack.push({ type: "letval", level: top() + INDENT });
      }
      continue;
    }
    if (OPENS[v] && t.nextNewLine) {
      stack.push({ type: OPENS[v], level: top() + INDENT });
    }
  }

  // Comment-only and blank lines carry no token; inherit the previous line's
  // indent so they sit inside their block rather than snapping to the margin.
  for (let i = 0; i < numLines; i++) {
    if (Number.isNaN(indents[i])) indents[i] = i > 0 ? indents[i - 1] : 0;
  }

  return src.split("\n").map((ln, idx) => {
    if (ln.trim() === "") return "";
    return `${" ".repeat(indents[idx])}${ln.trim()}`;
  }).join("\n");
}
