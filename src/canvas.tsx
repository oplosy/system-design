import { createContext, memo, useContext, useMemo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, NodeToolbar, Position, useInternalNode, useNodeId, useReactFlow, type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps } from '@xyflow/react';
import type { PathInfo } from 'roughjs/bin/core';
import { dollars } from '../core/export.ts';
import type { BoundaryKind, ComponentType, ConnectionKind } from '../core/schema.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { edgeGeometry, type Pt, type Route } from './edges.ts';
import { DECISION_SIZE, NOTE_COLOR, NOTE_SIZE, SHAPES, drawShape, gen, hash, options, toPaths } from './shapes.ts';

export const SketchContext = createContext(true);
/** What edges and nodes need from the app: whether editing is allowed, how to save a bend, start a label edit, delete, or open a part's inner design. */
export const EdgeContext = createContext<{
  locked: boolean;
  onBend: (id: string, bend: number | undefined) => void;
  onEditLabel: (id: string, at: Pt) => void;
  onDelete: (id: string) => void;
  onOpen: (design: string, via: string) => void;
}>({
  locked: true,
  onBend: () => {},
  onEditLabel: () => {},
  onDelete: () => {},
  onOpen: () => {},
});

/** A delete button over the top-right corner, shown while this node is the only one selected. */
function Trash() {
  const { locked, onDelete } = useContext(EdgeContext);
  const id = useNodeId();
  if (locked || !id) return null;
  return (
    <NodeToolbar position={Position.Top} align="end" offset={6}>
      <button className="node-trash" onClick={() => onDelete(id)} title="Delete (Del)" aria-label="Delete">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" />
        </svg>
      </button>
    </NodeToolbar>
  );
}

/** added / changed / removed: how the step diff draws it; comments: open review comments on the item; issues: lint warnings. */
type Common = { unseen: boolean; faded: boolean; added?: boolean; changed?: boolean; removed?: boolean; comments?: number; issues?: string[] };
export type ComponentNode = Node<Common & { type: ComponentType; label: string; tech?: string; detail?: string; cost?: number }, 'component'>;
export type NoteNode = Node<Common & { text: string }, 'note'>;
export type DecisionNode = Node<Common & { title: string; why: string }, 'decision'>;
export type BoundaryNode = Node<Common & { kind: BoundaryKind; label: string; detail?: string; w: number; h: number }, 'boundary'>;
export type FlowEdge = Edge<{ kind: 'flow' | 'link'; label?: string; async?: boolean; relation?: ConnectionKind; route?: Route; bend?: number; qps?: number; latency?: number; unseen: boolean; faded: boolean; added?: boolean; hops?: number[]; hopOn?: boolean }, 'rough'>;

function Paths({ paths, dashed }: { paths: PathInfo[]; dashed?: boolean }) {
  return paths.map((p, i) => (
    <path
      key={i}
      d={p.d}
      style={{ stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill ?? 'none' }}
      strokeDasharray={dashed && p.stroke === 'currentColor' ? '7 5' : undefined}
      strokeLinecap="round"
    />
  ));
}

