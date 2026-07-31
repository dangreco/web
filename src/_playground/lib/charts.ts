// Shared playground chart library, imported as `@pg/charts`. Hand-rolled SVG —
// no charting dependency — so the plots read the page's palette variables and
// re-render on a dark/light flip, the same posture as `@pg/flow`.
//
// Three shapes, each with a single sensible-default call:
//   bar(data)     bar chart
//   line(data)    line through ordered points
//   scatter(data) points only
//
// `data` accepts the shapes a reader is most likely to hand-write:
//   bar     number[] | [label,value][] | {label,value}[] | {labels,values}
//   line/   number[] | [x,y][] | {x,y}[] | {x:number[], y:number[]}
//   scatter
//
// The snippet-facing `bar`/`line`/`scatter` draw into the active playground's
// plot pane (a global the runtime points at the running section before each
// Run). `renderChart` is the target-explicit core the runtime also calls for the
// interpreted languages.

const SVG_NS = "http://www.w3.org/2000/svg";

export interface ChartOptions {
  title?: string;
  /** Plot height in CSS pixels. Default 240. */
  height?: number;
  xLabel?: string;
  yLabel?: string;
  /** Fill/stroke colour. Defaults to the palette accent. */
  color?: string;
}

interface Palette {
  accent: string;
  ink: string;
  inkMute: string;
  rule: string;
}

function readPalette(el: Element): Palette {
  // Inherited custom properties resolve through `getComputedStyle`, so a theme
  // flip (body[data-color]) changes these without reloading anything.
  const s = getComputedStyle(el);
  const v = (name: string, fb: string): string =>
    s.getPropertyValue(name).trim() || fb;
  return {
    accent: v("--color-accent", "#3b82f6"),
    ink: v("--color-ink", "#111827"),
    inkMute: v("--color-ink-mute", "#6b7280"),
    rule: v("--color-rule", "#e5e7eb"),
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function asNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`expected a number, got ${JSON.stringify(v)}`);
  }
  return n;
}

interface BarData {
  labels: string[];
  values: number[];
}
interface XYData {
  x: number[];
  y: number[];
}

function normalizeBar(data: unknown): BarData {
  if (Array.isArray(data)) {
    if (data.length === 0) return { labels: [], values: [] };
    const first = data[0];
    if (typeof first === "number") {
      return {
        labels: data.map((_, i) => String(i)),
        values: data.map(asNum),
      };
    }
    if (Array.isArray(first) && first.length === 2) {
      return {
        labels: data.map((d) => String((d as unknown[])[0])),
        values: data.map((d) => asNum((d as unknown[])[1])),
      };
    }
    if (first && typeof first === "object" && "value" in first) {
      return {
        labels: data.map((d) => String((d as { label?: unknown }).label ?? "")),
        values: data.map((d) => asNum((d as { value: unknown }).value)),
      };
    }
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.labels) && Array.isArray(o.values)) {
      return {
        labels: (o.labels as unknown[]).map(String),
        values: (o.values as unknown[]).map(asNum),
      };
    }
  }
  throw new Error(
    "bar data must be number[], [label,value][], {label,value}[], or {labels,values}",
  );
}

function normalizeXY(data: unknown): XYData {
  if (Array.isArray(data)) {
    if (data.length === 0) return { x: [], y: [] };
    const first = data[0];
    if (typeof first === "number") {
      return { x: data.map((_, i) => i), y: data.map(asNum) };
    }
    if (Array.isArray(first) && first.length >= 2) {
      return {
        x: data.map((d) => asNum((d as unknown[])[0])),
        y: data.map((d) => asNum((d as unknown[])[1])),
      };
    }
    if (first && typeof first === "object" && "y" in first) {
      return {
        x: data.map((d, i) =>
          "x" in (d as object) ? asNum((d as { x: unknown }).x) : i
        ),
        y: data.map((d) => asNum((d as { y: unknown }).y)),
      };
    }
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.x) && Array.isArray(o.y)) {
      return {
        x: (o.x as unknown[]).map(asNum),
        y: (o.y as unknown[]).map(asNum),
      };
    }
  }
  throw new Error(
    "line/scatter data must be number[], [x,y][], {x,y}[], or {x:number[],y:number[]}",
  );
}

/** Round a [0, range] extent to a tidy 1/2/5 × 10ⁿ step. */
function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range || 1));
  const frac = (range || 1) / Math.pow(10, exp);
  let nf: number;
  if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

function niceScale(min: number, max: number, count = 5): Scale {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return { min: lo, max: hi, ticks };
}

interface Layout {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  plotW: number;
  plotH: number;
}

function layout(width: number, height: number, titled: boolean): Layout {
  const x0 = 48;
  const x1 = width - 16;
  const y0 = titled ? 34 : 18;
  const y1 = height - 40;
  return { x0, x1, y0, y1, plotW: x1 - x0, plotH: y1 - y0 };
}

interface Built {
  inner: string;
  /** Tooltip text per `data-i` mark index. */
  info: string[];
}

