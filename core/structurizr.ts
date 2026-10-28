import type { ComponentType } from './schema.ts';
import type { Diagram, Node } from './diagram.ts';
import { DATASTORE, QUEUE } from './interop.ts';

// Reads a Structurizr DSL workspace at the container level: people, containers and software systems without
// containers become parts, a software system with containers becomes a system boundary around them, groups become
// boundaries, relationships become lines (a component's lifted to its container), and dynamic views become flows.

type Kind = 'person' | 'softwareSystem' | 'container' | 'component' | 'element';
type El = { key: string; ident?: string; kind: Kind; name: string; description?: string; tech?: string; tags: string[]; parent?: string; group?: string };
type Rel = { from: string; to: string; label?: string; tags: string[]; scope?: string };

/** Whether `text` is a Structurizr DSL workspace. */
export function isStructurizr(text: string) {
  return /^\s*workspace\b/m.test(text.replace(/^\s*(#|\/\/).*$/gm, ''));
}

/** Lines of tokens: quoted strings, braces, arrows, `=` and bare words; comments dropped. */
function tokenize(text: string) {
  const lines: { tokens: { t: string; quoted: boolean }[]; at: number }[] = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  src.split(/\r?\n/).forEach((line, i) => {
    const tokens: { t: string; quoted: boolean }[] = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\{|\}|->|=)|([^\s{}"=]+)/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[3] && /^(#|\/\/)/.test(m[3])) break;
      if (m[1] !== undefined) tokens.push({ t: m[1].replace(/\\(.)/g, '$1'), quoted: true });
      else tokens.push({ t: m[2] ?? m[3], quoted: false });
    }
    // `a->b` written without spaces.
    const split = tokens.flatMap((x) => (!x.quoted && x.t.includes('->') && x.t !== '->' ? x.t.split(/(->)/).filter(Boolean).map((t) => ({ t, quoted: false })) : [x]));
    if (split.length) lines.push({ tokens: split, at: i + 1 });
  });
  return lines;
}

const KINDS = new Set<Kind>(['person', 'softwareSystem', 'container', 'component', 'element']);

export function readStructurizr(text: string): Diagram {
  const els = new Map<string, El>();
  const rels: Rel[] = [];
  const dynamics: { title: string; steps: Rel[] }[] = [];
  const skipped: number[] = [];
  let hierarchical = false;
  // Each open block: what it is and, for an element or group, which one.
  const stack: { kind: string; el?: string; group?: string }[] = [];
  let groups = 0;
  const groupInfo = new Map<string, { label: string; parent?: string; el?: string }>();

  for (const { tokens, at } of tokenize(text)) {
    const words = tokens.map((x) => x.t);
    const opens = words.at(-1) === '{';
    const body = opens ? tokens.slice(0, -1) : tokens;
    const top = stack.at(-1);
    const where = top?.kind ?? 'top';
    if (words[0] === '}' && words.length === 1) {
      stack.pop();
      continue;
    }
    if (where === 'ignore') {
      if (opens) stack.push({ kind: 'ignore' });
      continue;
    }
    if (body[0]?.t === '!identifiers') {
      hierarchical = body[1]?.t === 'hierarchical';
      continue;
    }
    if (body[0]?.t.startsWith('!')) continue;

    const inModel = where === 'model' || where === 'element' || where === 'group';
    const current = [...stack].reverse().find((s) => s.el)?.el;
    const group = [...stack].reverse().find((s) => s.group || s.el)?.group;

    if (where === 'top' && body[0]?.t === 'workspace') {
      if (opens) stack.push({ kind: 'workspace' });
      continue;
    }
    if (where === 'workspace') {
      if (body[0]?.t === 'model' && opens) stack.push({ kind: 'model' });
      else if (body[0]?.t === 'views' && opens) stack.push({ kind: 'views' });
      else if (opens) stack.push({ kind: 'ignore' });
      continue;
    }
    if (where === 'views' || where === 'dynamic') {
      if (where === 'views' && body[0]?.t === 'dynamic' && opens) {
        const args = body.slice(2).filter((x) => x.quoted).map((x) => x.t);
        dynamics.push({ title: args[1] || args[0] || 'Dynamic view', steps: [] });
        stack.push({ kind: 'dynamic', el: body[1]?.t === '*' ? undefined : body[1]?.t });
      } else if (where === 'dynamic' && body.some((x) => x.t === '->')) {
        const i = body.findIndex((x) => x.t === '->');
        // Steps may be numbered: `1: a -> b "…"`.
        const from = body[i - 1]?.t;
        const to = body[i + 1]?.t;
        if (from && to) dynamics.at(-1)!.steps.push({ from, to, label: body[i + 2]?.quoted ? body[i + 2].t : undefined, tags: [] });
      } else if (opens) stack.push({ kind: 'ignore' });
      continue;
    }
    if (!inModel) {
      if (opens) stack.push({ kind: 'ignore' });
      continue;
    }

    // Relationships: `a -> b "desc" "tech" "tags"`, `-> b …` inside an element, optionally named `r = a -> b`.
    const arrow = body.findIndex((x) => x.t === '->');
    if (arrow >= 0) {
      const lhs = body.slice(0, arrow).filter((x) => x.t !== '=');
      const from = lhs.length === 0 || lhs.at(-1)!.t === 'this' ? current : lhs.at(-1)!.t;
      const to = body[arrow + 1]?.t;
      const [label, tech, tags] = body.slice(arrow + 2).filter((x) => x.quoted).map((x) => x.t);
      if (!from || !to) skipped.push(at);
      else rels.push({ from, to, label: label || undefined, tags: [...(tags ?? '').split(','), tech ?? ''].map((s) => s.trim()).filter(Boolean), scope: current });
      if (opens) stack.push({ kind: 'ignore' });
      continue;
    }

    // Elements: `[id =] person|softwareSystem|container|component|element "name" …`.
    const assign = body[1]?.t === '=' ? body[0].t : undefined;
    const kw = (assign ? body[2] : body[0])?.t;
    if (kw && KINDS.has(kw as Kind)) {
      const kind = kw as Kind;
      const args = body.slice(assign ? 3 : 1).filter((x) => x.quoted).map((x) => x.t);
      // person / softwareSystem: name, description, tags; container / component: name, description, technology, tags; element: name, metadata, description, tags.
      const [name, a1, a2, a3] = args;
      const techn = kind === 'container' || kind === 'component';
      const parentEl = current;
      const ident = assign && (hierarchical && parentEl && els.get(parentEl)?.ident ? `${els.get(parentEl)!.ident}.${assign}` : assign);
      const key = ident ?? `${parentEl ? `${parentEl}/` : ''}${name}`;
      els.set(key, {
        key,
        ident,
        kind,
        name: name ?? assign ?? kind,
        description: (kind === 'element' ? a2 : a1) || undefined,
        tech: (techn ? a2 : kind === 'element' ? a1 : undefined) || undefined,
        tags: ((techn ? a3 : kind === 'element' ? a3 : a2) ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        parent: parentEl,
        group,
      });
      if (opens) stack.push({ kind: 'element', el: key, group });
      continue;
    }
    if (kw === 'group' && opens) {
      const key = `group-${++groups}`;
      groupInfo.set(key, { label: body.find((x) => x.quoted)?.t ?? 'Group', parent: group, el: current });
      stack.push({ kind: 'group', el: current, group: key });
      continue;
    }
    if (kw === 'enterprise' && opens) {
      const key = `group-${++groups}`;
      groupInfo.set(key, { label: body.find((x) => x.quoted)?.t ?? 'Enterprise', parent: group });
      stack.push({ kind: 'group', group: key });
      continue;
    }
    // Inside an element: description, technology and tags override what its line said.
    const el = current && els.get(current);
    const value = body[1]?.quoted ? body[1].t : undefined;
    if (el && value !== undefined && kw === 'description') el.description = value;
    else if (el && value !== undefined && kw === 'technology') el.tech = value;
    else if (el && kw === 'tags') el.tags.push(...body.slice(1).flatMap((x) => x.t.split(',')).map((s) => s.trim()).filter(Boolean));
    else if (kw && /^(url|properties|perspectives|deploymentEnvironment|deploymentGroup|instances|healthCheck)$/.test(kw)) {
      if (opens) stack.push({ kind: 'ignore' });
    } else {
      skipped.push(at);
      if (opens) stack.push({ kind: 'ignore' });
    }
  }
  if (!els.size) throw new Error('No people, software systems or containers found in this workspace.');

  // Container level: a system with containers is a box; components stand in for their container.
  const hasContainers = new Set([...els.values()].filter((e) => e.kind === 'container').map((e) => e.parent));
  const anyContainers = hasContainers.size > 0;
  const shown = (key: string): string | undefined => {
    const e = els.get(key);
    if (!e) return undefined;
    if (e.kind === 'component') return e.parent && shown(e.parent);
    if (e.kind === 'softwareSystem' && hasContainers.has(key)) return undefined;
    return key;
  };
  const resolve = (ref: string, scope?: string): string | undefined => {
    if (els.has(ref)) return ref;
    // A short identifier, written where it is unique or inside its parent's block.
    if (scope && els.has(`${els.get(scope)?.ident}.${ref}`)) return `${els.get(scope)!.ident}.${ref}`;
    const ends = [...els.keys()].filter((k) => k.endsWith(`.${ref}`));
    if (ends.length === 1) return ends[0];
    // A qualified name in a flat workspace (no !identifiers hierarchical) still means its last part.
    return ref.includes('.') ? resolve(ref.slice(ref.lastIndexOf('.') + 1)) : undefined;
  };

  const out: Diagram = { nodes: [], groups: [], member: new Map(), edges: [], flows: [], leftOut: [] };
  for (const [key, g] of groupInfo) out.groups.push({ key, id: g.label, label: g.label, parent: g.parent ?? (g.el ? `system:${g.el}` : undefined), kind: 'group' });
  for (const key of hasContainers) if (key) out.groups.unshift({ key: `system:${key}`, id: els.get(key)!.name, label: els.get(key)!.name, kind: 'system' });
  for (const e of els.values()) {
    if (shown(e.key) !== e.key) continue;
    const tags = e.tags.map((t) => t.toLowerCase());
    const store = tags.includes('database') || tags.includes('datastore');
    const queue = tags.some((t) => /queue|topic|stream/.test(t));
    const external = tags.includes('external') || tags.includes('existing system') || (e.kind === 'softwareSystem' && anyContainers);
    const type: ComponentType = e.kind === 'person' ? 'user' : store ? 'sql-db' : queue ? 'queue' : external ? 'external' : 'service';
    const node: Node = { key: e.key, id: e.ident?.split('.').pop() ?? e.name, label: e.name, tech: e.tech, description: e.description, type, refine: store ? DATASTORE : queue ? QUEUE : undefined };
    out.nodes.push(node);
    // A group inside a system sits in that system's box.
    const box = e.group ?? (e.parent && hasContainers.has(e.parent) ? `system:${e.parent}` : undefined);
    if (box) out.member.set(e.key, box);
  }
  const components = [...els.values()].filter((e) => e.kind === 'component').length;
  if (components) out.leftOut.push(`${components} component${components > 1 ? 's' : ''} (drawn as their containers)`);

  let toBoxes = 0;
  const line = (r: Rel) => {
    const [a, b] = [resolve(r.from, r.scope), resolve(r.to, r.scope)];
    const [from, to] = [a && shown(a), b && shown(b)];
    if (!from || !to) return void (a && b ? toBoxes++ : out.leftOut.push(`${r.from} → ${r.to} (unknown element)`));
    if (from !== to) return { from, to };
  };
  for (const r of rels) {
    const ends = line(r);
    if (ends) out.edges.push({ ...ends, label: r.label, async: r.tags.some((t) => /async/i.test(t)) });
  }
  if (toBoxes) out.leftOut.push(`${toBoxes} relationship${toBoxes > 1 ? 's' : ''} with a software system drawn as a box (its containers carry them)`);
  for (const v of dynamics) {
    const path: string[] = [];
    for (const s of v.steps) {
      const ends = line(s);
      if (!ends) continue;
      // A step with no relationship of its own still needs a line for the flow to follow.
      if (!out.edges.some((e) => (e.from === ends.from && e.to === ends.to) || (e.from === ends.to && e.to === ends.from))) out.edges.push({ ...ends, label: s.label, async: false });
      if (path.at(-1) !== ends.from) path.push(ends.from);
      path.push(ends.to);
    }
    if (path.length > 1) out.flows.push({ title: v.title, path });
  }
  if (skipped.length) out.leftOut.push(`${skipped.length > 1 ? 'lines' : 'line'} ${skipped.join(', ')} (can’t be read)`);
  return out;
}
