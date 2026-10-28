import { parseDesign, type Design } from './schema.ts';

// Three-way merge for when the app saves over a design an agent changed meanwhile: the reviewer's edits since the
// last save (base → mine) are replayed onto what is on disk now (theirs), item by item and field by field.

const LISTS = ['steps', 'components', 'connections', 'notes', 'decisions', 'boundaries', 'comments', 'flows'] as const;
type Item = { id: string } & Record<string, unknown>;

// Items come from the same JSON round trips, so key order matches and a string compare is enough.
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields mine changed from base win; the rest come from theirs. Fields both changed differently are clashes (mine wins). */
function mergeFields<T extends Record<string, unknown>>(base: T, mine: T, theirs: T, clash: (field: string) => void): T {
  const out: Record<string, unknown> = { ...theirs };
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (same(mine[k], base[k])) continue;
    if (!same(theirs[k], base[k]) && !same(theirs[k], mine[k])) clash(k);
    if (mine[k] === undefined) delete out[k];
    else out[k] = mine[k];
  }
  return out as T;
}

/**
 * The merged design (at theirs' rev, ready to save) and what clashed, or undefined when the result isn't a valid
 * design (say, a line of theirs to a part mine deleted); then the caller keeps theirs.
 */
export function mergeDesigns(base: Design, mine: Design, theirs: Design): { merged: Design; clashes: string[] } | undefined {
  const clashes: string[] = [];
  // Title, description and the like; the lists are merged item by item below.
  const top = (d: Design) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'rev' && !(LISTS as readonly string[]).includes(k)));
  const merged = { ...mergeFields(top(base), top(mine), top(theirs), (f) => clashes.push(f)), rev: theirs.rev } as Record<string, unknown>;
  for (const list of LISTS) {
    const b = new Map((base[list] as Item[]).map((x) => [x.id, x])), m = new Map((mine[list] as Item[]).map((x) => [x.id, x]));
    const out: Item[] = [];
    for (const t of theirs[list] as Item[]) {
      const [was, now] = [b.get(t.id), m.get(t.id)];
      if (!was) out.push(t); // new on disk
      else if (!now) {
        // Mine deleted it: gone, unless theirs changed it meanwhile.
        if (!same(t, was)) (out.push(t), clashes.push(`${t.id} (kept, changed on disk)`));
      } else out.push(mergeFields(was, now, t, (f) => clashes.push(`${t.id}.${f}`)));
    }
    const kept = new Set((theirs[list] as Item[]).map((x) => x.id));
    for (const x of mine[list] as Item[]) {
      if (kept.has(x.id)) continue;
      if (!b.has(x.id)) out.push(x); // mine added it
      else if (!same(x, b.get(x.id))) clashes.push(`${x.id} (deleted on disk)`);
    }
    merged[list] = out;
  }
  try {
    return { merged: parseDesign(merged), clashes };
  } catch {
    return undefined;
  }
}
