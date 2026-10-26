import ELK from 'elkjs/lib/elk.bundled.js';
import type { Design } from '../core/schema.ts';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

const elk = new ELK();

/** Top-down layered layout of every canvas item; notes and decisions sit next to what they point at. */
export async function layout(d: Design) {
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: [
      ...d.components.map((c) => ({ id: c.id, width: SHAPES[c.type].w, height: SHAPES[c.type].h })),
      ...d.notes.map((n) => ({ id: n.id, width: NOTE_SIZE.w, height: NOTE_SIZE.h })),
      ...d.decisions.map((x) => ({ id: x.id, width: DECISION_SIZE.w, height: DECISION_SIZE.h })),
    ],
    edges: [
      ...d.connections.map((c) => ({ id: c.id, sources: [c.from], targets: [c.to] })),
      ...d.notes.filter((n) => n.attachTo).map((n) => ({ id: `link-${n.id}`, sources: [n.attachTo!], targets: [n.id] })),
      ...d.decisions.flatMap((x) => x.links.map((l) => ({ id: `link-${x.id}-${l}`, sources: [l], targets: [x.id] }))),
    ],
  });
  return new Map((graph.children ?? []).map((c) => [c.id, { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }]));
}
