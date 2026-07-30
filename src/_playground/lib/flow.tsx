// Shared playground library, injected into every snippet's virtual filesystem
// and imported as `@pg/flow`. Turns an XState machine into a static React Flow
// diagram that highlights the live state.
//
// The diagram is deliberately inert: no panning, zooming, dragging, selection
// or keyboard focus. It is an illustration that reacts to the actor, not a
// canvas the reader is meant to manipulate.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import type {
  EdgeProps,
  EdgeTypes,
  NodeProps,
  NodeTypes,
  Rect,
} from "@xyflow/react";
import type { AnyStateMachine, StateNode } from "xstate";

const BASE_CSS = "https://esm.sh/@xyflow/react@12.11.2/dist/base.css";

/** Semantic role of a state, which drives its colour and animation. */
export type NodeKind = "normal" | "success" | "failure";

/** Which track an edge is drawn on. */
export type EdgeRoute = "direct" | "over" | "under";

export interface FlowNodeSpec {
  /** The state's own key, e.g. `red`. */
  id: string;
  label: string;
  kind: NodeKind;
  isInitial: boolean;
  position: { x: number; y: number };
  /** Left-side target handles this node needs, at least 1. */
  ins: number;
  /** Right-side source handles this node needs, at least 1. */
  outs: number;
}

export interface FlowEdgeSpec {
  id: string;
  source: string;
  target: string;
  /** The event that causes the transition. */
  label: string;
  route: EdgeRoute;
  /**
   * Offset index inside the edge's parallel group (same source *and* target).
   * Signed and possibly half-integral for `direct`, a non-negative integer for
   * the one-sided `over`/`under` corridors.
   */
  lane: number;
  /** Index of this edge among the source's outgoing `direct` edges. 0 otherwise. */
  sourceSlot: number;
  /** Index of this edge among the target's incoming `direct` edges. 0 otherwise. */
  targetSlot: number;
}

export interface FlowGraph {
  nodes: FlowNodeSpec[];
  edges: FlowEdgeSpec[];
  initial: string;
  /** Flow-space px the `over` corridor reaches above the node bounding box. */
  over: number;
  /** Flow-space px the `under` corridor reaches below the node bounding box. */
  under: number;
}

// A state is a failure if it is tagged as one, a success if tagged or `final`.
// Tags win over `type` so an error state declared `final` still reads as a
// failure rather than a happy ending.
const FAILURE_TAGS: Record<string, true> = {
  error: true,
  failure: true,
  failed: true,
  rejected: true,
};
const SUCCESS_TAGS: Record<string, true> = {
  success: true,
  done: true,
  complete: true,
  resolved: true,
};

const X_GAP = 190;
const Y_GAP = 88;
const LANE_X = 44; // separation of the vertical legs of parallel `direct` edges
const LANE_Y = 30; // vertical separation of same-row parallel `direct` edges
const STUB = 24; // horizontal stub before a same-row parallel edge steps aside
const CORRIDOR_BASE = 34; // node bounding box -> first corridor lane
const CORRIDOR_GAP = 30; // corridor lane -> corridor lane
const CORNER = 8; // rounded-corner radius of the orthogonal polylines
const LABEL_OFFSET = 11; // label offset perpendicular to its anchor segment
const LABEL_STACK = 20; // per-lane label stagger along its anchor segment
const LABEL_AT = 0.28; // where along a `direct` anchor segment its label sits
const LABEL_ROOM = 16; // room reserved for a label lifted off the outermost corridor
const FIT_MARGIN = 18; // uniform slack added to the fitted rect
const NODE_H = 30; // node height assumed before measurement lands
const MIN_H = 120; // floor, so a two-state machine still has presence
const MAX_ZOOM = 1.35; // ceiling, so a tiny graph is not inflated to cartoon size
const MIN_ZOOM = 0.1; // floor, so `fitBounds` can always shrink a graph to fit
const FIT_PAD = 0.02; // fraction React Flow insets the fitted rect by

function kindOf(node: StateNode): NodeKind {
  for (const tag of node.tags ?? []) if (FAILURE_TAGS[tag]) return "failure";
  for (const tag of node.tags ?? []) if (SUCCESS_TAGS[tag]) return "success";
  return node.type === "final" ? "success" : "normal";
}

