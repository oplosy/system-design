import { createContext, memo, useContext, useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps } from '@xyflow/react';
import type { PathInfo } from 'roughjs/bin/core';
import type { BoundaryKind, ComponentType } from '../core/schema.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { DECISION_SIZE, NOTE_COLOR, NOTE_SIZE, SHAPES, drawShape, gen, hash, options, toPaths } from './shapes.ts';

export const SketchContext = createContext(true);

type Common = { unseen: boolean; faded: boolean };
export type ComponentNode = Node<Common & { type: ComponentType; label: string; tech?: string }, 'component'>;
export type NoteNode = Node<Common & { text: string }, 'note'>;
export type DecisionNode = Node<Common & { title: string; why: string }, 'decision'>;
export type BoundaryNode = Node<Common & { kind: BoundaryKind; label: string; detail?: string; w: number; h: number }, 'boundary'>;
export type FlowEdge = Edge<{ kind: 'flow' | 'link'; label?: string; async?: boolean; unseen: boolean; faded: boolean }, 'rough'>;

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
    <div className={`sd-node${data.faded ? ' faded' : ''}`} style={{ width: w, height: h }}>
      {children}
      {data.unseen && <span className="unseen-dot" title="Not reviewed yet" />}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const ComponentNodeView = memo(function ComponentNodeView({ id, data }: NodeProps<ComponentNode>) {
  const sketch = useContext(SketchContext);
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
      </div>
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
    <div className={`sd-boundary${data.faded ? ' faded' : ''}`} style={{ width: w, height: h, color: spec.color }}>
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
    </div>
  );
});

function box(n: InternalNode) {
  const { x, y } = n.internals.positionAbsolute;
  const w = n.measured.width ?? 0, h = n.measured.height ?? 0;
  return { x: x + w / 2, y: y + h / 2, w, h };
}

/** Where the line from a's center towards b leaves a's bounding box. */
function exit(a: ReturnType<typeof box>, b: ReturnType<typeof box>) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return a;
  const s = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: a.x + dx * s, y: a.y + dy * s };
}

/** Straight "floating" edge between node borders, drawn with rough.js. */
export function RoughEdge({ id, source, target, data, selected }: EdgeProps<FlowEdge>) {
  const sketch = useContext(SketchContext);
  const s = useInternalNode(source), t = useInternalNode(target);
  const geo = s && t ? (() => {
    const a = box(s), b = box(t);
    const p1 = exit(a, b), p2 = exit(b, a);
    return { p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y } };
  })() : null;
  const link = data?.kind === 'link';
  const key = geo ? `${geo.p1.x},${geo.p1.y},${geo.p2.x},${geo.p2.y}` : '';
  const paths = useMemo(() => {
    if (!geo) return [];
    const { p1, p2 } = geo;
    const o = options(sketch, undefined, hash(id), { strokeWidth: link ? 1.1 : selected ? 2.2 : 1.4, roughness: sketch ? 0.9 : 0 });
    const parts = [gen.line(p1.x, p1.y, p2.x, p2.y, o)];
    if (!link) {
      const a = Math.atan2(p2.y - p1.y, p2.x - p1.x), L = 11;
      for (const d of [0.42, -0.42]) parts.push(gen.line(p2.x, p2.y, p2.x - L * Math.cos(a + d), p2.y - L * Math.sin(a + d), o));
    }
    return toPaths(parts);
  }, [key, sketch, id, link, selected]);
  if (!geo) return null;
  const { p1, p2 } = geo;
  return (
    <>
      <BaseEdge id={id} path={`M${p1.x},${p1.y} L${p2.x},${p2.y}`} style={{ stroke: 'transparent' }} interactionWidth={18} />
      <g className={`rough-edge${data?.faded ? ' faded' : ''}${selected ? ' selected' : ''}`} style={{ color: link ? NOTE_COLOR : undefined }}>
        <Paths paths={paths} dashed={link || data?.async} />
      </g>
      {data?.label && (
        <EdgeLabelRenderer>
          <div className={`edge-label${data.faded ? ' faded' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${(p1.x + p2.x) / 2}px, ${(p1.y + p2.y) / 2}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const nodeTypes = { component: ComponentNodeView, note: NoteNodeView, decision: DecisionNodeView, boundary: BoundaryNodeView };
export const edgeTypes = { rough: RoughEdge };