function Frame({ w, h, data, children }: { w: number; h: number; data: Common; children: React.ReactNode }) {
  return (
    <div className={`sd-node${data.faded ? ' faded' : ''}${data.added ? ' added' : ''}${data.changed ? ' changed' : ''}${data.removed ? ' removed' : ''}`} style={{ width: w, height: h }}>
      {children}
      {data.unseen && <span className="unseen-dot" title="Not reviewed yet" />}
      {!!data.comments && (
        <span className="comment-badge" title={`${data.comments} open comment${data.comments > 1 ? 's' : ''}`}>
          {data.comments}
        </span>
      )}
      {!!data.issues && (
        <span className="lint-badge" title={data.issues.join('\n')} aria-label={`Warning: ${data.issues.join(' ')}`}>
          !
        </span>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Trash />
    </div>
  );
}

export const ComponentNodeView = memo(function ComponentNodeView({ id, data }: NodeProps<ComponentNode>) {
  const sketch = useContext(SketchContext);
  const { onOpen } = useContext(EdgeContext);
  const spec = SHAPES[data.type];
  const paths = useMemo(() => drawShape(data.type, sketch, hash(id)), [data.type, sketch, id]);
  return (
    <Frame w={spec.w} h={spec.h} data={data}>
      <svg width={spec.w} height={spec.h} overflow="visible">
        <Paths paths={paths} dashed={spec.dashed} />
      </svg>
      <div className="node-label" style={{ left: spec.labelX ?? spec.w / 2, top: spec.labelY, maxWidth: spec.w + 30 }}>
        <div>{data.label}</div>
        {data.tech && <div className="node-tech">{data.tech}</div>}
        {data.cost !== undefined && <div className="node-tech">{dollars(data.cost)}/mo</div>}
      </div>
      {data.detail && (
        <button className="node-open nodrag" onClick={() => onOpen(data.detail!, data.label)} title="Open what is inside" aria-label={`Open the inside of ${data.label}`}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7.5 8.5" />
          </svg>
        </button>
      )}
    </Frame>
  );
});

export const NoteNodeView = memo(function NoteNodeView({ id, data }: NodeProps<NoteNode>) {
  const sketch = useContext(SketchContext);
  const { w, h } = NOTE_SIZE;
  const paths = useMemo(
    () => toPaths([gen.rectangle(2, 2, w - 4, h - 4, options(sketch, undefined, hash(id), { fill: sketch ? NOTE_COLOR : '#FAC775', fillStyle: 'solid', stroke: sketch ? NOTE_COLOR : 'none', roughness: sketch ? 1.8 : 0 }))]),
    [sketch, id, w, h],
  );
  return (
    <Frame w={w} h={h} data={data}>
      <svg width={w} height={h} overflow="visible">
        <Paths paths={paths} />
      </svg>
      <div className="note-text">{data.text}</div>
    </Frame>
  );
});

export const DecisionNodeView = memo(function DecisionNodeView({ id, data }: NodeProps<DecisionNode>) {
  const sketch = useContext(SketchContext);
  const { w, h } = DECISION_SIZE;
  const body = h - 16;
  const outline = `M2 2 H${w - 2} V${body} H52 L34 ${h - 2} L36 ${body} H2 Z`;
  const paths = useMemo(() => toPaths([gen.path(outline, options(sketch, undefined, hash(id), { stroke: NOTE_COLOR, strokeWidth: 1.6 }))]), [sketch, id, outline]);
  return (
    <Frame w={w} h={h} data={data}>
      <svg width={w} height={h} overflow="visible">
        <path d={outline} style={{ fill: 'var(--panel)', stroke: 'none' }} />
        <Paths paths={paths} dashed />
      </svg>
      <div className="decision-text" style={{ height: body - 4 }}>
        <div className="decision-kicker">Decision</div>
        <div className="decision-title">{data.title}</div>
        <div className="decision-why">{data.why}</div>
      </div>
    </Frame>
  );
});

/** A box around a group of components. Only its label tab takes the pointer, so the parts inside stay clickable. */
export const BoundaryNodeView = memo(function BoundaryNodeView({ id, data }: NodeProps<BoundaryNode>) {
  const sketch = useContext(SketchContext);
  const spec = BOUNDARY_SPECS[data.kind];
  const { w, h } = data;
  const paths = useMemo(
    () => toPaths([gen.rectangle(1, 1, w - 2, h - 2, options(sketch, undefined, hash(id), { stroke: spec.color, strokeWidth: spec.strokeWidth, roughness: sketch ? 0.8 : 0 }))]),
    [sketch, id, w, h, spec],
  );
  // Narrow boxes drop the kind word (the line style still shows it) so the label stays readable.
  const roomy = w > 7.5 * (spec.name.length + data.label.length + (data.detail?.length ?? 0)) + 70;
  return (
    <div className={`sd-boundary${data.faded ? ' faded' : ''}${data.added ? ' added' : ''}${data.changed ? ' changed' : ''}`} style={{ width: w, height: h, color: spec.color }}>
      <svg width={w} height={h} overflow="visible">
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={sketch ? 0 : 6} style={{ fill: spec.color, fillOpacity: 0.05, stroke: 'none' }} />
        {paths.map((p, i) => (
          <path key={i} d={p.d} style={{ stroke: p.stroke, strokeWidth: p.strokeWidth, fill: 'none' }} strokeDasharray={spec.dash} strokeLinecap="round" />
        ))}
      </svg>
      <div className="boundary-tab" title={`${spec.name}: drag to move everything inside`}>
        {roomy && <span className="boundary-kind">{spec.name}</span>}
        <span className="boundary-label">{data.label}</span>
        {data.detail && <span className="boundary-detail">{data.detail}</span>}
        {data.unseen && <span className="unseen-dot inline" title="Not reviewed yet" />}
      </div>
      <Trash />
    </div>
  );
});

/** 1500 → 1.5k, 2000000 → 2M: load reads at a glance on a line. */
export function rate(n: number) {
  for (const [v, s] of [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']] as const) if (n >= v) return `${+(n / v).toFixed(1)}${s}`;
  return String(n);
}

function box(n: InternalNode) {
  const { x, y } = n.internals.positionAbsolute;
  const w = n.measured.width ?? 0, h = n.measured.height ?? 0;
  return { x: x + w / 2, y: y + h / 2, w, h };
}

/**
 * Excalidraw-style "floating" edge between node borders, drawn with rough.js.
 * When selected, its middle (or its label) can be dragged to bend it; double-click edits the label.
 */
export function RoughEdge({ id, source, target, data, selected }: EdgeProps<FlowEdge>) {
  const sketch = useContext(SketchContext);
  const { locked, onBend, onEditLabel } = useContext(EdgeContext);
  const { screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<number | null>(null);
  const s = useInternalNode(source), t = useInternalNode(target);
  const link = data?.kind === 'link';
  const rel = link ? undefined : data?.relation;
  const dashed = link || data?.async || rel === 'implementation' || rel === 'include' || rel === 'extend';
  const geo = s && t ? edgeGeometry(box(s), box(t), link ? 'curve' : data?.route, drag ?? data?.bend) : null;
  // The line and its ends are drawn apart so a dashed line keeps solid arrowheads and diamonds.
  const [line, ends] = useMemo(() => {
    if (!geo) return [[], []];
    const o = options(sketch, undefined, hash(id), { strokeWidth: link ? 1.1 : selected || data?.hopOn ? 2.2 : 1.4, roughness: sketch ? 1 : 0 });
    const hollow = { ...o, fill: 'var(--canvas)', fillStyle: 'solid' }, solid = { ...o, fill: 'currentColor', fillStyle: 'solid' };
    const at = (p: Pt, a: number, back: number, side = 0): [number, number] => [p.x - back * Math.cos(a) - side * Math.sin(a), p.y - back * Math.sin(a) + side * Math.cos(a)];
    const parts = [geo.points ? gen.linearPath(geo.points.map((p): [number, number] => [p.x, p.y]), o) : gen.path(geo.d, o)];
    const heads = [];
    const { tip, angle, tail, tailAngle } = geo;
    if (rel === 'inheritance' || rel === 'implementation') heads.push(gen.polygon([[tip.x, tip.y], at(tip, angle, 15, 8), at(tip, angle, 15, -8)], hollow));
    else if (rel === 'composition' || rel === 'aggregation')
      heads.push(gen.polygon([[tail.x, tail.y], at(tail, tailAngle, 10, 6), at(tail, tailAngle, 20), at(tail, tailAngle, 10, -6)], rel === 'composition' ? solid : hollow));
    else if (!link) for (const side of [5.5, -5.5]) heads.push(gen.linearPath([[tip.x, tip.y], at(tip, angle, 11, side)], o));
    return [toPaths(parts), toPaths(heads)];
  }, [geo?.d, sketch, id, link, rel, selected, data?.hopOn]);
  const named = data?.label ?? (rel === 'include' || rel === 'extend' ? `«${rel}»` : undefined);
  const load = [data?.latency !== undefined && `${data.latency} ms`, data?.qps !== undefined && `${rate(data.qps)}/s`].filter(Boolean).join(' · ');
  const label = named || load ? (
    <>
      {named}
      {load && <span className="edge-meta">{load}</span>}
    </>
  ) : undefined;
  if (!geo) return null;
  const handle = !!selected && !locked && !link && geo.bendable;
  const startBend = (e: React.PointerEvent<HTMLElement>) => {
    if (!handle || e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last: number | null = null;
    const move = (ev: PointerEvent) => setDrag((last = Math.round(geo.bendAt(screenToFlowPosition({ x: ev.clientX, y: ev.clientY })))));
    el.addEventListener('pointermove', move);
    el.addEventListener(
      'pointerup',
      () => {
        el.removeEventListener('pointermove', move);
        if (last !== null) onBend(id, last);
        setDrag(null);
      },
      { once: true },
    );
  };
  const at = `translate(-50%, -50%) translate(${geo.mid.x}px, ${geo.mid.y}px)`;
  return (
    <>
      <BaseEdge id={id} path={geo.d} style={{ stroke: 'transparent' }} interactionWidth={18} />
      <g className={`rough-edge${data?.faded ? ' faded' : ''}${selected ? ' selected' : ''}${data?.hops ? ' on-path' : ''}${data?.hopOn ? ' hop-on' : ''}`} style={{ color: link ? NOTE_COLOR : undefined }}>
        <Paths paths={line} dashed={dashed} />
        <Paths paths={ends} />
      </g>
      {data?.hops && (
        <EdgeLabelRenderer>
          <div className={`hop-badge${data.hopOn ? ' on' : ''}`} style={{ transform: `${at} translateY(${label ? -22 : 0}px)` }}>
            {data.hops.join(' · ')}
          </div>
        </EdgeLabelRenderer>
      )}
      {(label || handle) && (
        <EdgeLabelRenderer>
          {label ? (
            <div
              className={`edge-label${data?.faded ? ' faded' : ''}${handle ? ' nodrag nopan grab' : ''}`}
              style={{ transform: at }}
              title={handle ? 'Drag to bend · double-click to edit' : undefined}
              onPointerDown={startBend}
              onDoubleClick={() => onEditLabel(id, geo.mid)}
            >
              {label}
            </div>
          ) : (
            <div
              className="bend-handle nodrag nopan"
              style={{ transform: at }}
              title="Drag to bend · double-click to add a label"
              onPointerDown={startBend}
              onDoubleClick={() => onEditLabel(id, geo.mid)}
            />
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const nodeTypes = { component: ComponentNodeView, note: NoteNodeView, decision: DecisionNodeView, boundary: BoundaryNodeView };
export const edgeTypes = { rough: RoughEdge };
