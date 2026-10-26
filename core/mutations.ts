import type { BoundaryKind, Comment, ComponentType, ConnectionKind, Design } from './schema.ts';

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
  return new Set([...d.components, ...d.notes, ...d.decisions, ...d.connections, ...d.boundaries, ...d.steps, ...d.comments].map((x) => x.id));
}

export function uniqueId(d: Design, base: string) {
  const used = usedIds(d);
  const slug = slugify(base);
  if (!used.has(slug)) return slug;
  for (let i = 2; ; i++) if (!used.has(`${slug}-${i}`)) return `${slug}-${i}`;
}

/** Resolves the step an edit goes to (latest when omitted). Agent edits reopen the step for review. */
function useStep(d: Design, step: string | undefined, reopen: boolean) {
  const s = step ? d.steps.find((x) => x.id === step) : d.steps.at(-1);
  if (!s) throw new Error(`unknown step "${step}"`);
  if (reopen) s.seen = false;
  return s.id;
}

type Edit = { step?: string; reopen?: boolean };

export function addStep(d: Design, input: { title: string; summary?: string; seen?: boolean }) {
  const id = uniqueId(d, input.title);
  d.steps.push({ id, title: input.title, summary: input.summary, seen: input.seen ?? false });
  return id;
}

function checkBoundary(d: Design, id: string | undefined) {
  if (id && !d.boundaries.some((b) => b.id === id)) throw new Error(`unknown boundary "${id}"`);
}

