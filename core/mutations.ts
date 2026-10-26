import type { ComponentType, Design } from './schema.ts';

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
  return new Set([...d.components, ...d.notes, ...d.decisions, ...d.connections, ...d.steps].map((x) => x.id));
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

export function addComponent(
  d: Design,
  input: Edit & { id?: string; type: ComponentType; label: string; tech?: string; description?: string; position?: { x: number; y: number } },
) {
  const id = uniqueId(d, input.id ?? input.label);
  d.components.push({
    id,
    type: input.type,
    label: input.label,
    tech: input.tech,
    description: input.description,
    position: input.position,
    step: useStep(d, input.step, input.reopen ?? true),
  });
  return id;
}

export function connect(d: Design, input: Edit & { from: string; to: string; label?: string; async?: boolean }) {
  for (const end of [input.from, input.to]) {
    if (!d.components.some((c) => c.id === end)) throw new Error(`unknown component "${end}"`);
  }
  const id = uniqueId(d, `${input.from}-to-${input.to}`);
  d.connections.push({ id, from: input.from, to: input.to, label: input.label, async: input.async, step: useStep(d, input.step, input.reopen ?? true) });
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

/** Removes any item by id, plus whatever points at it. */
export function removeItem(d: Design, id: string) {
  const before = d.components.length + d.connections.length + d.notes.length + d.decisions.length;
  d.components = d.components.filter((c) => c.id !== id);
  d.connections = d.connections.filter((c) => c.id !== id && c.from !== id && c.to !== id);
  d.notes = d.notes.filter((n) => n.id !== id).map((n) => (n.attachTo === id ? { ...n, attachTo: undefined } : n));
  d.decisions = d.decisions.filter((x) => x.id !== id).map((x) => ({ ...x, links: x.links.filter((l) => l !== id) }));
  const after = d.components.length + d.connections.length + d.notes.length + d.decisions.length;
  if (before === after) throw new Error(`unknown item "${id}"`);
}

/** Where each step sits in the walkthrough, for filtering what is visible. */
export function stepIndex(d: Design) {
  return new Map(d.steps.map((s, i) => [s.id, i]));
}
