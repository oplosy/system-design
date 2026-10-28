import type { Design } from './schema.ts';

// What changed between two versions of a design, as named events for webhooks and anything else listening.

export const EVENT_TYPES = [
  'design.created',
  'design.changed',
  'design.deleted',
  'design.restored',
  'step.added',
  'step.removed',
  'step.approved',
  'step.reopened',
  'step.sent_back',
  'part.added',
  'part.changed',
  'part.removed',
  'line.added',
  'line.changed',
  'line.removed',
  'boundary.added',
  'boundary.changed',
  'boundary.removed',
  'note.added',
  'note.changed',
  'note.removed',
  'decision.added',
  'decision.changed',
  'decision.removed',
  'flow.added',
  'flow.changed',
  'flow.removed',
  'comment.added',
  'comment.resolved',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
/** `subject` is the design id, or "<design>/<item>" for an item in it. */
export type DesignEvent = { type: EventType; subject: string; data: Record<string, unknown> };

const LISTS = { components: 'part', connections: 'line', boundaries: 'boundary', notes: 'note', decisions: 'decision', flows: 'flow' } as const;
// Where an item sits on the sheet is layout, not a change to the design; a drag would otherwise send an event per move.
const LAYOUT = new Set(['position', 'size', 'bend', 'route']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The events that turn `before` into `after`; `before` undefined means `after` was just created. */
export function designEvents(before: Design | undefined, after: Design): DesignEvent[] {
  const out: DesignEvent[] = [];
  const at = (id?: string) => (id ? `${after.id}/${id}` : after.id);
  if (!before) out.push({ type: 'design.created', subject: at(), data: { title: after.title } });
  const was = before ?? { ...after, steps: [], components: [], connections: [], boundaries: [], notes: [], decisions: [], flows: [], comments: [] };

  const fields = (['title', 'description', 'repo', 'currency', 'template'] as const).filter((f) => before && !same(before[f], after[f]));
  if (fields.length) out.push({ type: 'design.changed', subject: at(), data: { fields } });

  const steps = new Map(was.steps.map((s) => [s.id, s]));
  for (const s of after.steps) {
    const old = steps.get(s.id);
    const step = { id: s.id, title: s.title, summary: s.summary };
    if (!old) out.push({ type: 'step.added', subject: at(s.id), data: { step, seen: s.seen } });
    else if (!old.seen && s.seen) out.push({ type: 'step.approved', subject: at(s.id), data: { step } });
    else if (old.seen && !s.seen) out.push({ type: 'step.reopened', subject: at(s.id), data: { step } });
    if (old && !old.changesRequested && s.changesRequested) out.push({ type: 'step.sent_back', subject: at(s.id), data: { step } });
  }
  for (const s of was.steps) if (!after.steps.some((x) => x.id === s.id)) out.push({ type: 'step.removed', subject: at(s.id), data: { step: { id: s.id, title: s.title } } });

  for (const [list, kind] of Object.entries(LISTS) as [keyof typeof LISTS, (typeof LISTS)[keyof typeof LISTS]][]) {
    const old = new Map((was[list] as { id: string }[]).map((x) => [x.id, x as Record<string, unknown>]));
    const now = after[list] as unknown as Record<string, unknown>[];
    for (const x of now) {
      const id = x.id as string;
      const prev = old.get(id);
      if (!prev) {
        out.push({ type: `${kind}.added`, subject: at(id), data: { [kind]: x } });
        continue;
      }
      const changed = [...new Set([...Object.keys(prev), ...Object.keys(x)])].filter((k) => !LAYOUT.has(k) && !same(prev[k], x[k]));
      if (changed.length) out.push({ type: `${kind}.changed`, subject: at(id), data: { [kind]: x, fields: changed, before: Object.fromEntries(changed.map((k) => [k, prev[k]])) } });
    }
    for (const [id, x] of old) if (!now.some((y) => y.id === id)) out.push({ type: `${kind}.removed`, subject: at(id), data: { [kind]: x } });
  }

  const comments = new Map(was.comments.map((c) => [c.id, c]));
  for (const c of after.comments) {
    const old = comments.get(c.id);
    if (!old) out.push({ type: 'comment.added', subject: at(c.target ?? c.step), data: { comment: c } });
    else if (!old.resolved && c.resolved) out.push({ type: 'comment.resolved', subject: at(c.target ?? c.step), data: { comment: c } });
  }
  return out;
}
