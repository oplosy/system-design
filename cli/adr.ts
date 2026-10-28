// Keeps a repo's architecture decision records and a design's decisions together:
//   node cli/adr.ts <design id or .json path> <folder>      writes one Markdown file per decision (e.g. docs/adr)
//   node cli/adr.ts <design id> <folder> --read             adds the folder's other records as decisions, as one step for review
import fs from 'node:fs/promises';
import { importAdrsAsStep, loadAdrs, saveAdrs } from '../core/adr.ts';
import { parseDesign } from '../core/schema.ts';
import { readDesign, updateDesign } from '../core/store.ts';

const args = process.argv.slice(2);
const read = args.includes('--read');
const [design, folder] = args.filter((a) => !a.startsWith('--'));

try {
  if (!design || !folder) throw new Error('usage: system-design adr <design id or .json path> <folder> [--read]');
  const byPath = design.endsWith('.json');
  if (read) {
    if (byPath) throw new Error('--read needs a design id from the designs folder, not a file path');
    const files = await loadAdrs(folder);
    let added: string[] = [];
    await updateDesign(design, (d) => void ({ added } = importAdrsAsStep(d, files)));
    console.log(`Added ${added.length} decisions as a step for review: ${added.join(', ')}`);
  } else {
    const d = byPath ? parseDesign(JSON.parse(await fs.readFile(design, 'utf8'))) : await readDesign(design);
    const written = await saveAdrs(d, folder);
    console.log(written.length ? `Wrote ${written.join(', ')}` : `${folder} is up to date`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
