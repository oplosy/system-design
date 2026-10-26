import type { Boundary, BoundaryKind, Design } from '../core/schema.ts';
import { SHAPES, type Kit } from './shapes.ts';

export type Box = { x: number; y: number; w: number; h: number };

/** Room around members: the top leaves space for the label tab, the bottom for labels drawn under shapes. */
export const BOUNDARY_PAD = { top: 44, side: 26, bottom: 34 };
export const EMPTY_BOUNDARY = { w: 360, h: 220 };

export const BOUNDARY_SPECS: Record<BoundaryKind, { name: string; color: string; dash?: string; strokeWidth: number; kits: Kit[] }> = {
  region: { name: 'Region', color: '#3F7FD9', dash: '12 6', strokeWidth: 1.8, kits: ['system'] },
  zone: { name: 'Availability zone', color: '#3F7FD9', dash: '3 5', strokeWidth: 1.4, kits: ['system'] },
  datacenter: { name: 'Data center', color: '#6E7B8B', strokeWidth: 1.8, kits: ['system', 'network'] },
  vpc: { name: 'VPC / VNet', color: '#1D9E75', strokeWidth: 1.4, kits: ['system', 'network'] },
  subnet: { name: 'Subnet', color: '#1D9E75', dash: '7 5', strokeWidth: 1.3, kits: ['system', 'network'] },
  vlan: { name: 'VLAN', color: '#7F77DD', dash: '9 4', strokeWidth: 1.4, kits: ['network'] },
  cluster: { name: 'Cluster / namespace', color: '#7F77DD', dash: '2 5', strokeWidth: 1.4, kits: ['system'] },
  site: { name: 'Site / floor', color: '#A8742E', strokeWidth: 1.8, kits: ['network'] },
  group: { name: 'Group', color: '#888780', dash: '6 6', strokeWidth: 1.2, kits: ['system', 'network'] },
};

/**
 * Where every boundary is drawn: around its visible members and child boundaries, or at its own
 * position when it has none. `show` decides which components and boundaries count as visible.
 */
export function boundaryBoxes(d: Design, show: (step: string) => boolean = () => true) {
  const boxes = new Map<string, Box & { depth: number }>();
  const visible = d.boundaries.filter((b) => show(b.step));
  const byId = new Map(visible.map((b) => [b.id, b]));
  const depthOf = (b: Boundary) => {
    let depth = 0;
    for (let p = b.parent; p && byId.has(p) && depth <= visible.length; p = byId.get(p)!.parent) depth++;
    return depth;
  };
  // Innermost first, so a parent can wrap its children's finished boxes.
  for (const b of [...visible].sort((a, c) => depthOf(c) - depthOf(a))) {
    const rects: Box[] = [];
    for (const c of d.components) {
      if (c.boundary === b.id && c.position && show(c.step)) rects.push({ ...c.position, w: SHAPES[c.type].w, h: SHAPES[c.type].h });
    }
    for (const child of visible) if (child.parent === b.id && boxes.has(child.id)) rects.push(boxes.get(child.id)!);
    let box: Box;
    if (rects.length) {
      const x1 = Math.min(...rects.map((r) => r.x)), y1 = Math.min(...rects.map((r) => r.y));
      const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h));
      box = { x: x1 - BOUNDARY_PAD.side, y: y1 - BOUNDARY_PAD.top, w: x2 - x1 + 2 * BOUNDARY_PAD.side, h: y2 - y1 + BOUNDARY_PAD.top + BOUNDARY_PAD.bottom };
    } else {
      box = { ...(b.position ?? { x: 0, y: 0 }), ...(b.size ?? EMPTY_BOUNDARY) };
    }
    boxes.set(b.id, { ...box, depth: depthOf(b) });
  }
  return boxes;
}

/** The deepest boundary whose box contains the point, ignoring `except` and everything inside it. */
export function boundaryAt(boxes: Map<string, Box & { depth: number }>, p: { x: number; y: number }, except: Set<string> = new Set()) {
  let best: string | undefined, depth = -1;
  for (const [id, b] of boxes) {
    if (except.has(id) || p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
    if (b.depth > depth) [best, depth] = [id, b.depth];
  }
  return best;
}
