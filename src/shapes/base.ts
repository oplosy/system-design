import rough from 'roughjs';
import type { Drawable, Options } from 'roughjs/bin/core';

export const gen = rough.generator();

/** Palette kits: system architecture, a physical / office network, software design (UML, patterns, flows), or a threat model. */
export const KITS = [
  { key: 'system', title: 'System' },
  { key: 'network', title: 'Network' },
  { key: 'software', title: 'Software' },
  { key: 'security', title: 'Security' },
] as const;
export type Kit = (typeof KITS)[number]['key'];

/** Palette sections, in order. Each group has one fill colour. */
export const GROUPS = [
  { key: 'client', title: 'Clients', color: '#2F9FB8', kit: 'system' },
  { key: 'edge', title: 'Edge and security', color: '#D85A30', kit: 'system' },
  { key: 'network', title: 'Network', color: '#3F7FD9', kit: 'system' },
  { key: 'compute', title: 'Compute', color: '#7F77DD', kit: 'system' },
  { key: 'data', title: 'Data', color: '#1D9E75', kit: 'system' },
  { key: 'messaging', title: 'Messaging', color: '#D4537E', kit: 'system' },
  { key: 'ops', title: 'Observability', color: '#6E7B8B', kit: 'system' },
  { key: 'analytics', title: 'Analytics and AI', color: '#A8742E', kit: 'system' },
  { key: 'external', title: 'Third party', color: '#888780', kit: 'system' },
  { key: 'net-core', title: 'Network gear', color: '#3F7FD9', kit: 'network' },
  { key: 'net-device', title: 'End devices', color: '#2F9FB8', kit: 'network' },
  { key: 'net-infra', title: 'Racks and power', color: '#6E7B8B', kit: 'network' },
  { key: 'net-wan', title: 'WAN', color: '#888780', kit: 'network' },
  { key: 'sw-uml', title: 'UML', color: '#2F9FB8', kit: 'software' },
  { key: 'sw-arch', title: 'Architecture', color: '#7F77DD', kit: 'software' },
  { key: 'sw-ddd', title: 'Domain', color: '#1D9E75', kit: 'software' },
  { key: 'sw-flow', title: 'Flow and state', color: '#A8742E', kit: 'software' },
  { key: 'sw-front', title: 'Frontend', color: '#D4537E', kit: 'software' },
  { key: 'threat', title: 'Threat model', color: '#C2413B', kit: 'security' },
  { key: 'sec-access', title: 'Access', color: '#7F77DD', kit: 'security' },
  { key: 'sec-detect', title: 'Detection and response', color: '#3F7FD9', kit: 'security' },
  { key: 'sec-data', title: 'Data protection', color: '#1D9E75', kit: 'security' },
  { key: 'sec-app', title: 'Application security', color: '#A8742E', kit: 'security' },
] as const;

export type Group = (typeof GROUPS)[number]['key'];
export const GROUP_COLOR = Object.fromEntries(GROUPS.map((g) => [g.key, g.color])) as Record<Group, string>;
export const NOTE_COLOR = '#EF9F27';

export type Spec = {
  name: string;
  group: Group;
  /** Extra words the palette search matches: products, synonyms, protocols. */
  keywords: string;
  /** Kits whose palette lists this part. Defaults to its group's kit. */
  kits?: Kit[];
  w: number;
  h: number;
  /** Center of the label. Below the shape when labelY is near the bottom. */
  labelX?: number;
  labelY: number;
  dashed?: boolean;
  draw: (o: Options, w: number, h: number) => Drawable[];
};

