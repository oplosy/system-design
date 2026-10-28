import type { BoundaryKind, ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';

// What every diagram reader (Mermaid, C4, draw.io, Structurizr) hands over, and how it lands in a design.

export type Node = {
  key: string;
  /** Id to prefer for the part; the key when unset. */
  id?: string;
  label?: string;
  type?: ComponentType;
  tech?: string;
  description?: string;
  /** Extra words for guessing the type (an icon name). */
  hint?: string;
  /** For a typed shape (a database), the guesses that may refine it. */
  refine?: ReadonlySet<ComponentType>;
  /** Where the source drew it (draw.io). */
  position?: { x: number; y: number };
};
export type Group = { key: string; id?: string; label: string; parent?: string; kind?: BoundaryKind };
export type Edge = { from: string; to: string; label?: string; async: boolean };
export type Diagram = {
  nodes: Node[];
  groups: Group[];
  member: Map<string, string>;
  edges: Edge[];
  flows: { title: string; path: string[] }[];
  /** What the reader could not bring in, said for the reviewer. */
  leftOut: string[];
};

/**
 * Adds a read diagram to `step` of a design. Parts and boxes the design already has (same name) are reused, so a
 * paste extends a design rather than copying into it. A node's "Label (Tech)" splits into label and technology, and
 * `guess` may pick a better type from them (e.g. "PostgreSQL" → SQL DB) for plain boxes. Returns what was added.
 */
export function importDiagram(d: Design, parsed: Diagram, { step, guess }: { step?: string; guess?: (words: string) => ComponentType | undefined } = {}) {
  if (!parsed.nodes.length) throw new Error('No parts found in this diagram.');
  const at = { step, reopen: false };
  const same = (a: string, b: string) => m.slugify(a) === m.slugify(b);
  // Only what was there before: two boxes of the same name in one diagram are still two parts.
  const before = { components: [...d.components], boundaries: [...d.boundaries] };
  const added = { components: [] as string[], connections: [] as string[], boundaries: [] as string[], flows: [] as string[], leftOut: parsed.leftOut };
  // A drawing with its own positions goes to the right of what the sheet already has.
  const drawn = parsed.nodes.filter((n) => n.position).map((n) => n.position!);
  const placed = before.components.filter((c) => c.position).map((c) => c.position!);
  const shift =
    drawn.length && placed.length
      ? { x: Math.max(...placed.map((p) => p.x)) + 300 - Math.min(...drawn.map((p) => p.x)), y: Math.min(...placed.map((p) => p.y)) - Math.min(...drawn.map((p) => p.y)) }
      : { x: 0, y: 0 };
  const boundaryIds = new Map<string, string>();
  for (const g of parsed.groups) {
    const found = before.boundaries.find((b) => same(b.label, g.label));
    if (found) boundaryIds.set(g.key, found.id);
    else {
      boundaryIds.set(g.key, m.addBoundary(d, { kind: g.kind ?? 'group', label: g.label, parent: g.parent && boundaryIds.get(g.parent), id: g.id ?? g.key, ...at }));
      added.boundaries.push(g.label);
    }
  }
  const ids = new Map<string, string>();
  for (const n of parsed.nodes) {
    const text = n.label ?? n.key;
    const split = n.tech === undefined ? /^(.+?)\s*\(([^()]+)\)$/.exec(text) : null;
    const [label, tech] = split ? [split[1], split[2]] : [text, n.tech];
    const found = before.components.find((c) => same(c.label, label));
    if (found) {
      ids.set(n.key, found.id);
      continue;
    }
    // A technology or icon given on its own (C4, architecture, draw.io) names a product, so it outranks words in the label.
    const named = n.tech ?? n.hint;
    const guessed = (named && guess?.(named)) || guess?.(`${tech ?? ''} ${label}`);
    const type = !n.type || n.type === 'service' ? guessed || n.type || 'service' : guessed && n.refine?.has(guessed) ? guessed : n.type;
    const boundary = parsed.member.get(n.key);
    const position = n.position && { x: Math.round(n.position.x + shift.x), y: Math.round(n.position.y + shift.y) };
    ids.set(n.key, m.addComponent(d, { id: n.id ?? n.key, type, label, tech, description: n.description, boundary: boundary && boundaryIds.get(boundary), position, ...at }));
    added.components.push(label);
  }
  const name = (id: string) => d.components.find((c) => c.id === id)!.label;
  for (const e of parsed.edges) {
    const from = ids.get(e.from)!, to = ids.get(e.to)!;
    if (from === to || d.connections.some((c) => c.from === from && c.to === to)) continue;
    m.connect(d, { from, to, label: e.label, async: e.async || undefined, ...at });
    added.connections.push(`${name(from)} → ${name(to)}`);
  }
  for (const f of parsed.flows) {
    const path = f.path.map((k) => ids.get(k)!);
    if (d.flows.some((x) => x.title === f.title) || !path.every((p, i) => i === 0 || m.hopConnection(d, path[i - 1], p))) continue;
    m.addFlow(d, { title: f.title, path, ...at });
    added.flows.push(f.title);
  }
  return added;
}
