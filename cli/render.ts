// Draws a design as a standalone SVG, and a small status badge, for READMEs and wikis that can't run the app.
import type { Design } from '../core/schema.ts';
import { BOUNDARY_SPECS, boundaryBoxes, type Box } from '../src/boundaries.ts';
import { placeMissing } from '../src/layout.ts';
import { SHAPES, drawShape, hash } from '../src/shapes.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PAD = 40;

// Light by default, dark where the viewer is (GitHub renders images in an <img>, where the media query still works).
const STYLE = `svg{color:#1f2328;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.bg{fill:#fff}.meta,.tech{fill:#656d76}
@media (prefers-color-scheme:dark){svg{color:#e6edf3}.bg{fill:#0d1117}.meta,.tech{fill:#8d96a0}}`;

/** Where a line from `a`'s centre towards `b`'s centre leaves box `a`. */
function exit(a: Box, b: Box) {
  const [cx, cy] = [a.x + a.w / 2, a.y + a.h / 2];
  const [dx, dy] = [b.x + b.w / 2 - cx, b.y + b.h / 2 - cy];
  const t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * The design as the canvas shows it once every step is accepted: boundaries, parts and lines with their load.
 * Parts with no position (added by an agent and never opened in the app) are laid out the way the app would.
 * Notes, decisions and items of options not picked yet are left out.
 */
export async function designSvg(design: Design) {
  const d = structuredClone(design);
  const shown = (x: { option?: string }) => !x.option;
  d.components = d.components.filter(shown);
  d.boundaries = d.boundaries.filter(shown);
  d.connections = d.connections.filter((c) => shown(c) && d.components.some((x) => x.id === c.from) && d.components.some((x) => x.id === c.to));
  d.notes = [];
  d.decisions = [];
  await placeMissing(d);
  const part = new Map(d.components.map((c) => [c.id, { ...c.position!, w: SHAPES[c.type].w, h: SHAPES[c.type].h }]));
  const boxes = [...boundaryBoxes(d)].sort(([, a], [, b]) => a.depth - b.depth);
  // Room below shapes for labels drawn under them.
  const all = [...part.values(), ...boxes.map(([, b]) => b)].map((b) => ({ ...b, h: b.h + 34 }));
  if (!all.length) all.push({ x: 0, y: 0, w: 200, h: 60 });
  const x0 = Math.min(...all.map((b) => b.x)) - PAD, y0 = Math.min(...all.map((b) => b.y)) - PAD;
  const w = Math.max(...all.map((b) => b.x + b.w)) + PAD - x0, h = Math.max(...all.map((b) => b.y + b.h)) + PAD - y0;

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="${esc(d.title)}">`,
    `<title>${esc(d.title)}</title><style>${STYLE}</style>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="currentColor" stroke-width="1.4"/></marker></defs>`,
    `<rect class="bg" x="${x0}" y="${y0}" width="${w}" height="${h}"/>`,
  ];
  for (const [id, b] of boxes) {
    const s = BOUNDARY_SPECS[d.boundaries.find((x) => x.id === id)!.kind];
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${s.color}0d" stroke="${s.color}" stroke-width="${s.strokeWidth}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`,
      `<text x="${b.x + 12}" y="${b.y + 22}" font-size="13" font-weight="600" fill="${s.color}">${esc(d.boundaries.find((x) => x.id === id)!.label)}</text>`,
    );
  }
  for (const c of d.connections) {
    const [a, b] = [part.get(c.from)!, part.get(c.to)!];
    const [p, q] = [exit(a, b), exit(b, a)];
    out.push(`<path d="M${p.x} ${p.y}L${q.x} ${q.y}" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.4" marker-end="url(#arrow)"${c.async ? ' stroke-dasharray="7 5"' : ''}/>`);
    const load = [c.latency !== undefined && `${c.latency} ms`, c.qps !== undefined && `${c.qps}/s`].filter(Boolean).join(' · ');
    const [mx, my] = [(p.x + q.x) / 2, (p.y + q.y) / 2];
    if (c.label) out.push(`<text x="${mx}" y="${my - (load ? 6 : -4)}" font-size="12" text-anchor="middle" fill="currentColor">${esc(c.label)}</text>`);
    if (load) out.push(`<text class="meta" x="${mx}" y="${my + 10}" font-size="10" text-anchor="middle">${esc(load)}</text>`);
  }
  for (const c of d.components) {
    const s = SHAPES[c.type];
    const at = part.get(c.id)!;
    const paths = drawShape(c.type, false, hash(c.id))
      .map((p) => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}"${s.dashed && p.stroke === 'currentColor' ? ' stroke-dasharray="7 5"' : ''} stroke-linecap="round"/>`)
      .join('');
    const lx = at.x + (s.labelX ?? s.w / 2), ly = at.y + s.labelY;
    out.push(
      `<g><g transform="translate(${at.x} ${at.y})">${paths}</g>`,
      `<text x="${lx}" y="${ly + (c.tech ? -2 : 4)}" font-size="13" font-weight="500" text-anchor="middle" fill="currentColor">${esc(c.label)}</text>`,
      c.tech ? `<text class="tech" x="${lx}" y="${ly + 13}" font-size="11" text-anchor="middle">${esc(c.tech)}</text>` : '',
      '</g>',
    );
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/** A shields-style badge: "<label> | <value>", the value on `color`. Widths are estimated, as no font is measured. */
export function badgeSvg(label: string, value: string, color: string) {
  const width = (s: string) => Math.round(s.length * 6.6 + 12);
  const [a, b] = [width(label), width(value)];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a + b}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${a + b}" height="20" rx="3" fill="#555"/><rect x="${a}" width="${b}" height="20" rx="3" fill="${color}"/><rect x="${a}" width="4" height="20" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${a / 2}" y="14">${esc(label)}</text><text x="${a + b / 2}" y="14">${esc(value)}</text></g>
</svg>
`;
}