export function roundRect(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

export function cylinder(o: Options, w: number, h: number) {
  return [gen.path(`M4 10 L4 ${h - 10} A${w / 2 - 4} 8 0 0 0 ${w - 4} ${h - 10} L${w - 4} 10`, o), gen.ellipse(w / 2, 10, w - 8, 16, o)];
}

export const line = (o: Options) => ({ ...o, fill: undefined });
export const box = (o: Options, w: number, h: number) => gen.path(roundRect(3, 3, w - 6, h - 6, 12), o);

// Small glyphs drawn inside a shape, centred on (x, y), about 22px across.
export const glyph = {
  key: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.circle(x - 5, y, 11, l), gen.line(x + 1, y, x + 11, y, l), gen.line(x + 7, y, x + 7, y + 5, l), gen.line(x + 10, y, x + 10, y + 4, l)];
  },
  lambda: (o: Options, x: number, y: number) => {
    const l = { ...line(o), strokeWidth: 2 };
    return [gen.linearPath([[x - 7, y - 10], [x - 3, y - 10], [x + 8, y + 10]], l), gen.line(x + 1, y - 1, x - 8, y + 10, l)];
  },
  arrows: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [
      gen.line(x - 11, y - 4, x + 11, y - 4, l),
      gen.linearPath([[x + 6, y - 8], [x + 11, y - 4], [x + 6, y]], l),
      gen.line(x - 11, y + 5, x + 11, y + 5, l),
      gen.linearPath([[x - 6, y + 1], [x - 11, y + 5], [x - 6, y + 9]], l),
    ];
  },
  gear: (o: Options, x: number, y: number) => {
    const l = line(o);
    const teeth = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const a = (i * Math.PI) / 4;
      return gen.line(x + 7 * Math.cos(a), y + 7 * Math.sin(a), x + 11 * Math.cos(a), y + 11 * Math.sin(a), { ...l, strokeWidth: 2.4 });
    });
    return [gen.circle(x, y, 15, l), gen.circle(x, y, 5, l), ...teeth];
  },
  list: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [-7, 0, 7].flatMap((d) => [gen.line(x - 11, y + d, x - 8, y + d, { ...l, strokeWidth: 2.4 }), gen.line(x - 4, y + d, x + 11, y + d, l)]);
  },
  /** Wi-Fi arcs rising from (x, y). */
  wifi: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.circle(x, y, 4, l), ...[9, 16, 23].map((r) => gen.path(`M${x - r * 0.707} ${y - r * 0.707} A${r} ${r} 0 0 1 ${x + r * 0.707} ${y - r * 0.707}`, l))];
  },
  eye: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(`M${x - 13} ${y} Q${x} ${y - 12} ${x + 13} ${y} Q${x} ${y + 12} ${x - 13} ${y} Z`, l), gen.circle(x, y, 7, l)];
  },
  sparkle: (o: Options, x: number, y: number) => [
    gen.path(`M${x} ${y - 11} Q${x + 1} ${y - 1} ${x + 11} ${y} Q${x + 1} ${y + 1} ${x} ${y + 11} Q${x - 1} ${y + 1} ${x - 11} ${y} Q${x - 1} ${y - 1} ${x} ${y - 11} Z`, line(o)),
  ],
  bars: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.line(x - 12, y + 10, x + 12, y + 10, l), ...[10, 18, 13].map((bh, i) => gen.rectangle(x - 11 + i * 8, y + 10 - bh, 6, bh, l))];
  },
  trend: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.linearPath([[x - 12, y + 8], [x - 4, y], [x + 2, y + 4], [x + 12, y - 8]], l), gen.linearPath([[x + 6, y - 8], [x + 12, y - 8], [x + 12, y - 2]], l)];
  },
  play: (o: Options, x: number, y: number) => [gen.polygon([[x - 6, y - 9], [x + 9, y], [x - 6, y + 9]], line(o))],
  pin: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(`M${x} ${y + 11} C${x - 10} ${y} ${x - 9} ${y - 11} ${x} ${y - 11} C${x + 9} ${y - 11} ${x + 10} ${y} ${x} ${y + 11} Z`, l), gen.circle(x, y - 3, 6, l)];
  },
  phone: (o: Options, x: number, y: number) => [
    gen.path(`M${x - 9} ${y - 10} Q${x - 13} ${y - 5} ${x - 9} ${y + 1} Q${x - 3} ${y + 9} ${x + 6} ${y + 11} Q${x + 10} ${y + 12} ${x + 11} ${y + 8} L${x + 7} ${y + 4} L${x + 3} ${y + 6} Q${x - 2} ${y + 3} ${x - 5} ${y - 3} L${x - 3} ${y - 7} Z`, line(o)),
  ],
  branch: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.circle(x - 6, y - 8, 6, l), gen.circle(x - 6, y + 9, 6, l), gen.circle(x + 7, y - 4, 6, l), gen.line(x - 6, y - 5, x - 6, y + 6, l), gen.path(`M${x + 7} ${y - 1} Q${x + 7} ${y + 5} ${x - 4} ${y + 7}`, l)];
  },
  robot: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(roundRect(x - 11, y - 5, 22, 16, 4), l), gen.circle(x - 4, y + 3, 4, l), gen.circle(x + 4, y + 3, 4, l), gen.line(x, y - 5, x, y - 10, l), gen.circle(x, y - 11, 3, l)];
  },
  cycle: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(`M${x + 9} ${y - 5} A10 10 0 1 0 ${x + 10} ${y + 3}`, l), gen.linearPath([[x + 3, y - 5], [x + 9, y - 5], [x + 10, y - 11]], l)];
  },
  wave: (o: Options, x: number, y: number) => [gen.path(waves(x - 12, y, 4, 6), line(o))],
  star: (o: Options, x: number, y: number) => [
    gen.polygon(
      Array.from({ length: 10 }, (_, k): [number, number] => {
        const r = k % 2 ? 5 : 11, a = -Math.PI / 2 + (k * Math.PI) / 5;
        return [x + r * Math.cos(a), y + r * Math.sin(a)];
      }),
      line(o),
    ),
  ],
  doc: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.polygon([[x - 8, y - 11], [x + 4, y - 11], [x + 9, y - 6], [x + 9, y + 11], [x - 8, y + 11]], l), gen.line(x - 4, y - 2, x + 5, y - 2, l), gen.line(x - 4, y + 4, x + 5, y + 4, l)];
  },
  clock: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.circle(x, y, 22, l), gen.line(x, y, x, y - 7, l), gen.line(x, y, x + 6, y + 3, l)];
  },
  graph: (o: Options, x: number, y: number) => {
    const l = line(o);
    const pts: [number, number][] = [[x, y - 9], [x - 9, y + 7], [x + 9, y + 7]];
    return [...pts.map(([px, py], i) => gen.line(px, py, pts[(i + 1) % 3][0], pts[(i + 1) % 3][1], l)), ...pts.map(([px, py]) => gen.circle(px, py, 6, l))];
  },
  gamepad: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(roundRect(x - 13, y - 7, 26, 14, 7), l), gen.line(x - 9, y, x - 3, y, l), gen.line(x - 6, y - 3, x - 6, y + 3, l), gen.circle(x + 5, y - 2, 3, l), gen.circle(x + 8, y + 2, 3, l)];
  },
  link: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(roundRect(x - 12, y - 5, 14, 10, 5), l), gen.path(roundRect(x - 2, y - 5, 14, 10, 5), l)];
  },
  db: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.path(`M${x - 9} ${y - 7} V${y + 7} A9 3.5 0 0 0 ${x + 9} ${y + 7} V${y - 7}`, l), gen.ellipse(x, y - 7, 18, 7, l)];
  },
  /** UML provided-interface lollipop. */
  lollipop: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [gen.circle(x - 5, y, 12, l), gen.line(x + 1, y, x + 12, y, l)];
  },
  /** Vertical double arrow: scaling up and down. */
  updown: (o: Options, x: number, y: number) => {
    const l = line(o);
    return [
      gen.line(x, y - 11, x, y + 11, l),
      gen.linearPath([[x - 5, y - 6], [x, y - 11], [x + 5, y - 6]], l),
      gen.linearPath([[x - 5, y + 6], [x, y + 11], [x + 5, y + 6]], l),
    ];
  },
};

