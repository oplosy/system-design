import type { BoundaryKind, ComponentType } from './schema.ts';
import type { Diagram, Node } from './diagram.ts';
import { DATASTORE, QUEUE } from './interop.ts';

// Reads a draw.io (diagrams.net) file, or shapes copied out of draw.io, into parts, lines and boxes. Shapes become
// parts, typed from their icon (AWS, Azure, GCP, Kubernetes libraries) or their shape (actor, cylinder); a shape that
// holds others, by nesting or by drawing them inside it, becomes a boundary; arrows between parts become lines.
// Positions are kept, so the drawing keeps its arrangement.

type Rect = { x: number; y: number; w: number; h: number };
type Cell = { id: string; raw: string; style: Record<string, string>; shape: string; parent?: string; vertex: boolean; edge: boolean; source?: string; target?: string; geo?: Rect; tooltip?: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? all)));
const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));

/** Whether `text` is a draw.io file or shapes copied from draw.io (possibly still compressed or URI-encoded). */
export function isDrawio(text: string) {
  return /^\s*(<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)\b/.test(text) || /^\s*%3CmxGraphModel/i.test(text);
}

/** Undoes what draw.io may do to its XML: URI-encoding (its clipboard) and compressed pages (older files, Confluence). */
export async function expandDrawio(text: string) {
  let t = text.trim();
  if (/^%3C/i.test(t)) t = decodeURIComponent(t);
  for (const [whole, data] of [...t.matchAll(/<diagram\b[^>]*>([^<]+)<\/diagram>/g)]) {
    const bytes = Uint8Array.from(atob(data.trim()), (c) => c.charCodeAt(0));
    const xml = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    t = t.replace(whole, whole.replace(data, decodeURIComponent(xml)));
  }
  return t;
}

/** Icon names the type guesser can't read on its own (too short, or a generic last word). */
const ICONS: Record<string, ComponentType> = {
  s3: 'object-storage',
  'simple storage service': 'object-storage',
  bucket: 'object-storage',
  'internet gateway': 'internet',
  'nat gateway': 'nat-gateway',
  users: 'user',
  'route 53': 'dns',
  'cosmos db': 'nosql-db',
  'front doors': 'cdn',
  'app services': 'service',
};
const GROUPS: [RegExp, BoundaryKind][] = [
  [/vpc|virtual network/, 'vpc'],
  [/region/, 'region'],
  [/availability zone/, 'zone'],
  [/subnet|security group/, 'subnet'],
  [/data ?center|on premise/, 'datacenter'],
  [/auto scaling|cluster/, 'cluster'],
];

