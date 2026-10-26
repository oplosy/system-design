import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Design } from '../core/schema.ts';
import { BOUNDARY_PAD, EMPTY_BOUNDARY } from './boundaries.ts';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

const elk = new ELK();
const ROOT = '__root';

export const LAYOUTS = [
  { key: 'layered', title: 'Layered', desc: 'Top to bottom in the order things call each other' },
  { key: 'tiers', title: 'Tiers', desc: 'Rows by kind: clients, edge, network, compute, data…' },
  { key: 'flow', title: 'Flow', desc: 'Left to right with right-angled lines, for pipelines' },
  { key: 'tree', title: 'Tree', desc: 'A tree from the root down: network topologies, hierarchies' },
  { key: 'radial', title: 'Radial', desc: 'Rings around a hub such as a gateway or event bus' },
  { key: 'organic', title: 'Organic', desc: 'Spreads a mesh out evenly by its links' },
  { key: 'grid', title: 'Grid', desc: 'A compact grid that ignores the links' },
] as const;
export type LayoutKind = (typeof LAYOUTS)[number]['key'];

/** Row of each palette group in the Tiers layout: who calls first sits on top, storage and ops further down. */
const TIER: Record<string, number> = {
  client: 0,
  'net-wan': 0,
  edge: 1,
  network: 2,
  'net-core': 2,
  compute: 3,
  messaging: 4,
  'net-device': 4,
  data: 5,
  analytics: 6,
  'net-infra': 6,
  ops: 7,
  external: 7,
};

const SPACING = { 'elk.spacing.nodeNode': '50' };