/**
 * Breadth-first layering from the initial state: an edge always points at a
 * depth greater than or equal to its source, which lays a state machine out as
 * a readable left-to-right progression. States unreachable from the initial
 * state are parked in a trailing column rather than stacked at the origin.
 */
/** An edge before classification: parsed straight from the machine, with no
 * routing decisions made yet. */
type RawEdge = { id: string; source: string; target: string; label: string };

function depthsOf(
  ids: readonly string[],
  edges: readonly RawEdge[],
  initial: string,
): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const depths = new Map<string, number>([[initial, 0]]);
  const queue = [initial];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const next = (depths.get(id) ?? 0) + 1;
    for (const child of outgoing.get(id) ?? []) {
      if (depths.has(child)) continue;
      depths.set(child, next);
      queue.push(child);
    }
  }

  let orphanColumn = 0;
  for (const depth of depths.values()) {
    orphanColumn = Math.max(orphanColumn, depth);
  }
  orphanColumn += 1;
  for (const id of ids) if (!depths.has(id)) depths.set(id, orphanColumn);
  return depths;
}

/**
 * Map an XState machine to a flow chart: one node per top-level state, one edge
 * per event transition, laid out in columns by distance from the initial state.
 *
 * Pure and synchronous — it reads only the machine definition, never an actor,
 * so the same graph can be reused across runs and asserted against directly.
 */
export function machineToFlow(machine: AnyStateMachine): FlowGraph {
  const states = machine.states as Record<string, StateNode>;
  const ids = Object.keys(states);
  const initial = machine.root.initial?.target?.[0]?.key ?? ids[0] ?? "";

  // 1. Collect, de-duplicating. Two guarded transitions on the same event to
  // the same target differ only by a guard, which the diagram does not draw,
  // so one arrow is correct — and duplicate ids would otherwise produce
  // duplicate React keys and ambiguous grouping.
  const seenIds = new Set<string>();
  const raw: RawEdge[] = [];
  for (const id of ids) {
    const transitions = states[id].on ?? {};
    for (const eventType of Object.keys(transitions)) {
      for (const transition of transitions[eventType] ?? []) {
        // Targetless transitions only run actions; they are not movement.
        for (const targetNode of transition.target ?? []) {
          const target = targetNode.key;
          const edgeId = `${id}-${eventType}-${target}`;
          if (seenIds.has(edgeId)) continue;
          seenIds.add(edgeId);
          raw.push({ id: edgeId, source: id, target, label: eventType });
        }
      }
    }
  }

  // 2. Depths and node positions.
  const depths = depthsOf(ids, raw, initial);
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const depth = depths.get(id) ?? 0;
    const column = columns.get(depth);
    if (column) column.push(id);
    else columns.set(depth, [id]);
  }

  const nodes: FlowNodeSpec[] = [];
  const nodeY = new Map<string, number>();
  for (const [depth, column] of columns) {
    const offset = ((column.length - 1) * Y_GAP) / 2;
    column.forEach((id, row) => {
      const y = row * Y_GAP - offset;
      nodeY.set(id, y);
      nodes.push({
        id,
        label: id,
        kind: kindOf(states[id]),
        isInitial: id === initial,
        position: { x: depth * X_GAP, y },
        ins: 1,
        outs: 1,
      });
    });
  }

  // 3. Classify each edge onto its track.
  const edges: FlowEdgeSpec[] = raw.map((r) => {
    const sd = depths.get(r.source) ?? 0;
    const td = depths.get(r.target) ?? 0;
    const route: EdgeRoute = r.source === r.target
      ? "over"
      : td === sd + 1
      ? "direct"
      : td > sd + 1
      ? "over"
      : "under";
    return { ...r, route, lane: 0, sourceSlot: 0, targetSlot: 0 };
  });

  // 4. Slot the `direct` edges onto their own handle on each side.
  const outsCount = new Map<string, number>();
  const insCount = new Map<string, number>();
  for (const id of ids) {
    const outgoing = edges
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.route === "direct" && e.source === id)
      .sort((a, b) =>
        (nodeY.get(a.e.target)! - nodeY.get(b.e.target)!) || (a.i - b.i)
      );
    outgoing.forEach(({ e }, slot) => {
      e.sourceSlot = slot;
    });
    if (outgoing.length > 0) outsCount.set(id, outgoing.length);

    const incoming = edges
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.route === "direct" && e.target === id)
      .sort((a, b) =>
        (nodeY.get(a.e.source)! - nodeY.get(b.e.source)!) || (a.i - b.i)
      );
    incoming.forEach(({ e }, slot) => {
      e.targetSlot = slot;
    });
    if (incoming.length > 0) insCount.set(id, incoming.length);
  }
  for (const node of nodes) {
    node.outs = Math.max(1, outsCount.get(node.id) ?? 0);
    node.ins = Math.max(1, insCount.get(node.id) ?? 0);
  }

  // 5. Lane the parallel `direct` groups (same source *and* target) apart.
  const directGroups = new Map<string, FlowEdgeSpec[]>();
  for (const e of edges) {
    if (e.route !== "direct") continue;
    const key = `${e.source}\u0000${e.target}`;
    const group = directGroups.get(key);
    if (group) group.push(e);
    else directGroups.set(key, [e]);
  }
  for (const group of directGroups.values()) {
    const k = group.length;
    group.forEach((e, i) => {
      e.lane = i - (k - 1) / 2;
    });
  }

  // 6. Lane the corridors: shallowest span first, so a shorter span never
  // traverses a deeper corridor's horizontal run.
  for (const route of ["over", "under"] as const) {
    const group = edges
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.route === route)
      .sort((a, b) => {
        const spanA = Math.abs(
          (depths.get(a.e.target) ?? 0) - (depths.get(a.e.source) ?? 0),
        );
        const spanB = Math.abs(
          (depths.get(b.e.target) ?? 0) - (depths.get(b.e.source) ?? 0),
        );
        return spanA - spanB || a.i - b.i;
      });
    group.forEach(({ e }, lane) => {
      e.lane = lane;
    });
  }

  // 7. Report how deep each corridor reaches so `Diagram` can fit the view.
  const overEdges = edges.filter((e) => e.route === "over");
  const underEdges = edges.filter((e) => e.route === "under");
  const maxOverLane = overEdges.reduce((m, e) => Math.max(m, e.lane), -1);
  const maxUnderLane = underEdges.reduce((m, e) => Math.max(m, e.lane), -1);
  const over = overEdges.length
    ? CORRIDOR_BASE + maxOverLane * CORRIDOR_GAP + LABEL_ROOM
    : 0;
  const under = underEdges.length
    ? CORRIDOR_BASE + maxUnderLane * CORRIDOR_GAP + LABEL_ROOM
    : 0;

  return { nodes, edges, initial, over, under };
}

