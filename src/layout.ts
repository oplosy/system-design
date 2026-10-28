import type ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Design } from '../core/schema.ts';
import { BOUNDARY_PAD, EMPTY_BOUNDARY, boundaryBoxes } from './boundaries.ts';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

// ELK is most of the app's code; it loads on the first layout instead of with the page.
let elk: Promise<InstanceType<typeof ELK>> | undefined;
const engine = () => (elk ??= import('elkjs/lib/elk.bundled.js').then((x) => new x.default()));
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
 * With `only`, just those items are laid out: among themselves (boundaries ignored), keeping the top-left corner
 * the selection had. `at` holds the current positions of every item; ones the result would cover are pushed aside
 * and returned too.
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

  const e = await engine();
  let graph = await e.layout({ ...nodes.get(ROOT)!, layoutOptions: rootOptions(kind) });
  // Radial sizes its rings by node count, not node size, so wide shapes can touch; push them apart afterwards.
  if (kind === 'radial') graph = await e.layout({ ...graph, layoutOptions: { 'elk.algorithm': 'sporeOverlap', 'elk.spacing.nodeNode': '30' } });

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
    const size = new Map<string, { w: number; h: number }>([
      ...d.components.map((c) => [c.id, SHAPES[c.type]] as const),
      ...d.notes.map((n) => [n.id, NOTE_SIZE] as const),
      ...d.decisions.map((x) => [x.id, DECISION_SIZE] as const),
    ]);
    const rect = (id: string, p: Pos) => ({ x: p.x, y: p.y, right: p.x + size.get(id)!.w, bottom: p.y + size.get(id)!.h });
    const bounds = (ps: [string, Pos][]) => {
      const rs = ps.map(([id, p]) => rect(id, p));
      return { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    };
    const was = bounds([...only.at].filter(([id]) => only.ids.has(id)));
    if (Number.isFinite(was.x)) {
      const now = bounds([...pos]);
      for (const p of pos.values()) Object.assign(p, { x: p.x - now.x + was.x, y: p.y - now.y + was.y });
      pushAside(was, bounds([...pos]));
    }

    // Items the new arrangement lands on make room: everything right of the old selection shifts right and
    // everything below it shifts down by what the selection grew, like inserting a column and a row.
    // Items that sat in the gaps of the old selection go down with the row, below the new one.
    function pushAside(was: Box, after: Box) {
      const hit = (r: Box) => r.x < after.right && after.x < r.right && r.y < after.bottom && after.y < r.bottom;
      const others = [...only!.at].filter(([id]) => !only!.ids.has(id) && size.has(id));
      if (!others.some(([id, p]) => hit(rect(id, p)))) return;
      const between = others.filter(([id, p]) => p.x < was.right && p.y < was.bottom && hit(rect(id, p)));
      const dx = Math.max(0, after.right - was.right);
      const dy = Math.max(0, after.bottom - was.bottom, ...between.map(([, p]) => after.bottom + GAP - p.y));
      for (const [id, p] of others) {
        const right = p.x >= was.right;
        const down = p.y >= was.bottom || (!right && between.some(([b]) => b === id));
        if ((right && dx) || (down && dy)) pos.set(id, { x: p.x + (right ? dx : 0), y: p.y + (down ? dy : 0) });
      }
    }
  }
  return pos;
}

type Box = { x: number; y: number; right: number; bottom: number };
const GAP = 40;

/**
 * Positions for the items that have none (an agent's step, a paste) on a sheet that is already laid out. Each goes
 * where the full layout `pos` puts it, moved by how far the placed items sit from their own layout spots (so it lands
 * beside its neighbours), then to the nearest spot that covers no placed item and no box it isn't in.
 * Nothing already placed moves.
 */
export function placeNew(d: Design, pos: Map<string, Pos>) {
  const empty = d.boundaries.filter((b) => !d.components.some((c) => c.boundary === b.id) && !d.boundaries.some((x) => x.parent === b.id));
  // `inside`: the innermost box an item may sit in; an empty boundary is its own box.
  const items = [
    ...d.components.map((c) => ({ id: c.id, ...SHAPES[c.type], position: c.position, inside: c.boundary })),
    ...d.notes.map((n) => ({ id: n.id, ...NOTE_SIZE, position: n.position, inside: undefined })),
    ...d.decisions.map((x) => ({ id: x.id, ...DECISION_SIZE, position: x.position, inside: undefined })),
    ...empty.map((b) => ({ id: b.id, ...(b.size ?? EMPTY_BOUNDARY), position: b.position, inside: b.id })),
  ];
  const fresh = items.filter((i) => !i.position && pos.has(i.id));
  const placed = items.filter((i) => i.position);
  if (!placed.length) return new Map(fresh.map((i) => [i.id, pos.get(i.id)!]));

  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const known = placed.filter((i) => pos.has(i.id));
  const dx = median(known.map((i) => i.position!.x - pos.get(i.id)!.x));
  const dy = median(known.map((i) => i.position!.y - pos.get(i.id)!.y));
  const freshIds = new Set(fresh.map((i) => i.id));
  const boxes = [...boundaryBoxes(d)].filter(([id]) => !freshIds.has(id));
  const taken = placed.map((i) => ({ ...i.position!, w: i.w, h: i.h }));
  const out = new Map<string, Pos>();
  for (const i of fresh) {
    const own = new Set<string>();
    for (let b = i.inside; b && !own.has(b); b = d.boundaries.find((x) => x.id === b)?.parent) own.add(b);
    const walls = [...taken, ...boxes.filter(([id]) => !own.has(id)).map(([, b]) => b)];
    const free = (p: Pos) => walls.every((b) => p.x >= b.x + b.w + GAP || b.x >= p.x + i.w + GAP || p.y >= b.y + b.h + GAP || b.y >= p.y + i.h + GAP);
    const want = { x: pos.get(i.id)!.x + dx, y: pos.get(i.id)!.y + dy };
    let at = want;
    // Rings of grid points ever further out; the closest free one wins.
    for (let r = 0; r <= 4000; r += STEP) {
      const ring: Pos[] = [];
      for (let a = -r; a <= r; a += STEP) {
        ring.push({ x: want.x + a, y: want.y - r }, { x: want.x + a, y: want.y + r });
        if (Math.abs(a) < r) ring.push({ x: want.x - r, y: want.y + a }, { x: want.x + r, y: want.y + a });
      }
      const hit = ring.filter(free).sort((p, q) => Math.hypot(p.x - want.x, p.y - want.y) - Math.hypot(q.x - want.x, q.y - want.y))[0];
      if (hit) {
        at = hit;
        break;
      }
    }
    out.set(i.id, { x: Math.round(at.x), y: Math.round(at.y) });
    taken.push({ ...at, w: i.w, h: i.h });
  }
  return out;
}
const STEP = 20;

/** Gives every item without a position one, as the app does when it opens a design (for files made without the app). */
export async function placeMissing(d: Design) {
  const empty = d.boundaries.filter((b) => !d.components.some((c) => c.boundary === b.id) && !d.boundaries.some((x) => x.parent === b.id));
  const items = [...d.components, ...d.notes, ...d.decisions, ...empty];
  if (!items.some((x) => !x.position)) return;
  const at = placeNew(d, await layout(d));
  for (const x of items) x.position ??= at.get(x.id);
}
