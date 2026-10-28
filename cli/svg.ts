// Writes a design as an SVG picture, and optionally a status badge, to commit next to a README:
//   node cli/svg.ts <design id or .json path> <out.svg> [--badge <badge.svg>] [--infra <infra file>]
// Re-run it in CI (or a pre-commit hook) so the picture follows the design. With --infra the badge says whether the
// design matches that infrastructure, else how many parts it has and how many steps wait for review.
import fs from 'node:fs/promises';
import { infraDrift } from '../core/infra.ts';
import { parseDesign } from '../core/schema.ts';
import { readDesign } from '../core/store.ts';
import { guessType } from '../src/shapes.ts';
import { badgeSvg, designSvg } from './render.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a file`);
  args.splice(i, 2);
  return value;
};

try {
  const badge = flag('--badge');
  const infra = flag('--infra');
  const [design, out] = args;
  if (!design || !out) throw new Error('usage: system-design svg <design id or .json path> <out.svg> [--badge <badge.svg>] [--infra <infra file>]');
  const d = design.endsWith('.json') ? parseDesign(JSON.parse(await fs.readFile(design, 'utf8'))) : await readDesign(design);
  await fs.writeFile(out, await designSvg(d));
  console.log(`Wrote ${out}`);
  if (badge) {
    let value: string, color: string;
    if (infra) {
      const drift = infraDrift(d, await fs.readFile(infra, 'utf8'), guessType);
      const n = drift.components.length + drift.connections.length + drift.boundaries.length + drift.removed.length + drift.updated.length;
      [value, color] = drift.drifted ? [`${n || 'some'} drifted`, '#d4731f'] : ['in sync', '#2f9e44'];
    } else {
      const waiting = d.steps.filter((s) => !s.seen).length;
      [value, color] = [`${d.components.length} parts${waiting ? ` · ${waiting} to review` : ''}`, waiting ? '#d4731f' : '#3f7fd9'];
    }
    await fs.writeFile(badge, badgeSvg('design', value, color));
    console.log(`Wrote ${badge}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