/** Top-level state key(s) of a snapshot value, flat or nested. */
function activeKeys(value: unknown): Set<string> {
  if (typeof value === "string") return new Set([value]);
  if (value && typeof value === "object") return new Set(Object.keys(value));
  return new Set();
}

interface Pt {
  x: number;
  y: number;
}

/** Drop repeated and collinear interior points so degenerate bends vanish. */
function simplify(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (
      last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01
    ) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const flat = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (flat) out.splice(i, 1);
  }
  return out;
}

/** Orthogonal polyline with quadratic corners, radius clamped per corner. */
function roundedPath(points: readonly Pt[], radius: number): string {
  const pts = simplify(points);
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = {
      x: cur.x + ((prev.x - cur.x) / inLen) * r,
      y: cur.y + ((prev.y - cur.y) / inLen) * r,
    };
    const b = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    };
    d += ` L ${a.x},${a.y} Q ${cur.x},${cur.y} ${b.x},${b.y}`;
  }
  const end = pts[pts.length - 1];
  return `${d} L ${end.x},${end.y}`;
}

/**
 * Anchor the label to the longest segment of the route: `at` along it, offset
 * perpendicular so the label sits beside its own line, and staggered along it by
 * lane so two fanned-out siblings never share a box.
 */
function labelAnchor(points: readonly Pt[], lane: number, at: number): Pt {
  const pts = simplify(points);
  let best = 0, bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = pts[best], b = pts[best + 1] ?? a;
  const mx = a.x + (b.x - a.x) * at, my = a.y + (b.y - a.y) * at;
  return a.y === b.y
    ? { x: mx + lane * LABEL_STACK, y: my - LABEL_OFFSET }
    : { x: mx + LABEL_OFFSET, y: my + lane * LABEL_STACK };
}

