// Geometry of connection lines between two node boxes (centre + size).

export type Pt = { x: number; y: number };
export type NodeBox = Pt & { w: number; h: number };
export type Route = 'curve' | 'straight' | 'elbow';

export type EdgeGeometry = {
  /** SVG path of the line. */
  d: string;
  /** Polyline corners, for routes drawn as straight segments. */
  points?: Pt[];
  tip: Pt;
  /** Direction the arrow points at the tip, in radians. */
  angle: number;
  /** Where the label and the bend handle sit. */
  mid: Pt;
  bendable: boolean;
  /** The bend that puts the line's middle at `p` (for dragging the handle). */
  bendAt: (p: Pt) => number;
};

/** How far lines stop short of the shapes they join. */
const GAP = 6;

/** Where the line from a's centre towards p leaves a's bounding box. */
export function exit(a: NodeBox, p: Pt): Pt {
  const dx = p.x - a.x, dy = p.y - a.y;
  if (!dx && !dy) return a;
  const s = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: a.x + dx * s, y: a.y + dy * s };
}

/** Moves `p` towards `to` by up to GAP, never past a quarter of the way. */
function inset(p: Pt, to: Pt): Pt {
  const len = Math.hypot(to.x - p.x, to.y - p.y) || 1;
  const g = Math.min(GAP, len / 4);
  return { x: p.x + ((to.x - p.x) / len) * g, y: p.y + ((to.y - p.y) / len) * g };
}

/** Default bend: a gentle arc, always to the same side of the direction so A→B and B→A arc apart. */
export const defaultBend = (len: number) => Math.min(len * 0.12, 48);

export function edgeGeometry(a: NodeBox, b: NodeBox, route: Route = 'curve', bend?: number): EdgeGeometry {
  if (route === 'elbow') return elbow(a, b, bend ?? 0);
  const e1 = exit(a, b), e2 = exit(b, a);
  const len = Math.hypot(e2.x - e1.x, e2.y - e1.y) || 1;
  const ux = (e2.x - e1.x) / len, uy = (e2.y - e1.y) / len;
  const chord = { x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2 };
  if (route === 'straight') {
    const p1 = inset(e1, e2), p2 = inset(e2, e1);
    return { d: `M${p1.x},${p1.y} L${p2.x},${p2.y}`, tip: p2, angle: Math.atan2(uy, ux), mid: chord, bendable: false, bendAt: () => 0 };
  }
  const k = bend ?? defaultBend(len);
  const p1 = inset(e1, e2), p2 = inset(e2, e1);
  // c is the quadratic control point that makes the curve pass through mid (chord + k·normal) halfway.
  const mid = { x: chord.x - uy * k, y: chord.y + ux * k };
  const c = { x: 2 * mid.x - chord.x, y: 2 * mid.y - chord.y };
  return {
    d: `M${p1.x},${p1.y} Q${c.x},${c.y} ${p2.x},${p2.y}`,
    tip: p2,
    angle: Math.atan2(p2.y - c.y, p2.x - c.x),
    mid,
    bendable: true,
    bendAt: (p) => (p.x - chord.x) * -uy + (p.y - chord.y) * ux,
  };
}

/** Right-angled route: out of the facing sides, with the middle run shifted by `bend`. */
function elbow(a: NodeBox, b: NodeBox, bend: number): EdgeGeometry {
  const gapX = Math.abs(b.x - a.x) - (a.w + b.w) / 2, gapY = Math.abs(b.y - a.y) - (a.h + b.h) / 2;
  let points: Pt[], bendAt: (p: Pt) => number;
  if (gapX >= gapY) {
    const s = Math.sign(b.x - a.x) || 1;
    const p1 = { x: a.x + s * (a.w / 2 + GAP), y: a.y }, p2 = { x: b.x - s * (b.w / 2 + GAP), y: b.y };
    const base = (p1.x + p2.x) / 2, x = base + bend;
    points = [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
    bendAt = (p) => p.x - base;
  } else {
    const s = Math.sign(b.y - a.y) || 1;
    const p1 = { x: a.x, y: a.y + s * (a.h / 2 + GAP) }, p2 = { x: b.x, y: b.y - s * (b.h / 2 + GAP) };
    const base = (p1.y + p2.y) / 2, y = base + bend;
    points = [p1, { x: p1.x, y }, { x: p2.x, y }, p2];
    bendAt = (p) => p.y - base;
  }
  const tip = points[3];
  const from = [...points].reverse().find((p) => p.x !== tip.x || p.y !== tip.y) ?? points[0];
  return {
    d: `M${points.map((p) => `${p.x},${p.y}`).join(' L')}`,
    points,
    tip,
    angle: Math.atan2(tip.y - from.y, tip.x - from.x),
    mid: { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 },
    bendable: true,
    bendAt,
  };
}
