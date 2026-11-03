import type { Design } from './schema.ts';
import { boundaryTree, uniqueId } from './mutations.ts';

// Copy and paste of items between steps and designs. Pasting mutates `d` in place.

export type Clip = Pick<Design, 'components' | 'connections' | 'notes' | 'decisions' | 'boundaries'> & { flows?: Design['flows'] };

/** Copies items for pasting: a boundary brings everything inside it, and connections and flows come along when all their stops do. */
export function copyItems(d: Design, ids: string[]): Clip {
  const boundaries = new Set<string>();
  for (const id of ids) if (d.boundaries.some((b) => b.id === id)) for (const b of boundaryTree(d, id)) boundaries.add(b);
  const components = d.components.filter((c) => ids.includes(c.id) || (c.boundary && boundaries.has(c.boundary)));
  const cIds = new Set(components.map((c) => c.id));
  return structuredClone({
    components,
    boundaries: d.boundaries.filter((b) => boundaries.has(b.id)),
    connections: d.connections.filter((c) => cIds.has(c.from) && cIds.has(c.to)),
    notes: d.notes.filter((n) => ids.includes(n.id)),
    decisions: d.decisions.filter((x) => ids.includes(x.id)),
    flows: d.flows.filter((f) => f.path.every((p) => cIds.has(p))),
  });
}

/** Pastes copied items into `step` with fresh ids, shifted by `offset`. Returns the new canvas node ids. */
export function pasteItems(d: Design, clip: Clip, { step, offset }: { step: string; offset: number }) {
  if (!d.steps.some((s) => s.id === step)) throw new Error(`unknown step "${step}"`);
  const ids = new Map<string, string>();
  // Pushing each item before naming the next keeps every new id unique.
  const fresh = (old: string) => {
    const id = uniqueId(d, old);
    ids.set(old, id);
    return id;
  };
  const map = (id: string | undefined) => (id === undefined ? undefined : ids.get(id) ?? id);
  const shift = (p?: { x: number; y: number }) => p && { x: p.x + offset, y: p.y + offset };
  const isBoundary = (id?: string) => !!id && d.boundaries.some((b) => b.id === id);
  const isComponent = (id?: string) => !!id && d.components.some((c) => c.id === id);
  const pasted = clip.boundaries.map((b) => {
    const nb = { ...b, id: fresh(b.id), position: shift(b.position), step, option: undefined };
    d.boundaries.push(nb);
    return nb;
  });
  for (const nb of pasted) nb.parent = isBoundary(map(nb.parent)) ? map(nb.parent) : undefined;
  for (const c of clip.components) {
    d.components.push({ ...c, id: fresh(c.id), boundary: isBoundary(map(c.boundary)) ? map(c.boundary) : undefined, position: shift(c.position), step, option: undefined });
  }
  const nodes = [...ids.values()];
  for (const c of clip.connections) d.connections.push({ ...c, id: fresh(c.id), from: ids.get(c.from)!, to: ids.get(c.to)!, step, option: undefined });
  for (const f of clip.flows ?? []) d.flows.push({ ...f, id: fresh(f.id), path: f.path.map((p) => ids.get(p)!), step, option: undefined });
  for (const n of clip.notes) {
    nodes.push(fresh(n.id));
    d.notes.push({ ...n, id: nodes.at(-1)!, attachTo: isComponent(map(n.attachTo)) ? map(n.attachTo) : undefined, position: shift(n.position), step, option: undefined });
  }
  for (const x of clip.decisions) {
    nodes.push(fresh(x.id));
    d.decisions.push({ ...x, id: nodes.at(-1)!, links: x.links.map((l) => map(l)!).filter(isComponent), position: shift(x.position), step, option: undefined });
  }
  return nodes;
}
