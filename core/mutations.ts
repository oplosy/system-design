import { SCHEMA_VERSION, fragmentProblem, type BoundaryKind, type ComponentType, type Connection, type ConnectionKind, type Design, type Fragment, type Ref } from './schema.ts';

// Pure, browser-safe edits shared by the UI and the MCP server. Each one mutates `d` in place.

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

function usedIds(d: Design) {
  return new Set([...d.components, ...d.notes, ...d.decisions, ...d.connections, ...d.boundaries, ...d.flows, ...d.steps, ...d.comments].map((x) => x.id));
}

/** A design with nothing on it but its first step. */
export function blankDesign(id: string, title: string): Design {
  return { id, version: SCHEMA_VERSION, title, rev: 0, steps: [{ id: 'start', title: 'Start', seen: true }], components: [], connections: [], notes: [], decisions: [], boundaries: [], comments: [], flows: [] };
}

export function uniqueId(d: Design, base: string) {
  const used = usedIds(d);
  const slug = slugify(base);
  if (!used.has(slug)) return slug;
  for (let i = 2; ; i++) if (!used.has(`${slug}-${i}`)) return `${slug}-${i}`;
}

/** Resolves the step an edit goes to (latest when omitted). Agent edits reopen the step for review. */
function stepFor(d: Design, step: string | undefined, reopen: boolean) {
  const s = step ? d.steps.find((x) => x.id === step) : d.steps.at(-1);
  if (!s) throw new Error(`unknown step "${step}"`);
  if (reopen) s.seen = false;
  return s.id;
}

/** `option`: the step option an added item belongs to (see addStep). */
type Edit = { step?: string; reopen?: boolean; option?: string };

/** The step an edit goes to, plus the option of that step it belongs to. */
function placed(d: Design, input: Edit) {
  const step = stepFor(d, input.step, input.reopen ?? true);
  if (input.option && !d.steps.find((s) => s.id === step)!.options?.some((o) => o.id === input.option)) throw new Error(`step "${step}" has no option "${input.option}"`);
  return { step, option: input.option };
}

/** Adds a step. With `options` the step offers alternatives (two or more) whose items the reviewer compares before picking one. */
export function addStep(d: Design, input: { title: string; summary?: string; seen?: boolean; options?: { id?: string; title: string; summary?: string }[] }) {
  if (input.options && input.options.length < 2) throw new Error('A step with options needs at least two.');
  const id = uniqueId(d, input.title);
  const taken = new Set<string>();
  const options = input.options?.map((o) => {
    let oid = slugify(o.id ?? o.title);
    for (let i = 2; taken.has(oid); i++) oid = `${slugify(o.id ?? o.title)}-${i}`;
    taken.add(oid);
    return { id: oid, title: o.title, summary: o.summary };
  });
  d.steps.push({ id, title: input.title, summary: input.summary, seen: input.seen ?? false, options });
  return id;
}

/**
 * The reviewer picks one of a step's options: the others' items go, the picked ones become plain items,
 * and a decision records the pick with the others as alternatives.
 */
export function pickOption(d: Design, stepId: string, optionId: string) {
  const s = d.steps.find((x) => x.id === stepId);
  const chosen = s?.options?.find((o) => o.id === optionId);
  if (!s || !chosen) throw new Error(`step "${stepId}" has no option "${optionId}"`);
  for (const x of items(d)) if (x.step === stepId && x.option && x.option !== optionId && items(d).some((i) => i.id === x.id)) removeItem(d, x.id);
  const links = d.components.filter((c) => c.option === optionId).map((c) => c.id);
  for (const x of items(d)) if (x.option === optionId) x.option = undefined;
  const others = s.options!.filter((o) => o.id !== optionId);
  s.options = undefined;
  return addDecision(d, {
    title: `${s.title}: ${chosen.title}`,
    why: chosen.summary ?? `Picked in review over ${others.map((o) => o.title).join(', ')}.`,
    alternatives: others.map((o) => (o.summary ? `${o.title}: ${o.summary}` : o.title)),
    links,
    step: stepId,
    reopen: false,
  });
}

function checkBoundary(d: Design, id: string | undefined) {
  if (id && !d.boundaries.some((b) => b.id === id)) throw new Error(`unknown boundary "${id}"`);
}

