import { BOUNDARY_KINDS, type BoundaryKind, type ComponentType, type Design } from './schema.ts';
import { importDiagram, type Diagram, type Edge, type Node } from './diagram.ts';
import { DATASTORE, QUEUE } from './interop.ts';

// Reads Mermaid diagrams (the subset diagrams use in practice) into components, connections, boundaries and flows:
// flowcharts, sequence diagrams (whose messages become a flow), C4 diagrams (Mermaid's, and C4-PlantUML, which shares
// the macros) and architecture-beta. Styling lines are ignored; a line that cannot be read is reported, not guessed at.

type Parsed = Omit<Diagram, 'nodes' | 'leftOut'> & { nodes: Map<string, Node>; skipped: number[] };

export type MermaidKind = 'flowchart' | 'sequence' | 'c4' | 'architecture';
const HEADERS: [RegExp, MermaidKind][] = [
  [/^(flowchart|graph)\b/, 'flowchart'],
  [/^sequenceDiagram\b/, 'sequence'],
  [/^(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b|^@startuml\b/, 'c4'],
  [/^architecture-beta\b/, 'architecture'],
];

/** The text's lines with comments and front matter blanked, so reported line numbers stay true. */
function clean(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) lines.fill('', 0, end + 1);
  }
  return lines.map((l) => l.replace(/%%.*$/, '').replace(/;\s*$/, '').trim());
}

/** Which kind of Mermaid diagram `text` is, or undefined when it is not one this reads. */
export function mermaidKind(text: string) {
  const first = clean(text).find(Boolean);
  return first ? HEADERS.find(([re]) => re.test(first))?.[1] : undefined;
}

const ID = /^[\p{L}\p{N}_.]+/u;
// Arrows: -->, ---, ==>, -.->, --o, --x and longer forms, with an optional |label| after; or a label inside: -- text -->.
const INLINE = /^(--|==|-\.)\s+(.+?)\s+(-{2,}[>ox]|={2,}>|\.-+>|-{3,}|={3,}|\.-+)/;
const ARROW = /^<?(-{2,}[>ox]|={2,}[>ox]?|-\.+->|-\.+-|-{3,}|={3,})/;

/** Node shapes, longest opener first so `[(` wins over `[`. The type is a hint the caller may refine. */
const SHAPES: [string, string, ComponentType][] = [
  ['[(', ')]', 'sql-db'],
  ['([', '])', 'queue'],
  ['((', '))', 'user'],
  ['{{', '}}', 'api-gateway'],
  ['[/', '/]', 'external'],
  ['[\\', '\\]', 'external'],
  ['[/', '\\]', 'external'],
  ['[\\', '/]', 'external'],
  ['[', ']', 'service'],
  ['(', ')', 'service'],
  ['{', '}', 'choice'],
  ['>', ']', 'service'],
];

const unquote = (s: string) => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t).replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, ' ').trim();
};

export function parseMermaid(text: string) {
  const lines = clean(text);
  const start = lines.findIndex(Boolean);
  if (start < 0) throw new Error('This is empty: paste a Mermaid diagram.');
  const kind = HEADERS.find(([re]) => re.test(lines[start]))?.[1];
  if (!kind) throw new Error(`Line ${start + 1}: only Mermaid flowcharts, sequence, C4 and architecture-beta diagrams (or C4-PlantUML) can be imported.`);
  const out: Parsed = { nodes: new Map(), groups: [], member: new Map(), edges: [], flows: [], skipped: [] };
  ({ flowchart, sequence, c4, architecture })[kind](lines, start, out);
  return { kind, ...out, nodes: [...out.nodes.values()] };
}

/** Records a node, keeping what an earlier mention said unless this one says more. */
function note(out: Parsed, n: Node, group?: string) {
  const node = out.nodes.get(n.key) ?? { key: n.key };
  for (const [k, v] of Object.entries(n)) if (v !== undefined) Object.assign(node, { [k]: v });
  out.nodes.set(n.key, node);
  if (group && !out.member.has(n.key)) out.member.set(n.key, group);
}