export function addComponent(
  d: Design,
  input: Edit & { id?: string; type: ComponentType; label: string; tech?: string; description?: string; boundary?: string; position?: { x: number; y: number } },
) {
  checkBoundary(d, input.boundary);
  const id = uniqueId(d, input.id ?? input.label);
  d.components.push({
    id,
    type: input.type,
    label: input.label,
    tech: input.tech,
    description: input.description,
    boundary: input.boundary,
    position: input.position,
    step: useStep(d, input.step, input.reopen ?? true),
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
    step: useStep(d, input.step, input.reopen ?? true),
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

export function connect(d: Design, input: Edit & { from: string; to: string; label?: string; async?: boolean; kind?: ConnectionKind }) {
  for (const end of [input.from, input.to]) {
    if (!d.components.some((c) => c.id === end)) throw new Error(`unknown component "${end}"`);
  }
  const id = uniqueId(d, `${input.from}-to-${input.to}`);
  d.connections.push({ id, from: input.from, to: input.to, label: input.label, async: input.async, kind: input.kind, step: useStep(d, input.step, input.reopen ?? true) });
  return id;
}

export function addNote(d: Design, input: Edit & { text: string; attachTo?: string; position?: { x: number; y: number } }) {
  if (input.attachTo && !d.components.some((c) => c.id === input.attachTo)) throw new Error(`unknown component "${input.attachTo}"`);
  const id = uniqueId(d, 'note');
  d.notes.push({ id, text: input.text, attachTo: input.attachTo, position: input.position, step: useStep(d, input.step, input.reopen ?? true) });
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
    step: useStep(d, input.step, input.reopen ?? true),
  });
  return id;
}

/** Removes any item by id, plus whatever points at it. A removed boundary hands its contents to its own parent. */
export function removeItem(d: Design, id: string) {
  const count = () => d.components.length + d.connections.length + d.notes.length + d.decisions.length + d.boundaries.length;
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
  if (before === count()) throw new Error(`unknown item "${id}"`);
  // Feedback about a removed item stays on its step.
  for (const c of d.comments) if (c.target === id) c.target = undefined;
}

const items = (d: Design) => [...d.components, ...d.connections, ...d.notes, ...d.decisions, ...d.boundaries];

/** Removes everything a step added. The step goes too, unless it is the only one. */
export function revertStep(d: Design, id: string) {
  if (!d.steps.some((s) => s.id === id)) throw new Error(`unknown step "${id}"`);
  for (const x of items(d)) if (x.step === id && items(d).some((i) => i.id === x.id)) removeItem(d, x.id);
  if (d.steps.length > 1) {
    d.steps = d.steps.filter((s) => s.id !== id);
    d.comments = d.comments.filter((c) => c.step !== id);
  }
}

function labelOf(d: Design, id: string) {
  const x = items(d).find((i) => i.id === id);
  return x && ('label' in x && x.label ? x.label : 'title' in x ? x.title : x.id);
}

/** Adds review feedback to a step, or to one item (then the step defaults to the item's). */
export function addComment(d: Design, input: { step?: string; target?: string; text: string; by: Comment['by']; resolved?: boolean }) {
  const target = input.target ? items(d).find((x) => x.id === input.target) : undefined;
  if (input.target && !target) throw new Error(`unknown item "${input.target}"`);
  if (!input.text.trim()) throw new Error('A comment needs text.');
  const step = input.step ?? target?.step ?? d.steps.at(-1)!.id;
  if (!d.steps.some((s) => s.id === step)) throw new Error(`unknown step "${step}"`);
  const id = uniqueId(d, 'comment');
  d.comments.push({ id, step, target: input.target, text: input.text.trim(), by: input.by, at: new Date().toISOString(), resolved: input.resolved });
  return id;
}

/** The reviewer sends a step back. It counts as reviewed so the walkthrough can go on. */
export function requestChanges(d: Design, step: string, text?: string) {
  const s = d.steps.find((x) => x.id === step);
  if (!s) throw new Error(`unknown step "${step}"`);
  if (text?.trim()) addComment(d, { step, text, by: 'reviewer' });
  s.changesRequested = true;
  s.seen = true;
}

/** Steps with open feedback, for the agent to act on. */
export function feedback(d: Design) {
  return d.steps
    .map((s) => ({
      step: s.id,
      title: s.title,
      changesRequested: !!s.changesRequested,
      comments: d.comments
        .filter((c) => c.step === s.id && c.by === 'reviewer' && !c.resolved)
        .map((c) => ({ id: c.id, about: c.target && { id: c.target, label: labelOf(d, c.target) }, text: c.text })),
    }))
    .filter((s) => s.changesRequested || s.comments.length);
}

/**
 * The agent answers feedback: resolves the given comments (or every open one on `step`), optionally with a reply.
 * A step whose feedback is all resolved stops asking for changes and goes back to the reviewer.
 */
export function resolveFeedback(d: Design, input: { comments?: string[]; step?: string; reply?: string }) {
  if (input.step && !d.steps.some((s) => s.id === input.step)) throw new Error(`unknown step "${input.step}"`);
  for (const id of input.comments ?? []) if (!d.comments.some((c) => c.id === id)) throw new Error(`unknown comment "${id}"`);
  const resolving = d.comments.filter((c) => !c.resolved && (input.comments?.includes(c.id) || (input.step && c.step === input.step && c.by === 'reviewer')));
  const touched = new Set([...resolving.map((c) => c.step), ...(input.step ? [input.step] : [])]);
  for (const c of resolving) c.resolved = true;
  for (const stepId of touched) {
    if (input.reply?.trim()) addComment(d, { step: stepId, text: input.reply, by: 'agent', resolved: true });
    const s = d.steps.find((x) => x.id === stepId)!;
    if (!d.comments.some((c) => c.step === stepId && c.by === 'reviewer' && !c.resolved)) {
      s.changesRequested = undefined;
      s.seen = false;
    }
  }
  return [...touched];
}

export type Clip = Pick<Design, 'components' | 'connections' | 'notes' | 'decisions' | 'boundaries'>;

/** Copies items for pasting: a boundary brings everything inside it, and connections come along when both ends do. */
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
    const nb = { ...b, id: fresh(b.id), position: shift(b.position), step };
    d.boundaries.push(nb);
    return nb;
  });
  for (const nb of pasted) nb.parent = isBoundary(map(nb.parent)) ? map(nb.parent) : undefined;
  for (const c of clip.components) {
    d.components.push({ ...c, id: fresh(c.id), boundary: isBoundary(map(c.boundary)) ? map(c.boundary) : undefined, position: shift(c.position), step });
  }
  const nodes = [...ids.values()];
  for (const c of clip.connections) d.connections.push({ ...c, id: fresh(c.id), from: ids.get(c.from)!, to: ids.get(c.to)!, step });
  for (const n of clip.notes) {
    nodes.push(fresh(n.id));
    d.notes.push({ ...n, id: nodes.at(-1)!, attachTo: isComponent(map(n.attachTo)) ? map(n.attachTo) : undefined, position: shift(n.position), step });
  }
  for (const x of clip.decisions) {
    nodes.push(fresh(x.id));
    d.decisions.push({ ...x, id: nodes.at(-1)!, links: x.links.map((l) => map(l)!).filter(isComponent), position: shift(x.position), step });
  }
  return nodes;
}

/** Where each step sits in the walkthrough, for filtering what is visible. */
export function stepIndex(d: Design) {
  return new Map(d.steps.map((s, i) => [s.id, i]));
}