/** The corner points of an edge's route, in flow coordinates. */
function routePoints(
  route: EdgeRoute,
  lane: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  top: number,
  bottom: number,
): Pt[] {
  const s = { x: sx, y: sy }, t = { x: tx, y: ty };
  if (route === "under") {
    const y = bottom + CORRIDOR_BASE + lane * CORRIDOR_GAP;
    return [s, { x: sx, y }, { x: tx, y }, t];
  }
  if (route === "over") {
    const y = top - CORRIDOR_BASE - lane * CORRIDOR_GAP;
    return [s, { x: sx, y }, { x: tx, y }, t];
  }
  if (Math.abs(sy - ty) >= 1) {
    // Different rows: one vertical leg, shifted per lane so siblings separate.
    const x = (sx + tx) / 2 + lane * LANE_X;
    return [s, { x, y: sy }, { x, y: ty }, t];
  }
  if (lane === 0) return [s, t];
  // Same row and a parallel sibling: step aside onto a private horizontal lane.
  const stub = Math.max(6, Math.min(STUB, (tx - sx) / 2 - 4));
  const y = sy + lane * LANE_Y;
  return [
    s,
    { x: sx + stub, y: sy },
    { x: sx + stub, y },
    { x: tx - stub, y },
    { x: tx - stub, y: ty },
    t,
  ];
}

const HANDLE_OFF = { left: "38%" } as const;
const HANDLE_ON = { left: "62%" } as const;

interface NodeData extends Record<string, unknown> {
  label: string;
  ins: number;
  outs: number;
}