/** The product an icon shows, as words: mxgraph.aws4.lambda_function → "lambda function". */
function iconWords(s: Record<string, string>) {
  const icon = s.resIcon ?? s.prIcon ?? (s.shape?.startsWith('mxgraph.') && !/\.(resourceIcon|productIcon|group)$/.test(s.shape) ? s.shape : undefined) ?? s.image?.split('/').pop()?.replace(/\.\w+$/, '');
  if (!icon) return undefined;
  return icon
    .split('.')
    .pop()!
    .replace(/^\d+[-_]/, '')
    .replace(/icon[-_]service[-_]/i, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    // Trailing qualifiers ("rds instance", "vpc2", "lambda alt") would outweigh the product name when guessing.
    .replace(/(\s+(instances?|alt|alternate|icon)|(?<=[a-z]{3})\d+)+$/, '')
    .trim();
}

/** A cell's text: the first line is its label; an italic line after it (as our export writes) its technology. */
function text(html: string) {
  const tech = /<br\s*\/?>\s*<i>(.*?)<\/i>/i.exec(html)?.[1];
  const lines = html
    .replace(/<br\s*\/?>\s*<i>.*?<\/i>/i, '')
    .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => decode(l).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { label: lines[0], description: lines.slice(1).join(' ') || undefined, tech: tech && decode(tech.replace(/<[^>]+>/g, '')).trim() };
}

export function readDrawio(xml: string): Diagram {
  const leftOut: string[] = [];
  const pages = [...xml.matchAll(/<diagram\b[^>]*>/g)].length;
  if (/<diagram\b[^>]*>[^<\s]/.test(xml)) throw new Error('This draw.io file is compressed; open it in draw.io and save it again, or paste it here instead of typing it.');
  if (pages > 1) leftOut.push(`${pages - 1} more page${pages > 2 ? 's' : ''} (only the first is read)`);
  const first = xml.indexOf('</diagram>') > 0 ? xml.slice(0, xml.indexOf('</diagram>')) : xml;

  // A flat walk over the tags: draw.io writes cells as <mxCell>, wrapped in <object>/<UserObject> when they carry data.
  const cells: Cell[] = [];
  let wrapper: Record<string, string> | null = null;
  let open: Cell | null = null;
  for (const [, close, tag, body, self] of first.matchAll(/<(\/?)([\w:]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
    if (tag === 'object' || tag === 'UserObject') wrapper = close ? null : attrs(body);
    else if (tag === 'mxCell' && close) open = null;
    else if (tag === 'mxCell') {
      const a = attrs(body);
      const style: Record<string, string> = {};
      let shape = '';
      for (const part of (a.style ?? '').split(';').filter(Boolean)) {
        const [k, v] = part.split('=');
        if (v === undefined && !shape) shape = k;
        style[k] = v ?? '1';
      }
      const cell: Cell = {
        id: wrapper?.id ?? a.id,
        raw: wrapper?.label ?? a.value ?? '',
        style,
        shape: style.shape ?? shape,
        parent: a.parent,
        vertex: a.vertex === '1',
        edge: a.edge === '1',
        source: a.source,
        target: a.target,
        tooltip: wrapper?.tooltip,
      };
      cells.push(cell);
      open = self ? null : cell;
    } else if (tag === 'mxGeometry' && open && !close) {
      const a = attrs(body);
      if (a.as === 'geometry') open.geo = { x: Number(a.x ?? 0), y: Number(a.y ?? 0), w: Number(a.width ?? 0), h: Number(a.height ?? 0) };
    }
  }
  if (!cells.length) throw new Error('No shapes found in this draw.io file.');

  const byId = new Map(cells.map((c) => [c.id, c]));
  // Child geometry is relative to a parent shape (not to a layer).
  const abs = (c: Cell): Rect => {
    const p = c.parent ? byId.get(c.parent) : undefined;
    const base = p?.vertex ? abs(p) : { x: 0, y: 0 };
    return { x: base.x + (c.geo?.x ?? 0), y: base.y + (c.geo?.y ?? 0), w: c.geo?.w ?? 0, h: c.geo?.h ?? 0 };
  };
  const isLabel = (c: Cell) => !!c.style.edgeLabel || !!(c.parent && byId.get(c.parent)?.edge);
  const shapes = cells.filter((c) => c.vertex && !isLabel(c) && c.shape !== 'text' && c.shape !== 'group');
  const rect = new Map(shapes.map((c) => [c.id, abs(c)]));
  const within = (a: Rect, b: Rect) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && a.w * a.h < b.w * b.h;
  const groupish = (c: Cell) => c.shape.startsWith('mxgraph.aws4.group') || c.style.container === '1' || c.shape === 'swimlane' || !!c.style.grIcon;
  const boxes = new Set(
    shapes
      .filter((c) => groupish(c) || shapes.some((o) => o.parent === c.id) || (!iconWords(c.style) && shapes.some((o) => within(rect.get(o.id)!, rect.get(c.id)!))))
      .map((c) => c.id),
  );
  // The innermost box around a shape: its nearest boxed ancestor, else the smallest box drawn around it.
  const boxOf = (c: Cell) => {
    for (let p = c.parent && byId.get(c.parent); p; p = p.parent ? byId.get(p.parent) : undefined) if (boxes.has(p.id)) return p.id;
    const r = rect.get(c.id)!;
    return [...boxes]
      .filter((b) => b !== c.id && within(r, rect.get(b)!))
      .sort((a, b) => rect.get(a)!.w * rect.get(a)!.h - rect.get(b)!.w * rect.get(b)!.h)[0];
  };

  const out: Diagram = { nodes: [], groups: [], member: new Map(), edges: [], flows: [], leftOut };
  // Outer boxes first, so a box's parent exists before it.
  const depth = (id: string): number => {
    const p = boxOf(byId.get(id)!);
    return p ? 1 + depth(p) : 0;
  };
  for (const id of [...boxes].sort((a, b) => depth(a) - depth(b))) {
    const c = byId.get(id)!;
    const words = (iconWords({ resIcon: c.style.grIcon ?? '' }) ?? '').replace(/^group\s*/, '');
    const label = text(c.raw).label ?? (words || 'Group');
    out.groups.push({ key: id, id: label, label, parent: boxOf(c), kind: GROUPS.find(([re]) => re.test(`${words} ${label.toLowerCase()}`))?.[1] ?? 'group' });
  }
  let unnamed = 0;
  for (const c of shapes.filter((x) => !boxes.has(x.id))) {
    const words = iconWords(c.style);
    const t = text(c.raw);
    const label = t.label ?? (words && words.replace(/\b\w/g, (ch) => ch.toUpperCase()));
    if (!label) {
      unnamed++;
      continue;
    }
    const r = rect.get(c.id)!;
    const queue = /^(south|north)$/.test(c.style.direction ?? '');
    const node: Node = {
      key: c.id,
      id: label,
      label,
      tech: t.tech,
      description: t.description ?? c.tooltip,
      // Kept by its centre, as our parts are drawn at 160 × 70.
      position: { x: r.x + r.w / 2 - 80, y: r.y + r.h / 2 - 35 },
    };
    if (words && ICONS[words]) node.type = ICONS[words];
    else if (words) node.hint = words;
    else if (/actor|person/i.test(c.shape)) node.type = 'user';
    else if (/cylinder|database|datastore/i.test(c.shape)) Object.assign(node, queue ? { type: 'queue', refine: QUEUE } : { type: 'sql-db', refine: DATASTORE });
    else if (c.shape === 'cloud') node.type = 'internet';
    out.nodes.push(node);
    const box = boxOf(c);
    if (box) out.member.set(c.id, box);
  }
  if (unnamed) leftOut.push(`${unnamed} shape${unnamed > 1 ? 's' : ''} with no name`);

  const nodeIds = new Set(out.nodes.map((n) => n.key));
  // An arrow may end on a shape's inner part; it belongs to the nearest shape around it.
  const end = (id: string | undefined) => {
    for (let c = id ? byId.get(id) : undefined; c; c = c.parent ? byId.get(c.parent) : undefined) if (nodeIds.has(c.id) || boxes.has(c.id)) return c.id;
  };
  let loose = 0, toBox = 0;
  for (const e of cells.filter((c) => c.edge)) {
    const [a, b] = [end(e.source), end(e.target)];
    if (!a || !b) {
      loose++;
      continue;
    }
    if (boxes.has(a) || boxes.has(b)) {
      toBox++;
      continue;
    }
    const label = text(e.raw).label ?? cells.filter((c) => c.parent === e.id && c.raw).map((c) => text(c.raw).label)[0];
    // An arrowhead only at the start points the line the other way.
    const back = e.style.endArrow === 'none' && !!e.style.startArrow && e.style.startArrow !== 'none';
    out.edges.push({ from: back ? b : a, to: back ? a : b, label, async: e.style.dashed === '1' });
  }
  if (loose) leftOut.push(`${loose} line${loose > 1 ? 's' : ''} not attached at both ends`);
  if (toBox) leftOut.push(`${toBox} line${toBox > 1 ? 's' : ''} to a box rather than a part`);
  return out;
}