export function addComponent(
  d: Design,
  input: Edit & { id?: string; type: ComponentType; label: string; tech?: string; description?: string; boundary?: string; detail?: string; code?: string; cost?: number; capacity?: number; source?: string; tags?: string[]; refs?: Ref[]; position?: { x: number; y: number } },
) {
  checkBoundary(d, input.boundary);
  if (input.detail === d.id) throw new Error('A component can’t open its own design.');
  const id = uniqueId(d, input.id ?? input.label);
  d.components.push({
    id,
    type: input.type,
    label: input.label,
    tech: input.tech,
    description: input.description,
    boundary: input.boundary,
    detail: input.detail,
    code: input.code,
    cost: input.cost,
    capacity: input.capacity,
    source: input.source,
    tags: input.tags?.length ? [...new Set(input.tags)] : undefined,
    refs: input.refs?.length ? input.refs : undefined,
    position: input.position,
    ...placed(d, input),
  });
  return id;
}

/** Adds a boundary box. `members` are existing component ids that move into it. */
export function addBoundary(
  d: Design,
  input: Edit & { id?: string; kind: BoundaryKind; label: string; detail?: string; description?: string; parent?: string; members?: string[]; position?: { x: number; y: number } },
) {
  checkBoundary(d, input.parent);
  for (const mId of input.members ?? []) {
    if (!d.components.some((c) => c.id === mId)) throw new Error(`unknown component "${mId}"`);
  }
  const id = uniqueId(d, input.id ?? input.label);
  d.boundaries.push({
    id,
    kind: input.kind,
    label: input.label,
    detail: input.detail,
    description: input.description,
    parent: input.parent,
    position: input.position,
    ...placed(d, input),
  });
  for (const c of d.components) if (input.members?.includes(c.id)) c.boundary = id;
  return id;
}