function slots(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * Custom node whose per-side handle count comes from `data`: several
 * transitions leaving or entering the same node each get their own
 * connection point instead of colliding on the built-in node's single
 * handle per side.
 */
function MachineNode({ data }: NodeProps) {
  const spec = data as unknown as NodeData;
  return (
    <>
      {slots(spec.ins).map((i) => (
        <Handle
          key={`in-${i}`}
          id={`in-${i}`}
          type="target"
          position={Position.Left}
          style={{ top: `${((i + 1) / (spec.ins + 1)) * 100}%` }}
        />
      ))}
      {slots(spec.outs).map((i) => (
        <Handle
          key={`out-${i}`}
          id={`out-${i}`}
          type="source"
          position={Position.Right}
          style={{ top: `${((i + 1) / (spec.outs + 1)) * 100}%` }}
        />
      ))}
      <Handle
        id="under-in"
        type="target"
        position={Position.Bottom}
        style={HANDLE_OFF}
      />
      <Handle
        id="under-out"
        type="source"
        position={Position.Bottom}
        style={HANDLE_ON}
      />
      <Handle
        id="over-in"
        type="target"
        position={Position.Top}
        style={HANDLE_OFF}
      />
      <Handle
        id="over-out"
        type="source"
        position={Position.Top}
        style={HANDLE_ON}
      />
      {spec.label}
    </>
  );
}

const NODE_TYPES: NodeTypes = { machine: MachineNode };

interface EdgeData extends Record<string, unknown> {
  route: EdgeRoute;
  lane: number;
  text: string;
  top: number;
  bottom: number;
}

/**
 * Custom edge that draws the routed polyline from `routePoints` and anchors
 * its label to the route's own longest segment via `labelAnchor`. The label
 * goes through `BaseEdge`, not `EdgeLabelRenderer`, so it stays inside the
 * edge's `<g>` and the existing `.pgf-edge-live .react-flow__edge-text`
 * accent rule keeps applying with no new CSS plumbing.
 */
function MachineEdge(
  { data, markerEnd, sourceX, sourceY, targetX, targetY }: EdgeProps,
) {
  const spec = data as unknown as EdgeData;
  const points = routePoints(
    spec.route,
    spec.lane,
    sourceX,
    sourceY,
    targetX,
    targetY,
    spec.top,
    spec.bottom,
  );
  const anchor = labelAnchor(
    points,
    spec.lane,
    spec.route === "direct" ? LABEL_AT : 0.5,
  );
  return (
    <BaseEdge
      path={roundedPath(points, CORNER)}
      markerEnd={markerEnd}
      label={spec.text}
      labelX={anchor.x}
      labelY={anchor.y}
      labelShowBg
      labelBgPadding={[5, 3]}
      labelBgBorderRadius={3}
      interactionWidth={0}
    />
  );
}

const EDGE_TYPES: EdgeTypes = { machine: MachineEdge };

function ensureBaseCss(): void {
  if (document.querySelector("link[data-pgf-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = BASE_CSS;
  link.setAttribute("data-pgf-css", "");
  // Prepended, not appended: React Flow's base.css is foundational, and if it
  // landed after the site stylesheet it would win every equal-specificity tie
  // and undo the palette-driven node and edge styling.
  document.head.insertBefore(link, document.head.firstChild);
}

/** Everything that makes the canvas an illustration rather than an editor. */
const INERT = {
  nodesDraggable: false,
  nodesConnectable: false,
  nodesFocusable: false,
  edgesFocusable: false,
  edgesReconnectable: false,
  elementsSelectable: false,
  panOnDrag: false,
  panOnScroll: false,
  zoomOnScroll: false,
  zoomOnPinch: false,
  zoomOnDoubleClick: false,
  preventScrolling: false,
  autoPanOnNodeDrag: false,
  disableKeyboardA11y: true,
} as const;

interface MachineFlowProps {
  machine: AnyStateMachine;
  actor: FlowSource;
  maxHeight: number;
  onHeight: (px: number) => void;
}

function MachineFlow(
  { machine, actor, maxHeight, onHeight }: MachineFlowProps,
) {
  const graph = useMemo(() => machineToFlow(machine), [machine]);
  const [active, setActive] = useState<Set<string>>(() =>
    activeKeys(actor.getSnapshot().value)
  );
  // The edge most recently traversed, flashed to show which path was taken.
  const [taken, setTaken] = useState<string | null>(null);
  const previous = useRef<Set<string>>(active);
  useEffect(() => {
    const subscription = actor.subscribe((snapshot: { value: unknown }) => {
      const next = activeKeys(snapshot.value);
      const from = previous.current;
      const edge = graph.edges.find((candidate: FlowEdgeSpec) =>
        from.has(candidate.source) && next.has(candidate.target) &&
        !from.has(candidate.target)
      );
      previous.current = next;
      setActive(next);
      if (edge) setTaken(edge.id);
    });
    return () => subscription.unsubscribe();
  }, [actor, graph]);

  // Re-arm the flash so re-traversing the same edge animates again.
  useEffect(() => {
    if (!taken) return;
    const timer = setTimeout(() => setTaken(null), 600);
    return () => clearTimeout(timer);
  }, [taken]);

  // The provider is required because `Diagram` calls React Flow store hooks
  // while also rendering `<ReactFlow>`.
  return (
    <ReactFlowProvider>
      <Diagram
        graph={graph}
        active={active}
        taken={taken}
        maxHeight={maxHeight}
        onHeight={onHeight}
      />
    </ReactFlowProvider>
  );
}

interface DiagramProps {
  graph: FlowGraph;
  active: Set<string>;
  taken: string | null;
  maxHeight: number;
  onHeight: (px: number) => void;
}

function Diagram(
  { graph, active, taken, maxHeight, onHeight }: DiagramProps,
) {
  const { fitBounds } = useReactFlow();
  // Measure our own container rather than reading React Flow's store: the pane
  // dimensions are what the fit depends on, and a ResizeObserver on the element
  // we render into survives both a resized container and library internals.
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneW, setPaneW] = useState(0);
  const [paneH, setPaneH] = useState(0);
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const measure = () => {
      // Identical values bail out of React's update, so the height we ask for
      // below cannot feed back into a resize loop.
      setPaneW(el.clientWidth);
      setPaneH(el.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The node bounding box, measured from the DOM. `useNodesInitialized` never
  // reports ready for these nodes, so waiting on it left the fit below dead and
  // silently handed the viewport to a nodes-only `fitView`. Layout sizes are
  // immune to the viewport transform, so `offsetWidth` is already flow-space.
  //
  // Each node is observed rather than measured once: React Flow's base.css is
  // fetched at runtime, and until it lands a node is an unstyled block as wide as
  // the canvas, which would fix the fit to a bounding box several times too wide.
  // Observing also covers a webfont arriving late and re-flowing the labels.
  const [box, setBox] = useState<Rect | null>(null);
  useEffect(() => {
    const root = paneRef.current;
    if (!root) return;
    let frame = 0;
    const observer = new ResizeObserver(() => measure());
    const measure = () => {
      const measured: HTMLElement[] = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const node of graph.nodes) {
        const el = root.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
        );
        // Nodes mount a frame or two after the canvas; retry until all of them
        // have a laid-out box, so the fit is computed from real sizes.
        if (!el?.offsetWidth) {
          frame = requestAnimationFrame(measure);
          return;
        }
        measured.push(el);
        x0 = Math.min(x0, node.position.x);
        y0 = Math.min(y0, node.position.y);
        x1 = Math.max(x1, node.position.x + el.offsetWidth);
        y1 = Math.max(y1, node.position.y + el.offsetHeight);
      }
      // Observing an element twice is a no-op, so this just picks up nodes that
      // only existed from this pass onward.
      for (const el of measured) observer.observe(el);
      setBox((previous) =>
        previous && previous.x === x0 && previous.y === y0 &&
          previous.width === x1 - x0 && previous.height === y1 - y0
          // Same numbers: keep the old object so the fit below does not re-run.
          ? previous
          : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
      );
    };
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [graph]);

  const ys = graph.nodes.map((n) => n.position.y);
  const top = box ? box.y : Math.min(...ys, 0);
  const bottom = box ? box.y + box.height : Math.max(...ys, 0) + NODE_H;

  // Everything the diagram must show: the measured node box grown by both
  // corridor planes. `fitView` would only ever see the nodes, so a return
  // transition routed underneath them would be cropped away.
  const rect = useMemo<Rect | null>(
    () =>
      box
        ? {
          x: box.x - FIT_MARGIN,
          y: box.y - graph.over - FIT_MARGIN,
          width: box.width + FIT_MARGIN * 2,
          height: box.height + graph.over + graph.under + FIT_MARGIN * 2,
        }
        : null,
    [box, graph],
  );

  // Every edge agrees on one corridor plane derived from the global node
  // bounding box, because a return transition passes under intermediate
  // nodes, not just its two endpoints.
  const nodes = useMemo(
    () =>
      graph.nodes.map((node: FlowNodeSpec) => ({
        id: node.id,
        type: "machine",
        position: node.position,
        data: { label: node.label, ins: node.ins, outs: node.outs },
        className: [
          "pgf-node",
          `pgf-${node.kind}`,
          node.isInitial ? "pgf-initial" : "",
          active.has(node.id) ? "pgf-active" : "",
        ].filter(Boolean).join(" "),
      })),
    [graph, active],
  );

  const edges = useMemo(
    () =>
      graph.edges.map((edge: FlowEdgeSpec) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.route === "direct"
          ? `out-${edge.sourceSlot}`
          : edge.route === "over"
          ? "over-out"
          : "under-out",
        targetHandle: edge.route === "direct"
          ? `in-${edge.targetSlot}`
          : edge.route === "over"
          ? "over-in"
          : "under-in",
        type: "machine",
        data: {
          route: edge.route,
          lane: edge.lane,
          text: edge.label,
          top,
          bottom,
        },
        // Marching ants on the transitions currently available to the reader.
        animated: active.has(edge.source),
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        className: [
          "pgf-edge",
          active.has(edge.source) ? "pgf-edge-live" : "",
          edge.id === taken ? "pgf-edge-taken" : "",
        ].filter(Boolean).join(" "),
      })),
    [graph, active, taken, top, bottom],
  );

  // Auto height: the canvas asks for exactly the height this graph needs at the
  // zoom that fits its width, so no corridor is ever cropped and no snippet has
  // to guess a number. A graph too tall for `maxHeight` scales down instead.
  //
  // The arithmetic deliberately mirrors what `fitBounds` does below, `FIT_PAD`
  // included: give it a height derived by a different formula and it fits on the
  // other axis instead, shrinking the diagram and leaving slack we just paid for.
  useEffect(() => {
    if (!rect || !paneW) return;
    const zoom = Math.min(paneW / (rect.width * (1 + FIT_PAD)), MAX_ZOOM);
    const needed = Math.round(rect.height * (1 + FIT_PAD) * zoom);
    onHeight(Math.min(Math.max(needed, MIN_H), maxHeight));
  }, [rect, paneW, maxHeight, onHeight]);

  // Refit once the pane has actually taken the height asked for above, since
  // the fit depends on both of the pane's dimensions.
  useEffect(() => {
    if (!rect || !paneW || !paneH) return;
    void fitBounds(rect, { padding: FIT_PAD });
  }, [rect, paneW, paneH, fitBounds]);

  return (
    // React Flow does not hand back its own container element, so the diagram
    // owns a wrapper purely to have something measurable to observe.
    <div ref={paneRef} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
        {...INERT}
      />
    </div>
  );
}

/**
 * The slice of an actor the diagram consumes: a current value and a change feed.
 * XState's `AnyActorRef` satisfies it structurally, and so does anything else that
 * knows which state it is in -- including a runtime that owns its own event loop.
 */
export interface FlowSource {
  getSnapshot(): { value: unknown };
  subscribe(
    next: (snapshot: { value: unknown }) => void,
  ): { unsubscribe(): void };
  start?(): void;
  stop?(): void;
}

/**
 * A `FlowSource` you push values into, for runtimes that drive transitions
 * themselves. `set` is a no-op re-render when the value is unchanged.
 */
export function createFlowSource(
  initial: unknown,
): FlowSource & { set(value: unknown): void } {
  const listeners = new Set<(snapshot: { value: unknown }) => void>();
  let current = initial;
  return {
    getSnapshot: () => ({ value: current }),
    subscribe(next) {
      listeners.add(next);
      return { unsubscribe: () => listeners.delete(next) };
    },
    set(value) {
      current = value;
      for (const listener of listeners) listener({ value });
    },
  };
}

export interface RenderOptions {
  machine: AnyStateMachine;
  actor: FlowSource;
  /** Start the actor so the initial state paints immediately. Default true. */
  autoStart?: boolean;
  /**
   * Ceiling for the canvas height in CSS pixels. The canvas sizes itself to the
   * diagram, so this only bites when a machine is big enough that showing it at
   * full size would dominate the page -- then the whole diagram scales down to
   * fit rather than being cropped. Default 420.
   */
  maxHeight?: number;
}

/**
 * Mount a live machine diagram into `target`. Returns the cleanup function the
 * playground contract expects, which unmounts React and stops the actor if we
 * were the one that started it.
 */
export function renderMachineFlow(
  target: HTMLElement,
  { machine, actor, autoStart = true, maxHeight = 420 }: RenderOptions,
): () => void {
  ensureBaseCss();

  const mount = document.createElement("div");
  mount.className = "pgf-canvas";
  // A neutral starting height: `Diagram` measures the graph and calls back with
  // the real one, which keeps the initial reflow to a few pixels either way.
  mount.style.height = `${Math.min(240, maxHeight)}px`;
  // Prepended so the diagram sits above whatever controls the embed supplied.
  target.insertBefore(mount, target.firstChild);

  const credit = document.createElement("p");
  credit.className = "pgf-credit not-prose";
  const link = document.createElement("a");
  link.href = "https://reactflow.dev?utm_source=attribution";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "React Flow attribution");
  link.textContent = "React Flow";
  credit.appendChild(link);
  target.appendChild(credit);

  const root = createRoot(mount);
  root.render(
    <MachineFlow
      machine={machine}
      actor={actor}
      maxHeight={maxHeight}
      onHeight={(px) => {
        mount.style.height = `${px}px`;
      }}
    />,
  );
  let started = false;
  // XState v5 snapshots carry status "active" even before the actor is started,
  // so we cannot use that to skip start(). Calling start() is idempotent on a
  // running actor, so we just call it unconditionally.
  if (autoStart && actor.start) {
    actor.start();
    started = true;
  }

  return () => {
    root.unmount();
    mount.remove();
    credit.remove();
    if (started) actor.stop?.();
  };
}
