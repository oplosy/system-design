import fs from 'node:fs/promises';
import path from 'node:path';
import type { Design } from './schema.ts';
import * as m from './mutations.ts';

// Decisions as architecture decision records: one Markdown file per decision in a repo's docs/adr folder, and back.
// Written files carry a marker, so writing again updates the same file and reading skips what the design has.

export type AdrFile = { name: string; text: string };

const marker = (d: Design, id: string) => `<!-- system-design: ${d.id}/${id} -->`;
const MARKER = /<!-- system-design: ([a-z0-9-]+)\/([a-z0-9-]+) -->/;

/** The files to write for `d`'s decisions, numbered after the folder's existing records; unchanged files are left out. */
export function toAdrs(d: Design, existing: AdrFile[]): AdrFile[] {
  const label = (id: string) => d.components.find((c) => c.id === id)?.label ?? id;
  let next = Math.max(0, ...existing.map((f) => Number(/^(\d+)/.exec(f.name)?.[1] ?? 0))) + 1;
  const out: AdrFile[] = [];
  for (const x of d.decisions) {
    const own = existing.find((f) => f.text.includes(marker(d, x.id)));
    const n = d.steps.findIndex((s) => s.id === x.step);
    const text = [
      `# ${x.title}`,
      '',
      '- Status: accepted',
      `- Design: ${d.title}, step ${String(n + 1).padStart(2, '0')} · ${d.steps[n]?.title ?? x.step}`,
      ...(x.links.length ? [`- Affects: ${x.links.map(label).join(', ')}`] : []),
      '',
      '## Context and decision',
      '',
      x.why,
      '',
      ...(x.alternatives?.length ? ['## Considered options', '', `- ${x.title} (chosen)`, ...x.alternatives.map((a) => `- ${a}`), ''] : []),
      ...(x.tradeoffs ? ['## Consequences', '', x.tradeoffs, ''] : []),
      marker(d, x.id),
      '',
    ].join('\n');
    if (own && own.text === text) continue;
    out.push({ name: own?.name ?? `${String(next++).padStart(4, '0')}-${m.slugify(x.title).slice(0, 60)}.md`, text });
  }
  return out;
}

const SECTIONS: [RegExp, 'context' | 'decision' | 'options' | 'consequences' | 'status'][] = [
  [/^status/i, 'status'],
  [/^context/i, 'context'],
  [/^decision/i, 'decision'],
  [/^(considered )?options|^alternatives/i, 'options'],
  [/^consequences|^pros and cons|^trade-?offs/i, 'consequences'],
];

/** One record in the common shapes (Nygard's, MADR): title, status, context, decision, options, consequences. */
export function readAdr(text: string) {
  const title = /^#\s+(?:\d+[.:]?\s+)?(.+)$/m.exec(text)?.[1].trim();
  const parts: Record<string, string> = {};
  let at: string | undefined;
  for (const line of text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const h = /^#{2,3}\s+(.+)$/.exec(line);
    if (h) at = SECTIONS.find(([re]) => re.test(h[1].trim()))?.[1] ?? (line.startsWith('###') ? at : undefined);
    else if (at) parts[at] = `${parts[at] ?? ''}${line}\n`;
  }
  // MADR keeps the status as a list item ("- Status: accepted") or front matter ("status: accepted").
  const status = (parts.status ?? /^[-*]?\s*status:\s*(.+)$/im.exec(text)?.[1] ?? '').trim().split(/\s/)[0]?.toLowerCase() ?? '';
  const bullets = (s = '') => [...s.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((x) => x[1].replace(/\*\*/g, '').trim());
  const options = bullets(parts.options).filter((o) => !/\(chosen\)$/i.test(o) && o.toLowerCase() !== title?.toLowerCase());
  const why = [parts.context, parts.decision].map((s) => s?.trim()).filter(Boolean).join('\n\n');
  return { title, status, why, alternatives: options, tradeoffs: parts.consequences?.trim() || undefined, ours: MARKER.exec(text) };
}

/**
 * Adds the records in `files` to `step` of `d` as decisions, linked to the parts their text names. Records this design
 * wrote, rejected, deprecated or superseded ones, and files with no title or reasoning are left out and listed.
 */
export function importAdrs(d: Design, files: AdrFile[], { step }: { step?: string } = {}) {
  const added: string[] = [];
  const leftOut: string[] = [];
  const named = d.components.filter((c) => c.label.length >= 3);
  for (const f of files) {
    const r = readAdr(f.text);
    if (r.ours?.[1] === d.id || d.decisions.some((x) => x.title === r.title)) continue;
    if (!r.title || !r.why) {
      leftOut.push(`${f.name} (no title or context)`);
      continue;
    }
    if (/^(rejected|deprecated|superseded)/.test(r.status)) {
      leftOut.push(`${f.name} (${r.status})`);
      continue;
    }
    const words = `${r.title}\n${r.why}\n${r.tradeoffs ?? ''}`.toLowerCase();
    const links = named.filter((c) => new RegExp(`(^|[^a-z0-9])${c.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(words)).map((c) => c.id);
    m.addDecision(d, { title: r.title, why: r.why, alternatives: r.alternatives.length ? r.alternatives : undefined, tradeoffs: r.tradeoffs, links, step, reopen: false });
    added.push(r.title);
  }
  return { added, leftOut };
}

/** The Markdown files in a folder, in name order; none when it doesn't exist yet. */
export async function loadAdrs(folder: string): Promise<AdrFile[]> {
  const names = await fs.readdir(folder).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)));
  const md = names.filter((n) => n.toLowerCase().endsWith('.md') && !/^(readme|index|template)/i.test(n)).sort();
  return Promise.all(md.map(async (name) => ({ name, text: await fs.readFile(path.join(folder, name), 'utf8') })));
}

/** Writes `d`'s decisions into `folder` and returns the names of the files written. */
export async function saveAdrs(d: Design, folder: string) {
  const files = toAdrs(d, await loadAdrs(folder));
  await fs.mkdir(folder, { recursive: true });
  for (const f of files) await fs.writeFile(path.join(folder, f.name), f.text);
  return files.map((f) => f.name);
}

/** Adds the records the design lacks as one new step for review. Throws when there is nothing new. */
export function importAdrsAsStep(d: Design, files: AdrFile[], title = 'Import decision records') {
  const step = m.addStep(d, { title });
  const { added, leftOut } = importAdrs(d, files, { step });
  if (!added.length) throw new Error(`No decision records the design lacks.${leftOut.length ? ` Left out: ${leftOut.join(', ')}.` : ''}`);
  d.steps.find((s) => s.id === step)!.summary = `From the decision records: ${added.join(', ')}.${leftOut.length ? ` Left out: ${leftOut.join(', ')}.` : ''}`;
  return { step, added, leftOut };
}