function flowchart(lines: string[], start: number, out: Parsed) {
  const stack: string[] = [];
  lines.forEach((line, i) => {
    if (i <= start || !line) return;
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/.test(line)) return;
    const sub = /^subgraph\s+(.+)$/.exec(line);
    if (sub) {
      const body = sub[1].trim();
      const named = /^([\p{L}\p{N}_.]+)\s*\[(.+)\]$/u.exec(body);
      const key = named ? named[1] : body.startsWith('"') ? `group-${out.groups.length + 1}` : body.split(/\s+/)[0];
      out.groups.push({ key, label: unquote(named ? named[2] : body), parent: stack.at(-1) });
      stack.push(key);
      return;
    }
    if (line === 'end') {
      if (stack.length) stack.pop();
      else out.skipped.push(i + 1);
      return;
    }
    if (!readChain(line)) out.skipped.push(i + 1);
  });

  /** Reads `a[A] --> b & c -->|x| d`. Returns false when the line is not a node chain. */
  function readChain(line: string) {
    let rest = line;
    const found: Edge[] = [];
    // Nodes are kept aside until the whole line reads, so a bad line adds nothing.
    const seen: Node[] = [];
    let prev: string[] | null = null;
    let link: { label?: string; async: boolean } | null = null;
    for (;;) {
      const group: string[] = [];
      for (;;) {
        const key = readNode();
        if (!key) return false;
        group.push(key);
        rest = rest.trimStart();
        if (!rest.startsWith('&')) break;
        rest = rest.slice(1).trimStart();
      }
      if (prev && link) for (const a of prev) for (const b of group) found.push({ from: a, to: b, ...link });
      prev = group;
      rest = rest.trimStart();
      if (!rest) break;
      link = readLink();
      if (!link) return false;
    }
    for (const n of seen) note(out, n, stack.at(-1));
    out.edges.push(...found);
    return true;

    function readNode() {
      rest = rest.trimStart();
      const id = ID.exec(rest);
      if (!id) return null;
      const key = id[0];
      rest = rest.slice(key.length);
      const node: Node = { key };
      seen.push(node);
      const opened = SHAPES.some(([open]) => rest.startsWith(open));
      for (const [open, close, type] of SHAPES) {
        if (!rest.startsWith(open)) continue;
        const inner = rest.slice(open.length);
        // A quoted label may hold the closing bracket, so it ends at its closing quote.
        const end = inner.trimStart().startsWith('"') ? inner.indexOf(close, inner.indexOf('"', inner.indexOf('"') + 1)) : inner.indexOf(close);
        if (end < 0) continue;
        node.label = unquote(inner.slice(0, end));
        node.type = type;
        rest = inner.slice(end + close.length);
        return key;
      }
      return opened ? null : key;
    }

    function readLink() {
      const inline = INLINE.exec(rest);
      if (inline) {
        rest = rest.slice(inline[0].length);
        return { label: unquote(inline[2]), async: inline[1] === '-.' };
      }
      const arrow = ARROW.exec(rest);
      if (!arrow) return null;
      rest = rest.slice(arrow[0].length).trimStart();
      let label: string | undefined;
      const piped = /^\|([^|]*)\|/.exec(rest);
      if (piped) {
        label = unquote(piped[1]) || undefined;
        rest = rest.slice(piped[0].length);
      }
      return { label, async: arrow[1].includes('.') };
    }
  }
}

const PARTICIPANT = /^(participant|actor)\s+([\p{L}\p{N}_.]+)(?:@\{(.*)\})?(?:\s+as\s+(.+))?$/u;
const MESSAGE = /^([\p{L}\p{N}_.]+)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*([\p{L}\p{N}_.]+)\s*(?::(.*))?$/u;
const PARTICIPANT_TYPES: Record<string, ComponentType> = { database: 'sql-db', queue: 'queue', actor: 'user', collections: 'nosql-db' };

/** Participants become parts, calls become lines, and the messages one flow. */
function sequence(lines: string[], start: number, out: Parsed) {
  let title: string | undefined;
  const path: string[] = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/^create\s+/, '');
    if (i <= start || !line) return;
    const t = /^title\s*:?\s*(.+)$/.exec(line);
    if (t) return void (title = t[1].trim());
    const p = PARTICIPANT.exec(line);
    if (p) {
      const shape = /"type"\s*:\s*"(\w+)"/.exec(p[3] ?? '')?.[1];
      return note(out, { key: p[2], label: p[4] && unquote(p[4]), type: p[1] === 'actor' ? 'user' : shape ? PARTICIPANT_TYPES[shape] : undefined });
    }
    if (/^(autonumber|activate|deactivate|destroy|note|loop|alt|else|opt|par|par_over|and|critical|option|break|rect|box|end|links?|properties|details)\b/i.test(line)) return;
    const msg = MESSAGE.exec(line);
    if (!msg) return void out.skipped.push(i + 1);
    const [, from, arrow, to, said] = msg;
    note(out, { key: from });
    note(out, { key: to });
    if (from === to) return;
    // One line per pair of participants: a reply, or a call back, walks the line the first call drew.
    if (!out.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) {
      out.edges.push({ from, to, label: unquote(said ?? '') || undefined, async: arrow.endsWith(')') });
    }
    if (path.at(-1) !== from) path.push(from);
    path.push(to);
  });
  if (path.length > 1) out.flows.push({ title: title ?? 'Sequence diagram', path });
}

/** Splits macro arguments on commas outside quotes; named arguments ($tags=…) are dropped. */
function args(s: string) {
  const parts: string[] = [];
  let cur = '', quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) parts.push(cur), (cur = '');
    else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => !p.startsWith('$')).map(unquote);
}

