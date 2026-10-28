import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Design } from '../core/schema.ts';
import { NotFoundError, readDesign } from '../core/store.ts';

export const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

// Inline text must not close the tag it sits in.
const safe = (text: string, tag: string) => text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The design plus every design its parts open (drill-down), so links inside the shared copy keep working. */
async function withInsides(id: string) {
  const out = new Map<string, Design>();
  const queue = [id];
  while (queue.length) {
    const next = queue.shift()!;
    if (out.has(next)) continue;
    let d: Design;
    try {
      d = await readDesign(next);
    } catch (e) {
      // A missing inner design only loses its drill-down; a missing root is an error.
      if (next !== id && e instanceof NotFoundError) continue;
      throw e;
    }
    out.set(next, d);
    for (const c of d.components) if (c.detail) queue.push(c.detail);
  }
  return [...out.values()];
}

/**
 * One self-contained HTML file: the built app (dist/) with its script and styles inlined and the designs baked in.
 * It opens from disk or any static host and runs without a server (see `shared` in src/api.ts).
 */
export async function shareHtml(id: string, dist = DIST) {
  let html: string;
  try {
    html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  } catch {
    throw new Error('dist/index.html is missing: run `npm run build` first.');
  }
  const designs = await withInsides(id);
  const asset = (href: string) => fs.readFile(path.join(dist, href), 'utf8');
  const script = html.match(/<script type="module" crossorigin src="\/(assets\/[^"]+\.js)"><\/script>/);
  const style = html.match(/<link rel="stylesheet" crossorigin href="\/(assets\/[^"]+\.css)">/);
  if (!script || !style) throw new Error('dist/index.html does not look like a Vite build: rebuild with `npm run build`.');
  // JSON in a script tag: escaping "<" keeps "</script>" and "<!--" inside strings from ending it.
  const data = `<script type="application/json" id="shared-designs">${JSON.stringify(designs).replace(/</g, '\\u003c')}</script>`;
  const [js, css] = await Promise.all([asset(script[1]), asset(style[1])]);
  // Function replacers: the bundle is full of "$&"-like text that string replacements would expand.
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(designs[0].title)}</title>`)
    .replace(style[0], () => `<style>${safe(css, 'style')}</style>`)
    .replace(script[0], () => `${data}\n<script type="module">${safe(js, 'script')}</script>`);
}
