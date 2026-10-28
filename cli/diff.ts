// What a change to a design file adds and removes, step by step, for a pull request:
//   node cli/diff.ts <before.json> <after.json> [--markdown]
// A missing or empty before file means the design is new. Always exits 0 unless a file can't be read (2).
import fs from 'node:fs/promises';
import { parseDesign, type Design } from '../core/schema.ts';

const args = process.argv.slice(2);
const markdown = args.includes('--markdown');
const [beforeFile, afterFile] = args.filter((a) => !a.startsWith('--'));
const code = (s: string) => (markdown ? `\`${s.replace(/`/g, "'")}\`` : s);

/** Added and removed items between two versions of a design, the added ones grouped by the step that holds them. */
function designDiff(before: Design | undefined, after: Design) {
  const had = (kind: 'components' | 'connections' | 'decisions', id: string) => !!before?.[kind].some((x) => x.id === id);
  const label = (d: Design, id: string) => d.components.find((c) => c.id === id)?.label ?? id;
  const line = (d: Design, c: Design['connections'][number]) => `${label(d, c.from)} → ${label(d, c.to)}${c.label ? ` (${c.label})` : ''}`;
  const steps = after.steps
    .map((s) => ({
      title: s.title,
      summary: s.summary,
      isNew: !before?.steps.some((b) => b.id === s.id),
      parts: after.components.filter((c) => c.step === s.id && !had('components', c.id)).map((c) => `${c.label} (${c.type})`),
      lines: after.connections.filter((c) => c.step === s.id && !had('connections', c.id)).map((c) => line(after, c)),
      decisions: after.decisions.filter((c) => c.step === s.id && !had('decisions', c.id)).map((c) => c.title),
    }))
    // A new step that adds nothing and says nothing (a design's empty "Start") isn't worth a line.
    .filter((s) => (s.isNew && s.summary) || s.parts.length || s.lines.length || s.decisions.length);
  const removed = before
    ? [
        ...before.components.filter((c) => !after.components.some((x) => x.id === c.id)).map((c) => `part ${c.label}`),
        ...before.connections.filter((c) => !after.connections.some((x) => x.id === c.id)).map((c) => `line ${line(before, c)}`),
      ]
    : [];
  return { steps, removed };
}

const read = async (file: string) => {
  const text = await fs.readFile(file, 'utf8').catch((e) => (e.code === 'ENOENT' ? '' : Promise.reject(e)));
  return text.trim() ? parseDesign(JSON.parse(text)) : undefined;
};

try {
  if (!beforeFile || !afterFile) throw new Error('usage: system-design diff <before.json> <after.json> [--markdown]');
  const [before, after] = [await read(beforeFile), await read(afterFile)];
  if (!after) throw new Error(`${afterFile} is empty`);
  const { steps, removed } = designDiff(before, after);
  const head = !before ? 'is new' : steps.length || removed.length ? 'changes' : 'has no new parts, lines, decisions or steps';
  console.log(markdown ? `### 📐 The design ${code(after.title)} ${head}\n` : `${after.id}: ${head}`);
  for (const s of steps) {
    console.log(markdown ? `**${s.isNew ? 'New step' : 'Step'}: ${code(s.title)}**${s.summary ? `\n${s.summary.replace(/\n+/g, ' ').replace(/@/g, '@​')}` : ''}\n` : `  ${s.isNew ? 'new step' : 'step'} ${s.title}`);
    for (const [what, items] of [['part', s.parts], ['line', s.lines], ['decision', s.decisions]] as const) {
      for (const x of items) console.log(markdown ? `- + ${what} ${code(x)}` : `    + ${what} ${x}`);
    }
    if (markdown) console.log('');
  }
  for (const r of removed) console.log(markdown ? `- − ${code(r)}` : `  - ${r}`);
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
