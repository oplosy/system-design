import type { ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';

// Reads a Mermaid flowchart (the subset diagrams use in practice) into components, connections and boundaries.
// Styling lines are ignored; a line that cannot be read is reported, not guessed at.

type Node = { key: string; label?: string; type?: ComponentType };
type Group = { key: string; label: string; parent?: string };
type Edge = { from: string; to: string; label?: string; async: boolean };

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

const ID = /^[\p{L}\p{N}_.]+/u;
// Arrows: -->, ---, ==>, -.->, --o, --x and longer forms, with an optional |label| after; or a label inside: -- text -->.
const INLINE = /^(--|==|-\.)\s+(.+?)\s+(-{2,}[>ox]|={2,}>|\.-+>|-{3,}|={3,}|\.-+)/;
const ARROW = /^<?(-{2,}[>ox]|={2,}[>ox]?|-\.+->|-\.+-|-{3,}|={3,})/;

const unquote = (s: string) => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t).replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, ' ').trim();
};

export function parseMermaid(text: string) {
  const nodes = new Map<string, Node>();
  const groups: Group[] = [];
  const edges: Edge[] = [];
  const skipped: number[] = [];
  const stack: string[] = [];
  const member = new Map<string, string>();
  let header = false;

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/%%.*$/, '').replace(/;\s*$/, '').trim();
    if (!line) return;
    if (!header) {
      if (!/^(flowchart|graph)\b/.test(line)) throw new Error(`Line ${i + 1}: only Mermaid flowcharts ("flowchart LR" or "graph TD") can be imported.`);
      header = true;
      return;
    }
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/.test(line)) return;
    const sub = /^subgraph\s+(.+)$/.exec(line);
    if (sub) {
      const body = sub[1].trim();
      const named = /^([\p{L}\p{N}_.]+)\s*\[(.+)\]$/u.exec(body);
      const key = named ? named[1] : body.startsWith('"') ? `group-${groups.length + 1}` : body.split(/\s+/)[0];
      groups.push({ key, label: unquote(named ? named[2] : body), parent: stack.at(-1) });
      stack.push(key);
      return;
    }
    if (line === 'end') {
      if (stack.length) stack.pop();
      else skipped.push(i + 1);
      return;
    }
    if (!readChain(line)) skipped.push(i + 1);
  });
  if (!header) throw new Error('This is empty: paste a Mermaid flowchart.');

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
    for (const n of seen) {
      const node = nodes.get(n.key) ?? { key: n.key };
      if (n.label !== undefined) Object.assign(node, { label: n.label, type: n.type });
      nodes.set(n.key, node);
      if (stack.length && !member.has(n.key)) member.set(n.key, stack.at(-1)!);
    }
    edges.push(...found);
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

  return { nodes: [...nodes.values()], groups, member, edges, skipped };
}

/**
 * Adds a parsed flowchart to `step` of a design. A node's "Label (Tech)" splits into label and technology,
 * and `guess` may pick a better type from them (e.g. "PostgreSQL" → SQL DB) for plain boxes.
 */
export function importMermaid(d: Design, text: string, { step, guess }: { step?: string; guess?: (words: string) => ComponentType | undefined } = {}) {
  const parsed = parseMermaid(text);
  if (!parsed.nodes.length) throw new Error('No nodes found in this flowchart.');
  const at = { step, reopen: false };
  const boundaryIds = new Map<string, string>();
  for (const g of parsed.groups) {
    boundaryIds.set(g.key, m.addBoundary(d, { kind: 'group', label: g.label, parent: g.parent && boundaryIds.get(g.parent), id: g.key, ...at }));
  }
  const ids = new Map<string, string>();
  for (const n of parsed.nodes) {
    const text = n.label ?? n.key;
    const split = /^(.+?)\s*\(([^()]+)\)$/.exec(text);
    const [label, tech] = split ? [split[1], split[2]] : [text, undefined];
    const plain = !n.type || n.type === 'service';
    const type = (plain && guess?.(`${tech ?? ''} ${label}`)) || n.type || 'service';
    const boundary = parsed.member.get(n.key);
    ids.set(n.key, m.addComponent(d, { id: n.key, type, label, tech, boundary: boundary && boundaryIds.get(boundary), ...at }));
  }
  for (const e of parsed.edges) m.connect(d, { from: ids.get(e.from)!, to: ids.get(e.to)!, label: e.label, async: e.async || undefined, ...at });
  return { components: parsed.nodes.length, connections: parsed.edges.length, boundaries: parsed.groups.length, skipped: parsed.skipped };
}