export type Glyph = (o: Options, x: number, y: number) => Drawable[];

/** A rounded box with a glyph on the left and the label beside it. */
export const tiled = (name: string, group: Group, keywords: string, g: Glyph, w: number, extra: Partial<Spec> = {}): Spec => ({
  name,
  group,
  keywords,
  w,
  h: 56,
  labelX: w / 2 + 12,
  labelY: 28,
  draw: (o, bw, bh) => [box(o, bw, bh), ...g(o, 24, bh / 2)],
  ...extra,
});

export function cloud(o: Options, w: number, h: number) {
  const sx = w / 124, sy = h / 62;
  const p = (x: number, y: number) => `${(x * sx).toFixed(1)} ${(y * sy).toFixed(1)}`;
  return gen.path(`M${p(28, 58)} C${p(2, 58)} ${p(2, 26)} ${p(26, 26)} C${p(28, 6)} ${p(62, 0)} ${p(74, 16)} C${p(92, 4)} ${p(120, 18)} ${p(110, 36)} C${p(122, 42)} ${p(116, 60)} ${p(100, 58)} Z`, o);
}

/** A horizontal arrow from x1 to x2 at height y, head at x2. */
export function arrow(o: Options, x1: number, x2: number, y: number) {
  const d = x2 > x1 ? -5 : 5;
  return [gen.line(x1, y, x2, y, o), gen.linearPath([[x2 + d, y - 4], [x2, y], [x2 + d, y + 4]], o)];
}

export function waves(x0: number, y: number, n: number, step: number) {
  let d = `M${x0} ${y}`;
  for (let i = 0; i < n; i++) d += ` Q${x0 + step * i + step / 2} ${y + (i % 2 ? 5 : -5)} ${x0 + step * (i + 1)} ${y}`;
  return d;
}
