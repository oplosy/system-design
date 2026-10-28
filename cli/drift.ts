// Checks a design against the infrastructure it describes, for CI:
//   node cli/drift.ts <design id or .json path> <infra file> [--write] [--markdown]
// Exits 1 when the design differs (parts or lines it lacks, imported parts the infrastructure dropped), 0 when not, 2 on error.
// --write brings the design in line as one unseen step for review (design id only).
// --markdown prints the report as Markdown, for a pull request comment or a job summary.
import fs from 'node:fs/promises';
import path from 'node:path';
import { infraDrift, syncInfra } from '../core/infra.ts';
import { parseDesign } from '../core/schema.ts';
import { readDesign, updateDesign } from '../core/store.ts';
import { guessType } from '../src/shapes.ts';

const args = process.argv.slice(2);
const write = args.includes('--write');
const markdown = args.includes('--markdown');
const [design, infraFile] = args.filter((a) => !a.startsWith('--'));
// Names come from files under review, so they are shown as code and can't add links or mentions.
const code = (s: string) => `\`${s.replace(/`/g, "'").replace(/\|/g, '\\|')}\``;

try {
  if (!design || !infraFile) throw new Error('usage: system-design drift <design id or .json path> <infra file> [--write] [--markdown]');
  const byPath = design.endsWith('.json');
  if (write && byPath) throw new Error('--write needs a design id from the designs folder, not a file path');
  const text = await fs.readFile(infraFile, 'utf8');
  const d = byPath ? parseDesign(JSON.parse(await fs.readFile(design, 'utf8'))) : await readDesign(design);
  const drift = infraDrift(d, text, guessType);
  const rows: [string, string[], string][] = [
    ['+ part', drift.components, ''],
    ['+ line', drift.connections, ''],
    ['+ boundary', drift.boundaries, ''],
    ['- part', drift.removed, ' (no longer in the infrastructure)'],
    ['~ line', drift.updated, ''],
    ['~ part', drift.described, ' (description)'],
    ['+ flow', drift.flows, ''],
  ];
  if (markdown) {
    console.log(drift.drifted ? `### ⚠️ ${code(infraFile)} differs from the design ${code(d.title)}\n` : `### ✅ ${code(infraFile)} matches the design ${code(d.title)}`);
    if (drift.drifted) {
      console.log('| | |\n|---|---|');
      for (const [what, items, note] of rows) for (const x of items) console.log(`| ${what} | ${code(x)}${note} |`);
      console.log(`\nRun \`system-design drift ${d.id} ${infraFile} --write\` to add the difference to the design as a step for review.`);
    }
  } else if (!drift.drifted) console.log(`${d.id}: matches ${infraFile}`);
  else {
    console.log(`${d.id}: differs from ${infraFile}`);
    for (const [what, items, note] of rows) for (const x of items) console.log(`  ${what} ${x}${note}`);
  }
  if (drift.drifted && write) {
    let step: string | undefined;
    await updateDesign(d.id, (x) => {
      step = syncInfra(x, text, `Sync with ${path.basename(infraFile)}`, guessType);
    });
    console.log(`Added step "${step}" for review.`);
  }
  process.exit(drift.drifted ? 1 : 0);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