/** C4 macros, as Mermaid and C4-PlantUML write them: people, systems, containers, components, boundaries and relations. */
function c4(lines: string[], start: number, out: Parsed) {
  const stack: string[] = [];
  lines.forEach((line, i) => {
    if (i <= start || !line) return;
    if (/^(title\b|!|@|'|skinparam\b|(Update\w+|Add\w+Tag|LAYOUT_\w+|SHOW_\w+|HIDE_\w+|Lay_\w+)\s*\()/.test(line)) return;
    if (line === '}') {
      if (stack.length) stack.pop();
      else out.skipped.push(i + 1);
      return;
    }
    const call = /^(\w+)\s*\((.*)\)\s*(\{)?$/.exec(line);
    if (!call) return void out.skipped.push(i + 1);
    const [, name, body, opens] = call;
    const a = args(body);
    const el = /^(Person|System|Container|Component)(Db|Queue)?(_Ext)?$/.exec(name);
    const box = /^(Enterprise_Boundary|System_Boundary|Container_Boundary|Boundary|Deployment_Node(?:_L|_R)?|Node(?:_L|_R)?)$/.exec(name);
    const rel = /^(Bi)?Rel(Index)?(_Back)?/.exec(name);
    if (el && a[0]) {
      const [, base, store, ext] = el;
      // Systems and people take (alias, label, description); containers and components (alias, label, technology, description).
      const techn = base === 'Container' || base === 'Component';
      const type: ComponentType = base === 'Person' ? 'user' : store === 'Db' ? 'sql-db' : store === 'Queue' ? 'queue' : ext ? 'external' : 'service';
      note(out, { key: a[0], label: a[1] || undefined, tech: techn ? a[2] || undefined : undefined, description: (techn ? a[3] : a[2]) || undefined, type, refine: store === 'Db' ? DATASTORE : store === 'Queue' ? QUEUE : undefined }, stack.at(-1));
    } else if (box && a[0] && opens) {
      const kind = name === 'Boundary' && (BOUNDARY_KINDS as readonly string[]).includes(a[2]) ? (a[2] as BoundaryKind) : /^(System|Container)_Boundary$/.test(name) ? 'system' : 'group';
      out.groups.push({ key: a[0], label: a[1] || a[0], parent: stack.at(-1), kind });
      stack.push(a[0]);
    } else if (rel && !opens) {
      const [from, to, label] = rel[2] ? a.slice(1) : a;
      if (!from || !to) return void out.skipped.push(i + 1);
      note(out, { key: from });
      note(out, { key: to });
      // "Uses" is the generic C4 verb (and what our own export writes for an unlabelled line), so it adds nothing.
      const said = label && !/^(uses|async)$/i.test(label) ? label : undefined;
      out.edges.push({ ...(rel[3] ? { from: to, to: from } : { from, to }), label: said, async: /^async$/i.test(label ?? '') });
    } else out.skipped.push(i + 1);
  });
}

const ICONS: Record<string, ComponentType> = { database: 'sql-db', disk: 'block-storage', internet: 'internet', cloud: 'cloud-provider', server: 'service' };

/** architecture-beta: groups, services and the edges between them. */
function architecture(lines: string[], start: number, out: Parsed) {
  const junctions = new Set<string>();
  lines.forEach((line, i) => {
    if (i <= start || !line) return;
    const item = /^(group|service)\s+([\w-]+)\s*(?:\(([^)]*)\))?\s*(?:\[(.*?)\])?\s*(?:in\s+([\w-]+))?$/.exec(line);
    if (item) {
      const [, what, key, icon = '', label, parent] = item;
      if (what === 'group') return void out.groups.push({ key, label: label || key, parent });
      // An iconify name (logos:aws-lambda) only hints at the type.
      return note(out, { key, label: label || undefined, type: ICONS[icon] ?? 'service', hint: icon.includes(':') ? icon.replace(/^[\w-]+:/, '').replace(/-/g, ' ') : undefined }, parent);
    }
    const j = /^junction\s+([\w-]+)/.exec(line);
    if (j) return void junctions.add(j[1]);
    const edge = /^([\w-]+)(?:\{group\})?\s*(?::\s*[LRTB])?\s*(<)?--(>)?\s*(?:[LRTB]\s*:)?\s*([\w-]+)(?:\{group\})?$/.exec(line);
    // shortcut: lines through junctions or to a whole group are reported, not resolved; resolve them when diagrams use them a lot.
    if (!edge || [edge[1], edge[4]].some((k) => junctions.has(k) || out.groups.some((g) => g.key === k))) return void out.skipped.push(i + 1);
    const [, a, back, fwd, b] = edge;
    note(out, { key: a });
    note(out, { key: b });
    out.edges.push(back && !fwd ? { from: b, to: a, async: false } : { from: a, to: b, async: false });
  });
}

/** Adds a Mermaid diagram to `step` of a design; see importDiagram. Returns what was added. */
export function importMermaid(d: Design, text: string, opts: { step?: string; guess?: (words: string) => ComponentType | undefined } = {}) {
  const { skipped, ...parsed } = parseMermaid(text);
  const lines = skipped.length > 1 ? `lines ${skipped.join(', ')}` : `line ${skipped[0]}`;
  return importDiagram(d, { ...parsed, leftOut: skipped.length ? [`${lines} (can’t be read)`] : [] }, opts);
}
