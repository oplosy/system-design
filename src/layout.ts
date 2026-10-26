import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Design } from '../core/schema.ts';
import { BOUNDARY_PAD, EMPTY_BOUNDARY } from './boundaries.ts';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

const elk = new ELK();
const ROOT = '__root';

/**
 * Top-down layered layout of every canvas item; notes and decisions sit next to what they point at.
 * Boundaries are laid out as nested boxes so their members stay together. Returns absolute top-left positions.
 */
export async function layout(d: Design) {
  const boundaryIds = new Set(d.boundaries.map((b) => b.id));
  const containerOf = new Map<string, string>();
  for (const c of d.components) containerOf.set(c.id, c.boundary && boundaryIds.has(c.boundary) ? c.boundary : ROOT);
  for (const b of d.boundaries) containerOf.set(b.id, b.parent && boundaryIds.has(b.parent) ? b.parent : ROOT);

  const padding = `[top=${BOUNDARY_PAD.top},left=${BOUNDARY_PAD.side},bottom=${BOUNDARY_PAD.bottom},right=${BOUNDARY_PAD.side}]`;
  const nodes = new Map<string, ElkNode>([[ROOT, { id: ROOT, children: [], edges: [] }]]);
  for (const b of d.boundaries) nodes.set(b.id, { id: b.id, layoutOptions: { 'elk.padding': padding }, children: [], edges: [] });
  const leaves: ElkNode[] = [
    ...d.components.map((c) => ({ id: c.id, width: SHAPES[c.type].w, height: SHAPES[c.type].h })),
    ...d.notes.map((n) => ({ id: n.id, width: NOTE_SIZE.w, height: NOTE_SIZE.h })),
    ...d.decisions.map((x) => ({ id: x.id, width: DECISION_SIZE.w, height: DECISION_SIZE.h })),
  ];
  for (const n of [...leaves, ...d.boundaries.map((b) => nodes.get(b.id)!)]) nodes.get(containerOf.get(n.id) ?? ROOT)!.children!.push(n);
  for (const b of d.boundaries) {
    const n = nodes.get(b.id)!;
    if (!n.children!.length) Object.assign(n, { width: EMPTY_BOUNDARY.w, height: EMPTY_BOUNDARY.h });
  }

  // ELK wants each edge in the lowest boundary that holds both ends.
  const chain = (id: string) => {
    const out = [];
    for (let c = containerOf.get(id) ?? ROOT; ; c = containerOf.get(c) ?? ROOT) {
      out.push(c);
      if (c === ROOT) return out;
    }
  };
  const addEdge = (e: ElkExtendedEdge) => {
    const up = new Set(chain(e.targets[0]));
    nodes.get(chain(e.sources[0]).find((c) => up.has(c))!)!.edges!.push(e);
  };
  for (const c of d.connections) addEdge({ id: c.id, sources: [c.from], targets: [c.to] });
  for (const n of d.notes) if (n.attachTo) addEdge({ id: `link-${n.id}`, sources: [n.attachTo], targets: [n.id] });
  for (const x of d.decisions) for (const l of x.links) addEdge({ id: `link-${x.id}-${l}`, sources: [l], targets: [x.id] });

  const graph = await elk.layout({
    ...nodes.get(ROOT)!,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
  });

  const pos = new Map<string, { x: number; y: number }>();
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
      pos.set(c.id, { x: Math.round(x), y: Math.round(y) });
      walk(c, x, y);
    }
  };
  walk(graph, 0, 0);
  return pos;
}
