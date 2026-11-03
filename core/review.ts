import type { Comment, Design } from './schema.ts';
import { items, labelOf, uniqueId } from './mutations.ts';

// Review feedback: comments on steps and items, sending a step back, and the agent answering. Each edit mutates `d` in place.

/** Adds review feedback to a step, or to one item (then the step defaults to the item's). */
export function addComment(d: Design, input: { step?: string; target?: string; text: string; by: Comment['by']; author?: string; resolved?: boolean }) {
  const target = input.target ? items(d).find((x) => x.id === input.target) : undefined;
  if (input.target && !target) throw new Error(`unknown item "${input.target}"`);
  if (!input.text.trim()) throw new Error('A comment needs text.');
  const step = input.step ?? target?.step ?? d.steps.at(-1)!.id;
  if (!d.steps.some((s) => s.id === step)) throw new Error(`unknown step "${step}"`);
  const id = uniqueId(d, 'comment');
  d.comments.push({ id, step, target: input.target, text: input.text.trim(), by: input.by, author: input.author, at: new Date().toISOString(), resolved: input.resolved });
  return id;
}

/** On a save from a signed-in person: comments already saved keep their author, and new ones get this person's name. */
export function keepAuthors(comments: Comment[], saved: Comment[], name: string) {
  const known = new Map(saved.map((c) => [c.id, c.author]));
  for (const c of comments) c.author = known.has(c.id) ? known.get(c.id) : name;
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