function buildBar(
  data: unknown,
  opts: ChartOptions,
  W: number,
  H: number,
  p: Palette,
): Built {
  const { labels, values } = normalizeBar(data);
  const L = layout(W, H, Boolean(opts.title));
  const maxV = values.length ? Math.max(...values) : 1;
  const minV = values.length ? Math.min(...values, 0) : 0;
  const scale = niceScale(Math.min(0, minV), Math.max(0, maxV), 5);
  const span = scale.max - scale.min || 1;
  const yPx = (v: number): number => L.y1 - ((v - scale.min) / span) * L.plotH;
  const baseY = yPx(0);
  const parts: string[] = [];

  for (const t of scale.ticks) {
    const y = yPx(t);
    parts.push(
      `<line class="pgc-grid" x1="${L.x0}" y1="${y}" x2="${L.x1}" y2="${y}"/>`,
    );
    parts.push(
      `<text class="pgc-axis" x="${L.x0 - 8}" y="${y + 4}" text-anchor="end">${
        esc(fmtNum(t))
      }</text>`,
    );
  }
  parts.push(
    `<line class="pgc-axisline" x1="${L.x0}" y1="${baseY}" x2="${L.x1}" y2="${baseY}"/>`,
  );

  const info: string[] = [];
  const color = opts.color ?? p.accent;
  if (values.length === 0) {
    parts.push(
      `<text class="pgc-empty" x="${(L.x0 + L.x1) / 2}" y="${
        (L.y0 + L.y1) / 2
      }" text-anchor="middle">no data</text>`,
    );
  } else {
    const band = L.plotW / values.length;
    const bw = Math.min(band * 0.66, 56);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const vy = yPx(v);
      const y = Math.min(vy, baseY);
      const h = Math.abs(baseY - vy);
      parts.push(
        `<rect class="pgc-mark pgc-bar" data-i="${i}" x="${
          L.x0 + i * band + (band - bw) / 2
        }" y="${y}" width="${bw}" height="${h}" fill="${esc(color)}" rx="2"/>`,
      );
      info[i] = `${labels[i] || "#".concat(String(i))}: ${fmtNum(v)}`;
      const lx = L.x0 + i * band + band / 2;
      parts.push(
        `<text class="pgc-axis" x="${lx}" y="${
          L.y1 + 18
        }" text-anchor="middle">${
          esc(truncate(labels[i] || String(i), 12))
        }</text>`,
      );
    }
  }

  decorate(parts, opts, L, p);
  return { inner: parts.join(""), info };
}

function buildXY(
  data: unknown,
  opts: ChartOptions,
  W: number,
  H: number,
  p: Palette,
  asLine: boolean,
): Built {
  const { x, y } = normalizeXY(data);
  const L = layout(W, H, Boolean(opts.title));
  const xs = x.length
    ? niceScale(Math.min(...x), Math.max(...x), 6)
    : { min: 0, max: 1, ticks: [0, 1] };
  const ys = y.length
    ? niceScale(Math.min(...y), Math.max(...y), 5)
    : { min: 0, max: 1, ticks: [0, 1] };
  const xspan = xs.max - xs.min || 1;
  const yspan = ys.max - ys.min || 1;
  const xPx = (v: number): number => L.x0 + ((v - xs.min) / xspan) * L.plotW;
  const yPx = (v: number): number => L.y1 - ((v - ys.min) / yspan) * L.plotH;
  const parts: string[] = [];

  for (const t of ys.ticks) {
    const yy = yPx(t);
    parts.push(
      `<line class="pgc-grid" x1="${L.x0}" y1="${yy}" x2="${L.x1}" y2="${yy}"/>`,
    );
    parts.push(
      `<text class="pgc-axis" x="${L.x0 - 8}" y="${yy + 4}" text-anchor="end">${
        esc(fmtNum(t))
      }</text>`,
    );
  }
  for (const t of xs.ticks) {
    const xx = xPx(t);
    parts.push(
      `<line class="pgc-grid pgc-grid-v" x1="${xx}" y1="${L.y0}" x2="${xx}" y2="${L.y1}"/>`,
    );
    parts.push(
      `<text class="pgc-axis" x="${xx}" y="${L.y1 + 18}" text-anchor="middle">${
        esc(fmtNum(t))
      }</text>`,
    );
  }
  parts.push(
    `<line class="pgc-axisline" x1="${L.x0}" y1="${L.y0}" x2="${L.x0}" y2="${L.y1}"/>`,
  );
  parts.push(
    `<line class="pgc-axisline" x1="${L.x0}" y1="${L.y1}" x2="${L.x1}" y2="${L.y1}"/>`,
  );

  const color = opts.color ?? p.accent;
  const info: string[] = [];
  if (x.length === 0) {
    parts.push(
      `<text class="pgc-empty" x="${(L.x0 + L.x1) / 2}" y="${
        (L.y0 + L.y1) / 2
      }" text-anchor="middle">no data</text>`,
    );
  } else {
    if (asLine) {
      const d = x.map((xv, i) => `${i ? "L" : "M"}${xPx(xv)},${yPx(y[i])}`)
        .join(" ");
      parts.push(
        `<path class="pgc-line" d="${d}" fill="none" stroke="${esc(color)}"/>`,
      );
    }
    for (let i = 0; i < x.length; i++) {
      const cx = xPx(x[i]);
      const cy = yPx(y[i]);
      // A wide transparent hit target so a thin dot is still easy to hover; the
      // visible dot sits on top of it.
      parts.push(
        `<circle class="pgc-mark pgc-hit" data-i="${i}" cx="${cx}" cy="${cy}" r="12" fill="transparent"/>`,
      );
      parts.push(
        `<circle class="pgc-dot" cx="${cx}" cy="${cy}" r="${
          asLine ? 2.5 : 4
        }" fill="${esc(color)}" pointer-events="none"/>`,
      );
      info[i] = `(${fmtNum(x[i])}, ${fmtNum(y[i])})`;
    }
  }

  decorate(parts, opts, L, p);
  return { inner: parts.join(""), info };
}

