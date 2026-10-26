import rough from 'roughjs';
import type { Drawable, Options, PathInfo } from 'roughjs/bin/core';
import type { ComponentType } from '../core/schema.ts';

const gen = rough.generator();

export const CATEGORY_COLOR = { edge: '#D85A30', compute: '#7F77DD', data: '#1D9E75' } as const;
export const NOTE_COLOR = '#EF9F27';

type Category = keyof typeof CATEGORY_COLOR;
type Spec = {
  name: string;
  category: Category;
  w: number;
  h: number;
  /** Center of the label. Below the shape when labelY is near the bottom. */
  labelX?: number;
  labelY: number;
  dashed?: boolean;
  draw: (o: Options, w: number, h: number) => Drawable[];
};

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

function cylinder(o: Options, w: number, h: number) {
  return [gen.path(`M4 10 L4 ${h - 10} A${w / 2 - 4} 8 0 0 0 ${w - 4} ${h - 10} L${w - 4} 10`, o), gen.ellipse(w / 2, 10, w - 8, 16, o)];
}

const line = (o: Options) => ({ ...o, fill: undefined });

export const SHAPES: Record<ComponentType, Spec> = {
  client: {
    name: 'Client',
    category: 'edge',
    w: 140,
    h: 72,
    labelY: 30,
    draw: (o, w, h) => [gen.rectangle(4, 4, w - 8, h - 22, o), gen.line(w / 2, h - 18, w / 2, h - 7, line(o)), gen.line(w / 2 - 24, h - 6, w / 2 + 24, h - 6, line(o))],
  },
  cdn: {
    name: 'CDN',
    category: 'edge',
    w: 150,
    h: 76,
    labelY: 52,
    draw: (o, w, h) => {
      const sx = w / 124, sy = h / 62;
      const p = (x: number, y: number) => `${(x * sx).toFixed(1)} ${(y * sy).toFixed(1)}`;
      return [gen.path(`M${p(28, 58)} C${p(2, 58)} ${p(2, 26)} ${p(26, 26)} C${p(28, 6)} ${p(62, 0)} ${p(74, 16)} C${p(92, 4)} ${p(120, 18)} ${p(110, 36)} C${p(122, 42)} ${p(116, 60)} ${p(100, 58)} Z`, o)];
    },
  },
  dns: {
    name: 'DNS',
    category: 'edge',
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o, w) => [gen.circle(w / 2, 30, 54, o), gen.ellipse(w / 2, 30, 22, 54, line(o)), gen.line(w / 2 - 27, 30, w / 2 + 27, 30, line(o))],
  },
  waf: {
    name: 'WAF',
    category: 'edge',
    w: 100,
    h: 84,
    labelY: 42,
    draw: (o, w, h) => [gen.path(`M${w / 2} 2 L${w - 8} 14 L${w - 8} 38 Q${w - 8} ${h - 20} ${w / 2} ${h - 2} Q8 ${h - 20} 8 38 L8 14 Z`, o)],
  },
  'load-balancer': {
    name: 'Load balancer',
    category: 'compute',
    w: 130,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 30, 56, o), gen.line(c - 16, 30, c + 2, 30, l), gen.line(c + 2, 30, c + 16, 17, l), gen.line(c + 2, 30, c + 17, 30, l), gen.line(c + 2, 30, c + 16, 43, l)];
    },
  },
  'api-gateway': {
    name: 'API gateway',
    category: 'compute',
    w: 164,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[3, h / 2], [20, 3], [w - 20, 3], [w - 3, h / 2], [w - 20, h - 3], [20, h - 3]], o)],
  },
  service: {
    name: 'Service',
    category: 'compute',
    w: 150,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 12), o)],
  },
  worker: {
    name: 'Worker',
    category: 'compute',
    w: 156,
    h: 64,
    labelX: 72,
    labelY: 37,
    draw: (o, w, h) => [gen.path(roundRect(12, 3, w - 15, h - 14, 12), o), gen.path(roundRect(3, 11, w - 15, h - 14, 12), o)],
  },
  external: {
    name: 'External API',
    category: 'edge',
    w: 150,
    h: 56,
    labelY: 28,
    dashed: true,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 12), o)],
  },
  'sql-db': { name: 'SQL DB', category: 'data', w: 130, h: 76, labelY: 46, draw: cylinder },
  'nosql-db': {
    name: 'NoSQL DB',
    category: 'data',
    w: 130,
    h: 80,
    labelY: 54,
    draw: (o, w, h) => [...cylinder(o, w, h), gen.path(`M4 22 A${w / 2 - 4} 8 0 0 0 ${w - 4} 22`, line(o)), gen.path(`M4 33 A${w / 2 - 4} 8 0 0 0 ${w - 4} 33`, line(o))],
  },
  cache: {
    name: 'Cache',
    category: 'data',
    w: 130,
    h: 76,
    labelX: 74,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), gen.linearPath([[26, 26], [17, 44], [28, 44], [19, 62]], { ...line(o), stroke: NOTE_COLOR, strokeWidth: 2 })],
  },
  queue: {
    name: 'Queue',
    category: 'data',
    w: 170,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const x = 4, pw = w - 22, l = line(o);
      return [gen.rectangle(x, 4, pw, 40, o), gen.ellipse(x + pw, 24, 16, 40, o), ...[1, 2, 3].map((i) => gen.line(x + (i * pw) / 4, 4, x + (i * pw) / 4, 44, l))];
    },
  },
  'object-storage': {
    name: 'Object storage',
    category: 'data',
    w: 120,
    h: 80,
    labelY: 48,
    draw: (o, w, h) => [gen.path(`M4 12 L16 ${h - 10} Q${w / 2} ${h + 2} ${w - 16} ${h - 10} L${w - 4} 12`, o), gen.ellipse(w / 2, 12, w - 8, 18, o)],
  },
  search: {
    name: 'Search',
    category: 'data',
    w: 120,
    h: 88,
    labelY: 78,
    draw: (o, w) => [gen.circle(w / 2 - 6, 28, 46, o), gen.line(w / 2 + 11, 45, w / 2 + 26, 60, { ...line(o), strokeWidth: 3 })],
  },
};

export const NOTE_SIZE = { w: 190, h: 96 };
export const DECISION_SIZE = { w: 230, h: 120 };

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) % 100000;
}

/** Shared drawing options. `currentColor` lets CSS pick the ink colour for light and dark mode. */
export function options(sketch: boolean, fill: string | undefined, seed: number, extra: Options = {}): Options {
  return sketch
    ? { stroke: 'currentColor', strokeWidth: 1.4, roughness: 1.2, fill, fillStyle: 'hachure', hachureGap: 6, fillWeight: 0.8, seed, ...extra }
    : { stroke: 'currentColor', strokeWidth: 1.2, roughness: 0, bowing: 0, disableMultiStroke: true, fill: fill && `${fill}30`, fillStyle: 'solid', seed, ...extra };
}

export const toPaths = (drawables: Drawable[]): PathInfo[] => drawables.flatMap((d) => gen.toPaths(d));

export function drawShape(type: ComponentType, sketch: boolean, seed: number) {
  const s = SHAPES[type];
  return toPaths(s.draw(options(sketch, CATEGORY_COLOR[s.category], seed), s.w, s.h));
}

export { gen };
