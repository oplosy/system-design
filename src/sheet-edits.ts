import type { Connection as FlowConnection, Node } from '@xyflow/react';
import * as m from '../core/mutations.ts';
import { BOUNDARY_KINDS, COMPONENT_TYPES, type BoundaryKind, type ComponentType, type Design } from '../core/schema.ts';
import { BOUNDARY_SPECS, EMPTY_BOUNDARY, boundaryAt, type boundaryBoxes } from './boundaries.ts';
import type { AddKind } from './palette.tsx';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

type Pos = { x: number; y: number };
type Boxes = ReturnType<typeof boundaryBoxes>;

/** Everything that can be selected on the sheet. */
export const sheetItems = (d: Design) => [...d.components, ...d.connections, ...d.notes, ...d.decisions, ...d.boundaries];
/** Everything drawn at a position of its own. */
export const placedItems = (d: Design) => [...d.components, ...d.notes, ...d.decisions, ...d.boundaries];

const isEmpty = (d: Design, id: string) => !d.components.some((c) => c.boundary === id) && !d.boundaries.some((b) => b.parent === id);
/** Boundaries with nothing inside: the only ones whose own position matters. */
export const emptyBoundaries = (d: Design) => d.boundaries.filter((b) => isEmpty(d, b.id));

const boundaryKind = (k: string) => (k.startsWith('boundary:') && (BOUNDARY_KINDS as readonly string[]).includes(k.slice(9)) ? (k.slice(9) as BoundaryKind) : null);
export const isAddKind = (k: string): k is AddKind => k === 'note' || k === 'decision' || !!boundaryKind(k) || (COMPONENT_TYPES as readonly string[]).includes(k);

/** Adds a new item centred on `center` and returns its id. */
export function addItem(d: Design, kind: AddKind, { center, inside, step }: { center: Pos; inside?: string; step: string }) {
  const bKind = boundaryKind(kind);
  const size = bKind ? EMPTY_BOUNDARY : kind === 'note' ? NOTE_SIZE : kind === 'decision' ? DECISION_SIZE : SHAPES[kind as ComponentType];
  const position = { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2) };
  if (bKind) return m.addBoundary(d, { kind: bKind, label: BOUNDARY_SPECS[bKind].name, parent: inside, position, step, reopen: false });
  if (kind === 'note') return m.addNote(d, { text: 'New note', position, step, reopen: false });
  if (kind === 'decision') return m.addDecision(d, { title: 'New decision', why: 'Explain why', links: [], position, step, reopen: false });
  const type = kind as ComponentType;
  return m.addComponent(d, { type, label: SHAPES[type].name, boundary: inside, position, step, reopen: false });
}

/** Joins two items: a line between parts, or a note or decision attached to a part. */
export function connectItems(d: Design, { source, target }: Pick<FlowConnection, 'source' | 'target'>, step: string) {
  const isPart = (x: string) => d.components.some((i) => i.id === x);
  if (isPart(source) && isPart(target)) return void m.connect(d, { from: source, to: target, step, reopen: false });
  const part = isPart(source) ? source : isPart(target) ? target : null;
  if (!part) throw new Error('Connect notes and decisions to a component.');
  const other = part === source ? target : source;
  const note = d.notes.find((n) => n.id === other);
  const dec = d.decisions.find((x) => x.id === other);
  if (note) note.attachTo = part;
  if (dec && !dec.links.includes(part)) dec.links.push(part);
}

export function removeItems(d: Design, ids: string[]) {
  for (const x of ids) if (sheetItems(d).some((i) => i.id === x)) m.removeItem(d, x);
}

/** The text an item's in-place editor starts from; undefined for items that have none. */
export function labelOf(d: Design, id: string) {
  const named = d.components.find((x) => x.id === id) ?? d.boundaries.find((x) => x.id === id);
  const note = d.notes.find((x) => x.id === id), dec = d.decisions.find((x) => x.id === id), conn = d.connections.find((x) => x.id === id);
  const value = named?.label ?? note?.text ?? dec?.title ?? (conn && (conn.label ?? ''));
  return value === undefined ? undefined : { value, multiline: !!note || !!dec };
}

/** Writes an edited text back to whichever item has this id. */
export function setLabel(d: Design, id: string, value: string) {
  const conn = d.connections.find((i) => i.id === id);
  if (conn) conn.label = value || undefined;
  const named = d.components.find((i) => i.id === id) ?? d.boundaries.find((i) => i.id === id);
  if (named) named.label = value;
  const note = d.notes.find((i) => i.id === id);
  if (note) note.text = value;
  const dec = d.decisions.find((i) => i.id === id);
  if (dec) dec.title = value;
}

/** What moves along with the dragged nodes, at its starting position: all a dragged boundary holds, and notes and decisions about what moves. */
export function carriedAlong(d: Design, nodes: Node[], dragged: Node[]) {
  const carried = new Map<string, Pos>();
  for (const n of dragged) {
    if (n.type !== 'boundary') continue;
    const tree = m.boundaryTree(d, n.id);
    for (const x of nodes) {
      const inTree = x.type === 'boundary' ? tree.has(x.id) : d.components.some((c) => c.id === x.id && c.boundary && tree.has(c.boundary));
      if (inTree) carried.set(x.id, { ...x.position });
    }
  }
  for (const x of nodes) {
    const note = d.notes.find((i) => i.id === x.id), dec = d.decisions.find((i) => i.id === x.id);
    const along = note ? !!note.attachTo && carried.has(note.attachTo) : !!dec?.links.length && dec.links.every((l) => carried.has(l));
    if (along && !dragged.some((g) => g.id === x.id)) carried.set(x.id, { ...x.position });
  }
  return carried;
}

/** Saves where a drag ended: new positions, and the box each part or boundary dragged on its own landed in. */
export function landDragged(d: Design, { dragged, carried, boxes }: { dragged: Node[]; carried: Map<string, Pos>; boxes: Boxes }) {
  const moved = new Map(dragged.map((n) => [n.id, n.position]));
  const lead = dragged.find((n) => carried.has(n.id));
  if (lead) {
    const start = carried.get(lead.id)!;
    for (const [id, p] of carried) if (!moved.has(id)) moved.set(id, { x: p.x + lead.position.x - start.x, y: p.y + lead.position.y - start.y });
  }
  const held = new Set(d.boundaries.filter((b) => !isEmpty(d, b.id)).map((b) => b.id));
  for (const [id, p] of moved) {
    const item = placedItems(d).find((x) => x.id === id);
    if (item) item.position = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  for (const n of dragged) {
    if (carried.has(n.id) && n !== lead) continue;
    const c = d.components.find((x) => x.id === n.id);
    if (c) {
      const s = SHAPES[c.type];
      c.boundary = boundaryAt(boxes, { x: n.position.x + s.w / 2, y: n.position.y + s.h / 2 });
    }
    const b = d.boundaries.find((x) => x.id === n.id);
    if (b) b.parent = boundaryAt(boxes, { x: n.position.x + 20, y: n.position.y + 20 }, m.boundaryTree(d, b.id));
  }
  // A box that just lost its last member stays where it was instead of jumping.
  for (const b of d.boundaries) {
    const box = boxes.get(b.id);
    if (held.has(b.id) && isEmpty(d, b.id) && box) {
      b.position = { x: box.x, y: box.y };
      b.size = { w: box.w, h: box.h };
    }
  }
}