/** Ids of every boundary inside `id`, at any depth, plus `id` itself. */
export function boundaryTree(d: Design, id: string) {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of d.boundaries) {
      if (b.parent && out.has(b.parent) && !out.has(b.id)) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Moves a component (or a boundary, with everything in it) into `boundary`, or out of all boundaries. */
export function placeIn(d: Design, id: string, boundary: string | undefined) {
  checkBoundary(d, boundary);
  const c = d.components.find((x) => x.id === id);
  const b = d.boundaries.find((x) => x.id === id);
  if (c) c.boundary = boundary;
  else if (b) {
    if (boundary && boundaryTree(d, id).has(boundary)) throw new Error('A boundary can’t sit inside itself.');
    b.parent = boundary;
  } else throw new Error(`unknown component or boundary "${id}"`);
}

export function connect(
  d: Design,
  input: Edit & { from: string; to: string; label?: string; async?: boolean; kind?: ConnectionKind; route?: Connection['route']; qps?: number; latency?: number },
) {
  for (const end of [input.from, input.to]) {
    if (!d.components.some((c) => c.id === end)) throw new Error(`unknown component "${end}"`);
  }
  const id = uniqueId(d, `${input.from}-to-${input.to}`);
  d.connections.push({
    id,
    from: input.from,
    to: input.to,
    label: input.label,
    async: input.async,
    kind: input.kind,
    route: input.route,
    qps: input.qps,
    latency: input.latency,
    ...placed(d, input),
  });
  return id;
}

export function addNote(d: Design, input: Edit & { text: string; attachTo?: string; position?: { x: number; y: number } }) {
  if (input.attachTo && !d.components.some((c) => c.id === input.attachTo)) throw new Error(`unknown component "${input.attachTo}"`);
  const id = uniqueId(d, 'note');
  d.notes.push({ id, text: input.text, attachTo: input.attachTo, position: input.position, ...placed(d, input) });
  return id;
}

export function addDecision(
  d: Design,
  input: Edit & { title: string; why: string; alternatives?: string[]; tradeoffs?: string; links?: string[]; position?: { x: number; y: number } },
) {
  for (const l of input.links ?? []) {
    if (!d.components.some((c) => c.id === l)) throw new Error(`unknown component "${l}"`);
  }
  const id = uniqueId(d, `decision-${input.title}`);
  d.decisions.push({
    id,
    title: input.title,
    why: input.why,
    alternatives: input.alternatives,
    tradeoffs: input.tradeoffs,
    links: input.links ?? [],
    position: input.position,
    ...placed(d, input),
  });
  return id;
}

/** A flow with stops gone. Its fragments count hops, so they go when the hops change. */
function keepStops(f: Design['flows'][number], keep: (id: string) => boolean) {
  const path = f.path.filter(keep).filter((p, i, a) => p !== a[i - 1]);
  const { fragments, ...rest } = f;
  return { ...rest, path, ...(path.length === f.path.length && fragments ? { fragments } : {}) };
}

/** The connection a flow hop runs along, in either direction. */
export function hopConnection(d: Design, a: string, b: string) {
  return d.connections.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** Adds a request path through components in order; every hop must follow an existing connection. */
export function addFlow(d: Design, input: Edit & { title: string; path: string[]; fragments?: Fragment[] }) {
  if (input.path.length < 2) throw new Error('A flow needs at least two components.');
  for (const p of input.path) if (!d.components.some((c) => c.id === p)) throw new Error(`unknown component "${p}"`);
  for (let i = 1; i < input.path.length; i++) {
    if (!hopConnection(d, input.path[i - 1], input.path[i])) throw new Error(`no connection between "${input.path[i - 1]}" and "${input.path[i]}"`);
  }
  const problem = input.fragments && fragmentProblem(input.fragments, input.path.length - 1);
  if (problem) throw new Error(problem);
  const id = uniqueId(d, `flow-${input.title}`);
  d.flows.push({ id, title: input.title, path: input.path, ...(input.fragments?.length ? { fragments: input.fragments } : {}), ...placed(d, input) });
  return id;
}

/** Removes any item by id, plus whatever points at it. A removed boundary hands its contents to its own parent. */
export function removeItem(d: Design, id: string) {
  const count = () => d.components.length + d.connections.length + d.notes.length + d.decisions.length + d.boundaries.length + d.flows.length;
  const before = count();
  const gone = d.boundaries.find((b) => b.id === id);
  if (gone) {
    for (const c of d.components) if (c.boundary === id) c.boundary = gone.parent;
    for (const b of d.boundaries) if (b.parent === id) b.parent = gone.parent;
    d.boundaries = d.boundaries.filter((b) => b.id !== id);
  }
  d.components = d.components.filter((c) => c.id !== id);
  d.connections = d.connections.filter((c) => c.id !== id && c.from !== id && c.to !== id);
  d.notes = d.notes.filter((n) => n.id !== id).map((n) => (n.attachTo === id ? { ...n, attachTo: undefined } : n));
  d.decisions = d.decisions.filter((x) => x.id !== id).map((x) => ({ ...x, links: x.links.filter((l) => l !== id) }));
  // A flow skips a removed stop, and goes when fewer than two stops are left.
  d.flows = d.flows
    .filter((f) => f.id !== id)
    .map((f) => keepStops(f, (p) => p !== id))
    .filter((f) => f.path.length >= 2);
  if (before === count()) throw new Error(`unknown item "${id}"`);
  // Feedback about a removed item stays on its step.
  for (const c of d.comments) if (c.target === id) c.target = undefined;
}

/** Every item a design draws, of any kind. */
export const items = (d: Design) => [...d.components, ...d.connections, ...d.notes, ...d.decisions, ...d.boundaries, ...d.flows];

// Agent edits to earlier items are recorded on the step they land in (latest by default), which reopens for review.
// Items that step added itself need no record: the diff already shows them as new.

const KINDS = ['components', 'connections', 'notes', 'decisions', 'boundaries', 'flows'] as const;
type Kind = (typeof KINDS)[number];
type Snapshot = Pick<Design, Kind>;
type Item = { id: string; step: string };

const snapshot = (d: Design): Snapshot => structuredClone(Object.fromEntries(KINDS.map((k) => [k, d[k]])) as Snapshot);

function nameOf(d: Design, x: Snapshot[Kind][number]) {
  return 'from' in x ? `${labelOf(d, x.from)} → ${labelOf(d, x.to)}` : 'label' in x ? x.label : 'title' in x ? x.title : x.text;
}

/** Keeps the first earlier state of every item `s` touched, so reverting the step can restore it. */
function remember(d: Design, s: Design['steps'][number], was: Snapshot) {
  for (const kind of KINDS) {
    for (const old of was[kind] as Item[]) {
      if (old.step === s.id || s.before?.some((b) => b.item.id === old.id)) continue;
      const now = (d[kind] as Item[]).find((x) => x.id === old.id);
      if (now && JSON.stringify(now) === JSON.stringify(old)) continue;
      (s.before ??= []).push({ kind, item: old });
    }
  }
}

/** Removes an item as an agent edit, remembering on the step what went with it (lines to a removed part included). */
export function removeTracked(d: Design, id: string, step?: string) {
  if (!items(d).some((i) => i.id === id)) throw new Error(`unknown item "${id}"`);
  const s = d.steps.find((t) => t.id === stepFor(d, step, true))!;
  const was = snapshot(d);
  const names = new Map(KINDS.flatMap((k) => (was[k] as Snapshot[Kind]).map((x) => [x.id, nameOf(d, x)] as const)));
  removeItem(d, id);
  for (const kind of KINDS) {
    for (const x of was[kind] as Snapshot[Kind]) {
      if (x.step === s.id || (d[kind] as Item[]).some((i) => i.id === x.id)) continue;
      (s.removed ??= []).push({ id: x.id, label: names.get(x.id)!, type: 'type' in x ? x.type : undefined, position: 'position' in x ? x.position : undefined });
    }
  }
  remember(d, s, was);
}

/**
 * Changes fields of a component, boundary or connection as a recorded edit; each field keeps its value from before the step.
 * Agent edits reopen the step for review; the reviewer's own edits pass `reopen: false`.
 */
export function updateTracked(d: Design, id: string, fields: Record<string, string | number | boolean | string[] | Ref[] | undefined>, step?: string, reopen = true) {
  const x = [...d.components, ...d.boundaries, ...d.connections].find((i) => i.id === id) as Record<string, unknown> | undefined;
  if (!x) throw new Error(`unknown component, boundary or connection "${id}"`);
  const one = (v: unknown) => (v && typeof v === 'object' && 'kind' in v ? `${(v as Ref).kind}: ${(v as Ref).value}` : String(v));
  const text = (v: unknown) => (v === undefined ? undefined : Array.isArray(v) ? v.map(one).join(', ') : String(v));
  const s = d.steps.find((t) => t.id === stepFor(d, step, reopen))!;
  const was = snapshot(d);
  for (const [field, to] of Object.entries(fields)) {
    const from = x[field];
    if (from === to) continue;
    if (field === 'boundary' || field === 'parent') placeIn(d, id, to as string | undefined);
    else x[field] = to;
    if (x.step === s.id) continue;
    const seen = s.changed?.find((c) => c.id === id && c.field === field);
    if (seen) seen.to = text(to);
    else (s.changed ??= []).push({ id, field, from: text(from), to: text(to) });
  }
  // A field changed back to where it started is no change.
  s.changed = s.changed?.filter((c) => c.from !== c.to);
  remember(d, s, was);
}

/** Drops references to items that are gone, e.g. after restoring items from an older state. */
function dropDangling(d: Design) {
  const components = new Set(d.components.map((c) => c.id));
  const boundaries = new Set(d.boundaries.map((b) => b.id));
  for (const c of d.components) if (c.boundary && !boundaries.has(c.boundary)) c.boundary = undefined;
  for (const b of d.boundaries) if (b.parent && (!boundaries.has(b.parent) || boundaryTree(d, b.id).has(b.parent))) b.parent = undefined;
  d.connections = d.connections.filter((c) => components.has(c.from) && components.has(c.to));
  for (const n of d.notes) if (n.attachTo && !components.has(n.attachTo)) n.attachTo = undefined;
  for (const x of d.decisions) x.links = x.links.filter((l) => components.has(l));
  d.flows = d.flows
    .map((f) => keepStops(f, (p) => components.has(p)))
    .filter((f) => f.path.length >= 2);
}

/** Undoes a step: removes what it added and puts back what its agent edits removed or changed. The step goes too, unless it is the only one. */
export function revertStep(d: Design, id: string) {
  const s = d.steps.find((t) => t.id === id);
  if (!s) throw new Error(`unknown step "${id}"`);
  for (const x of items(d)) if (x.step === id && items(d).some((i) => i.id === x.id)) removeItem(d, x.id);
  for (const { kind, item } of s.before ?? []) {
    const list = d[kind] as unknown as Item[];
    const at = list.findIndex((x) => x.id === item.id);
    // An id taken again by a later step's item stays with that item.
    if (at < 0 && items(d).some((x) => x.id === item.id)) continue;
    if (at >= 0 && list[at].step !== item.step) continue;
    if (at >= 0) list[at] = item as unknown as Item;
    else list.push(item as unknown as Item);
  }
  dropDangling(d);
  if (d.steps.length > 1) {
    d.steps = d.steps.filter((t) => t.id !== id);
    d.comments = d.comments.filter((c) => c.step !== id);
  } else {
    s.removed = s.changed = s.before = undefined;
  }
}

/** What an item is called: its label, or its title, else its id. */
export function labelOf(d: Design, id: string) {
  const x = items(d).find((i) => i.id === id);
  return x && ('label' in x && x.label ? x.label : 'title' in x ? x.title : x.id);
}

/** Where each step sits in the walkthrough, for filtering what is visible. */
export function stepIndex(d: Design) {
  return new Map(d.steps.map((s, i) => [s.id, i]));
}
