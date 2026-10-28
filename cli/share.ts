// Writes a design as one self-contained HTML file that opens anywhere, read-only:
//   npm run build && node cli/share.ts <design id> [out.html]
import fs from 'node:fs/promises';
import { shareHtml } from '../server/share.ts';

const [id, out = `${id}.html`] = process.argv.slice(2);
try {
  if (!id) throw new Error('usage: node cli/share.ts <design id> [out.html]');
  await fs.writeFile(out, await shareHtml(id));
  console.log(`Wrote ${out}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
