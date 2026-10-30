// Git merge driver for design files: two branches that both changed a design merge item by item, instead of always
// clashing on `rev`. Git passes the base, ours and theirs files, and takes the result from ours:
//   system-design merge %O %A %B
// A clash exits 1 and leaves the file alone, so git reports a conflict for a person to settle.
import fs from 'node:fs/promises';
import { mergeFiles } from '../core/merge.ts';

const [base, ours, theirs] = process.argv.slice(2);
try {
  if (!base || !ours || !theirs) throw new Error('usage: system-design merge <base> <ours> <theirs>');
  const result = mergeFiles(...((await Promise.all([base, ours, theirs].map((f) => fs.readFile(f, 'utf8')))) as [string, string, string]));
  if (result.clashes.length) throw new Error(`both sides changed: ${result.clashes.join(', ')}`);
  await fs.writeFile(ours, result.text);
} catch (e) {
  console.error(`system-design merge: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