/** Title and axis labels, drawn last so they sit above the marks. */
function decorate(
  parts: string[],
  opts: ChartOptions,
  L: Layout,
  p: Palette,
): void {
  void p;
  if (opts.title) {
    parts.push(
      `<text class="pgc-title" x="${L.x0}" y="${L.y0 - 12}">${
        esc(opts.title)
      }</text>`,
    );
  }
  if (opts.yLabel) {
    parts.push(
      `<text class="pgc-axislabel" transform="translate(14,${
        (L.y0 + L.y1) / 2
      }) rotate(-90)" text-anchor="middle">${esc(opts.yLabel)}</text>`,
    );
  }
  if (opts.xLabel) {
    parts.push(
      `<text class="pgc-axislabel" x="${(L.x0 + L.x1) / 2}" y="${
        L.y1 + 34
      }" text-anchor="middle">${esc(opts.xLabel)}</text>`,
    );
  }
}

export function renderChart(
  target: HTMLElement,
  kind: "bar" | "line" | "scatter",
  data: unknown,
  opts: ChartOptions = {},
): () => void {
  const container = document.createElement("div");
  container.className = "pgc";
  target.appendChild(container);

  const tip = document.createElement("div");
  tip.className = "pgc-tip";
  tip.setAttribute("role", "tooltip");
  container.appendChild(tip);

  const height = opts.height ?? 240;
  let info: string[] = [];

  const draw = (): void => {
    const p = readPalette(container);
    const width = Math.max(280, container.clientWidth || 600);
    const built = kind === "bar"
      ? buildBar(data, opts, width, height, p)
      : buildXY(data, opts, width, height, p, kind === "line");
    info = built.info;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pgc-svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = built.inner;
    // Keep the tooltip element; replace only the chart itself.
    container.replaceChildren(svg);
    container.appendChild(tip);
    wireMarks(svg, info, tip, container);
  };

  // Re-render when the palette flips (body[data-color]) and when the pane
  // resizes, so the SVG is always laid out at real pixel coordinates — which is
  // also what makes the tooltip's pixel math correct.
  const themeObserver = new MutationObserver(() => draw());
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-color"],
  });
  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(container);
  draw();

  return () => {
    themeObserver.disconnect();
    resizeObserver.disconnect();
    container.remove();
  };
}

function wireMarks(
  svg: SVGSVGElement,
  info: string[],
  tip: HTMLElement,
  container: HTMLElement,
): void {
  const show = (m: Element): void => {
    const i = Number(m.getAttribute("data-i"));
    tip.textContent = info[i] ?? "";
    tip.classList.add("pgc-tip-show");
    const mb = m.getBoundingClientRect();
    const cb = container.getBoundingClientRect();
    const left = mb.left - cb.left + mb.width / 2 - tip.offsetWidth / 2;
    const top = mb.top - cb.top - tip.offsetHeight - 6;
    tip.style.left = `${
      Math.max(6, Math.min(container.clientWidth - tip.offsetWidth - 6, left))
    }px`;
    tip.style.top = `${Math.max(6, top)}px`;
  };
  const hide = (): void => tip.classList.remove("pgc-tip-show");
  svg.querySelectorAll<SVGElement>(".pgc-mark").forEach((m) => {
    m.addEventListener("mouseenter", () => show(m));
    m.addEventListener("mouseleave", hide);
    m.addEventListener("focus", () => show(m));
    m.addEventListener("blur", hide);
  });
}

// The runtime points this at the running section's plot pane before each Run, so
// a snippet never has to think about which element it is drawing into.
const scope = globalThis as unknown as { __pgPlotPane?: HTMLElement };

function pane(): HTMLElement {
  const p = scope.__pgPlotPane;
  if (!p) {
    throw new Error(
      "@pg/charts: no plot pane — charts can only be drawn while a playground runs",
    );
  }
  return p;
}

export function bar(data: unknown, opts?: ChartOptions): () => void {
  return renderChart(pane(), "bar", data, opts);
}

export function line(data: unknown, opts?: ChartOptions): () => void {
  return renderChart(pane(), "line", data, opts);
}

export function scatter(data: unknown, opts?: ChartOptions): () => void {
  return renderChart(pane(), "scatter", data, opts);
}
