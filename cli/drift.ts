// Checks a design against the infrastructure it describes, for CI:
//   node cli/drift.ts <design id or .json path> <docker-compose / k8s YAML / terraform show -json file> [--write]
// Exits 1 when the design differs (parts or lines it lacks, imported parts the infrastructure dropped), 0 when not, 2 on error.
// --write brings the design in line as one unseen step for review (design id only).
import fs from 'node:fs/promises';
import path from 'node:path';
import { infraDrift, syncInfra } from '../core/infra.ts';
import { parseDesign } from '../core/schema.ts';
import { readDesign, updateDesign } from '../core/store.ts';
import { guessType } from '../src/shapes.ts';

const args = process.argv.slice(2);
const write = args.includes('--write');
const [design, infraFile] = args.filter((a) => a !== '--write');

try {
  if (!design || !infraFile) throw new Error('usage: node cli/drift.ts <design id or .json path> <infra file> [--write]');
  const byPath = design.endsWith('.json');
  if (write && byPath) throw new Error('--write needs a design id from the designs folder, not a file path');
  const text = await fs.readFile(infraFile, 'utf8');
  const d = byPath ? parseDesign(JSON.parse(await fs.readFile(design, 'utf8'))) : await readDesign(design);
  const drift = infraDrift(d, text, guessType);
  if (!drift.drifted) {
    console.log(`${d.id}: matches ${infraFile}`);
    process.exit(0);
  }
  console.log(`${d.id}: differs from ${infraFile}`);
  for (const c of drift.components) console.log(`  + part ${c}`);
  for (const c of drift.connections) console.log(`  + line ${c}`);
  for (const b of drift.boundaries) console.log(`  + boundary ${b}`);
  for (const r of drift.removed) console.log(`  - part ${r} (no longer in the infrastructure)`);
  if (write) {
    let step: string | undefined;
    await updateDesign(d.id, (x) => {
      step = syncInfra(x, text, `Sync with ${path.basename(infraFile)}`, guessType);
    });
    console.log(`Added step "${step}" for review.`);
  }
  process.exit(1);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