function rootOptions(kind: LayoutKind): Record<string, string> {
  const layered = {
    ...SPACING,
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '70',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  };
  switch (kind) {
    case 'layered':
      return layered;
    case 'tiers':
      return { ...layered, 'elk.partitioning.activate': 'true' };
    case 'flow':
      return { ...layered, 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.layered.spacing.nodeNodeBetweenLayers': '90' };
    case 'tree':
      return { ...SPACING, 'elk.algorithm': 'mrtree', 'elk.direction': 'DOWN', 'elk.mrtree.weighting': 'CONSTRAINT' };
    case 'radial':
      return { 'elk.algorithm': 'radial', 'elk.spacing.nodeNode': '90' };
    case 'organic':
      return { ...SPACING, 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': '220' };
    case 'grid':
      return { 'elk.algorithm': 'rectpacking', 'elk.spacing.nodeNode': '40' };
  }
}

/** Options for boundary boxes; algorithms other than layered lay each box out on its own. */
const boxOptions = (kind: LayoutKind, padding: string): Record<string, string> =>
  kind === 'layered' || kind === 'tiers' || kind === 'flow' ? { 'elk.padding': padding } : { ...rootOptions(kind), 'elk.padding': padding };

type Pos = { x: number; y: number };

/**
 * Lays out every canvas item; notes and decisions sit next to what they point at, and boundaries are nested
 * boxes so their members stay together. Returns absolute top-left positions.
 *
 * With `only`, just those items move: they are laid out among themselves (boundaries ignored) and the result
 * keeps the top-left corner the selection had, given its current positions in `at`.
 */
export async function layout(d: Design, kind: LayoutKind = 'layered', only?: { ids: Set<string>; at: Map<string, Pos> }) {
  const inScope = (id: string) => !only || only.ids.has(id);
  const boundaryIds = new Set(only ? [] : d.boundaries.map((b) => b.id));
  const containerOf = new Map<string, string>();
  for (const c of d.components) containerOf.set(c.id, c.boundary && boundaryIds.has(c.boundary) ? c.boundary : ROOT);
  for (const b of d.boundaries) if (boundaryIds.has(b.id)) containerOf.set(b.id, b.parent && boundaryIds.has(b.parent) ? b.parent : ROOT);

  // Tiers: a component's row comes from its group; notes and decisions follow what they explain; boxes take their top member's row.
  const tier = new Map<string, number>();
  for (const c of d.components) tier.set(c.id, TIER[SHAPES[c.type].group] ?? 3);
  for (const n of d.notes) tier.set(n.id, (n.attachTo ? tier.get(n.attachTo) : undefined) ?? 3);
  for (const x of d.decisions) tier.set(x.id, Math.min(...x.links.map((l) => tier.get(l) ?? 3), 7));
  const boxTier = (id: string): number =>
    Math.min(...d.components.filter((c) => c.boundary === id).map((c) => tier.get(c.id)!), ...d.boundaries.filter((b) => b.parent === id).map((b) => boxTier(b.id)), 7);
  const partition = (id: string) => (kind === 'tiers' ? { 'elk.partitioning.partition': String(boundaryIds.has(id) ? boxTier(id) : tier.get(id)) } : undefined);

  const padding = `[top=${BOUNDARY_PAD.top},left=${BOUNDARY_PAD.side},bottom=${BOUNDARY_PAD.bottom},right=${BOUNDARY_PAD.side}]`;
  const nodes = new Map<string, ElkNode>([[ROOT, { id: ROOT, children: [], edges: [] }]]);
  for (const id of boundaryIds) nodes.set(id, { id, layoutOptions: { ...boxOptions(kind, padding), ...partition(id) }, children: [], edges: [] });
  const leaves: ElkNode[] = [
    ...d.components.map((c) => ({ id: c.id, width: SHAPES[c.type].w, height: SHAPES[c.type].h })),
    ...d.notes.map((n) => ({ id: n.id, width: NOTE_SIZE.w, height: NOTE_SIZE.h })),
    ...d.decisions.map((x) => ({ id: x.id, width: DECISION_SIZE.w, height: DECISION_SIZE.h })),
  ]
    .filter((n) => inScope(n.id))
    .map((n) => ({ ...n, layoutOptions: partition(n.id) }));
  for (const n of [...leaves, ...[...boundaryIds].map((id) => nodes.get(id)!)]) nodes.get(containerOf.get(n.id) ?? ROOT)!.children!.push(n);
  for (const id of boundaryIds) {
    const n = nodes.get(id)!;
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
  const flat = kind !== 'layered' && kind !== 'tiers' && kind !== 'flow';
  const seen = new Set<string>();
  const addEdge = (e: ElkExtendedEdge) => {
    const [from, to] = [e.sources[0], e.targets[0]];
    if (!inScope(from) || !inScope(to) || from === to) return;
    const common = chain(from).find((c) => new Set(chain(to)).has(c))!;
    // Tree, radial, organic and grid lay each box out alone, so they only see edges inside one box, once per pair.
    if (flat && (containerOf.get(from) !== common || containerOf.get(to) !== common)) return;
    const pair = [from, to].sort().join('>');
    if (flat && seen.has(pair)) return;
    seen.add(pair);
    nodes.get(common)!.edges!.push(e);
  };
  for (const c of d.connections) addEdge({ id: c.id, sources: [c.from], targets: [c.to] });
  for (const n of d.notes) if (n.attachTo) addEdge({ id: `link-${n.id}`, sources: [n.attachTo], targets: [n.id] });
  for (const x of d.decisions) for (const l of x.links) addEdge({ id: `link-${x.id}-${l}`, sources: [l], targets: [x.id] });

  // Radial needs a single tree: a cycle sends ELK into endless recursion, and it drops what its root cannot reach.
  // So hand it a breadth-first tree from the best-connected item, with loose pieces hung off that hub.
  if (kind === 'radial') {
    for (const n of nodes.values()) {
      const kids = n.children!.map((c) => c.id);
      if (kids.length < 2) continue;
      const near = new Map(kids.map((k) => [k, new Set<string>()]));
      for (const e of n.edges!) near.get(e.sources[0])?.add(e.targets[0]), near.get(e.targets[0])?.add(e.sources[0]);
      const hub = kids.reduce((a, b) => (near.get(b)!.size > near.get(a)!.size ? b : a));
      const tree: ElkExtendedEdge[] = [];
      const reached = new Set([hub]);
      const grow = (from: string) => {
        for (const queue = [from]; queue.length; ) {
          const k = queue.shift()!;
          for (const next of near.get(k)!) {
            if (reached.has(next)) continue;
            reached.add(next);
            tree.push({ id: `tree-${k}-${next}`, sources: [k], targets: [next] });
            queue.push(next);
          }
        }
      };
      grow(hub);
      for (const k of kids) {
        if (reached.has(k)) continue;
        reached.add(k);
        tree.push({ id: `tree-${hub}-${k}`, sources: [hub], targets: [k] });
        grow(k);
      }
      n.edges = tree;
    }
  }

  let graph = await elk.layout({ ...nodes.get(ROOT)!, layoutOptions: rootOptions(kind) });
  // Radial sizes its rings by node count, not node size, so wide shapes can touch; push them apart afterwards.
  if (kind === 'radial') graph = await elk.layout({ ...graph, layoutOptions: { 'elk.algorithm': 'sporeOverlap', 'elk.spacing.nodeNode': '30' } });

  const pos = new Map<string, Pos>();
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
      pos.set(c.id, { x: Math.round(x), y: Math.round(y) });
      walk(c, x, y);
    }
  };
  walk(graph, 0, 0);

  if (only) {
    const corner = (ps: Pos[]) => ({ x: Math.min(...ps.map((p) => p.x)), y: Math.min(...ps.map((p) => p.y)) });
    const was = corner([...only.ids].map((id) => only.at.get(id)).filter((p): p is Pos => !!p));
    const now = corner([...pos.values()]);
    if (Number.isFinite(was.x)) for (const p of pos.values()) Object.assign(p, { x: p.x - now.x + was.x, y: p.y - now.y + was.y });
  }
  return pos;
}
