import rough from 'roughjs';
import type { Drawable, Options, PathInfo } from 'roughjs/bin/core';
import type { ComponentType } from '../core/schema.ts';

const gen = rough.generator();

/** Palette kits: system architecture, a physical / office network, or software design (UML, patterns, flows). */
export const KITS = [
  { key: 'system', title: 'System' },
  { key: 'network', title: 'Network' },
  { key: 'software', title: 'Software' },
] as const;
export type Kit = (typeof KITS)[number]['key'];

/** Palette sections, in order. Each group has one fill colour. */
export const GROUPS = [
  { key: 'client', title: 'Clients / users', color: '#2F9FB8', kit: 'system' },
  { key: 'edge', title: 'Edge / security', color: '#D85A30', kit: 'system' },
  { key: 'network', title: 'Network', color: '#3F7FD9', kit: 'system' },
  { key: 'compute', title: 'Compute', color: '#7F77DD', kit: 'system' },
  { key: 'data', title: 'Data', color: '#1D9E75', kit: 'system' },
  { key: 'messaging', title: 'Messaging / events', color: '#D4537E', kit: 'system' },
  { key: 'ops', title: 'Observability / ops', color: '#6E7B8B', kit: 'system' },
  { key: 'analytics', title: 'Analytics / AI', color: '#A8742E', kit: 'system' },
  { key: 'external', title: 'Third party', color: '#888780', kit: 'system' },
  { key: 'net-core', title: 'Network gear', color: '#3F7FD9', kit: 'network' },
  { key: 'net-device', title: 'End devices', color: '#2F9FB8', kit: 'network' },
  { key: 'net-infra', title: 'Racks / power', color: '#6E7B8B', kit: 'network' },
  { key: 'net-wan', title: 'WAN / internet', color: '#888780', kit: 'network' },
  { key: 'sw-uml', title: 'Use case / UML', color: '#2F9FB8', kit: 'software' },
  { key: 'sw-arch', title: 'Architecture', color: '#7F77DD', kit: 'software' },
  { key: 'sw-ddd', title: 'Domain / CQRS', color: '#1D9E75', kit: 'software' },
  { key: 'sw-flow', title: 'Flow / state', color: '#A8742E', kit: 'software' },
] as const;

type Group = (typeof GROUPS)[number]['key'];
export const GROUP_COLOR = Object.fromEntries(GROUPS.map((g) => [g.key, g.color])) as Record<Group, string>;
export const NOTE_COLOR = '#EF9F27';

type Spec = {
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

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

function cylinder(o: Options, w: number, h: number) {
  return [gen.path(`M4 10 L4 ${h - 10} A${w / 2 - 4} 8 0 0 0 ${w - 4} ${h - 10} L${w - 4} 10`, o), gen.ellipse(w / 2, 10, w - 8, 16, o)];
}

const line = (o: Options) => ({ ...o, fill: undefined });
const box = (o: Options, w: number, h: number) => gen.path(roundRect(3, 3, w - 6, h - 6, 12), o);

// Small glyphs drawn inside a shape, centred on (x, y), about 22px across.
const glyph = {
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
};

type Glyph = (o: Options, x: number, y: number) => Drawable[];

/** A rounded box with a glyph on the left and the label beside it. */
const tiled = (name: string, group: Group, keywords: string, g: Glyph, w: number, extra: Partial<Spec> = {}): Spec => ({
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

function cloud(o: Options, w: number, h: number) {
  const sx = w / 124, sy = h / 62;
  const p = (x: number, y: number) => `${(x * sx).toFixed(1)} ${(y * sy).toFixed(1)}`;
  return gen.path(`M${p(28, 58)} C${p(2, 58)} ${p(2, 26)} ${p(26, 26)} C${p(28, 6)} ${p(62, 0)} ${p(74, 16)} C${p(92, 4)} ${p(120, 18)} ${p(110, 36)} C${p(122, 42)} ${p(116, 60)} ${p(100, 58)} Z`, o);
}

/** A horizontal arrow from x1 to x2 at height y, head at x2. */
function arrow(o: Options, x1: number, x2: number, y: number) {
  const d = x2 > x1 ? -5 : 5;
  return [gen.line(x1, y, x2, y, o), gen.linearPath([[x2 + d, y - 4], [x2, y], [x2 + d, y + 4]], o)];
}

function waves(x0: number, y: number, n: number, step: number) {
  let d = `M${x0} ${y}`;
  for (let i = 0; i < n; i++) d += ` Q${x0 + step * i + step / 2} ${y + (i % 2 ? 5 : -5)} ${x0 + step * (i + 1)} ${y}`;
  return d;
}

export const SHAPES: Record<ComponentType, Spec> = {
  // Clients / users
  user: {
    name: 'User',
    group: 'client',
    keywords: 'actor person customer human end user admin employee',
    kits: ['system', 'network', 'software'],
    w: 80,
    h: 88,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 12, 18, o), gen.line(c, 21, c, 46, l), gen.line(c - 15, 30, c + 15, 30, l), gen.linearPath([[c - 12, 64], [c, 46], [c + 12, 64]], l)];
    },
  },
  client: {
    name: 'Client',
    group: 'client',
    keywords: 'web browser desktop frontend spa react app',
    kits: ['system', 'software'],
    w: 140,
    h: 72,
    labelY: 30,
    draw: (o, w, h) => [gen.rectangle(4, 4, w - 8, h - 22, o), gen.line(w / 2, h - 18, w / 2, h - 7, line(o)), gen.line(w / 2 - 24, h - 6, w / 2 + 24, h - 6, line(o))],
  },
  mobile: {
    name: 'Mobile app',
    group: 'client',
    keywords: 'ios android phone smartphone tablet app react native flutter',
    kits: ['system', 'network', 'software'],
    w: 100,
    h: 92,
    labelY: 82,
    draw: (o, w) => [gen.path(roundRect(w / 2 - 20, 2, 40, 64, 7), o), gen.line(w / 2 - 5, 8, w / 2 + 5, 8, line(o)), gen.line(w / 2 - 6, 58, w / 2 + 6, 58, line(o))],
  },
  iot: {
    name: 'IoT device',
    group: 'client',
    keywords: 'sensor device embedded hardware mqtt edge smart device',
    kits: ['system', 'network'],
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const pins = [0, 1, 2].flatMap((i) => {
        const x = c - 12 + 12 * i, y = 16 + 12 * i;
        return [gen.line(x, 2, x, 8, l), gen.line(x, 48, x, 54, l), gen.line(c - 26, y, c - 20, y, l), gen.line(c + 20, y, c + 26, y, l)];
      });
      return [gen.rectangle(c - 20, 8, 40, 40, o), gen.rectangle(c - 8, 20, 16, 16, l), ...pins];
    },
  },

  // Edge / security
  dns: {
    name: 'DNS',
    group: 'edge',
    keywords: 'route 53 cloudflare domain name resolver bind dns server',
    kits: ['system', 'network'],
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o, w) => [gen.circle(w / 2, 30, 54, o), gen.ellipse(w / 2, 30, 22, 54, line(o)), gen.line(w / 2 - 27, 30, w / 2 + 27, 30, line(o))],
  },
  cdn: {
    name: 'CDN',
    group: 'edge',
    keywords: 'cloudfront cloudflare akamai fastly edge cache static assets',
    w: 150,
    h: 76,
    labelY: 52,
    draw: (o, w, h) => [cloud(o, w, h)],
  },
  waf: {
    name: 'WAF',
    group: 'edge',
    keywords: 'web application firewall ddos bot protection shield cloudflare',
    w: 100,
    h: 84,
    labelY: 42,
    draw: (o, w, h) => [gen.path(`M${w / 2} 2 L${w - 8} 14 L${w - 8} 38 Q${w - 8} ${h - 20} ${w / 2} ${h - 2} Q8 ${h - 20} 8 38 L8 14 Z`, o)],
  },
  firewall: {
    name: 'Firewall',
    group: 'edge',
    keywords: 'security group network acl nacl iptables perimeter fortinet fortigate palo alto pfsense utm ngfw',
    kits: ['system', 'network'],
    w: 130,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const l = line(o), bw = w - 8, rh = 40 / 3;
      const rows = [1, 2].map((r) => gen.line(4, 4 + rh * r, w - 4, 4 + rh * r, l));
      const joints = [0, 1, 2].flatMap((r) =>
        (r === 1 ? [0.5, 1.5, 2.5, 3.5] : [1, 2, 3]).map((k) => gen.line(4 + (bw * k) / 4, 4 + rh * r, 4 + (bw * k) / 4, 4 + rh * (r + 1), l)),
      );
      return [gen.rectangle(4, 4, bw, 40, o), ...rows, ...joints];
    },
  },
  identity: {
    name: 'Auth / identity',
    group: 'edge',
    keywords: 'auth oauth oidc sso login identity provider idp jwt cognito auth0 keycloak okta session active directory ad ldap domain controller radius',
    kits: ['system', 'network'],
    w: 160,
    h: 56,
    labelX: 90,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.key(o, 24, h / 2)],
  },
  secrets: {
    name: 'Secrets / KMS',
    group: 'edge',
    keywords: 'vault kms secret manager key encryption certificate tls hsm',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.path(`M${c - 14} 30 V18 A14 14 0 0 1 ${c + 14} 18 V30`, l), gen.rectangle(c - 22, 28, 44, 34, o), gen.circle(c, 41, 8, l), gen.line(c, 45, c, 53, l)];
    },
  },
  'rate-limiter': {
    name: 'Rate limiter',
    group: 'edge',
    keywords: 'throttle throttling quota token bucket leaky bucket',
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.polygon([[c - 22, 4], [c + 22, 4], [c + 3, 32], [c + 22, 60], [c - 22, 60], [c - 3, 32]], o), gen.line(c - 26, 3, c + 26, 3, l), gen.line(c - 26, 61, c + 26, 61, l)];
    },
  },

  ids: {
    name: 'IDS / IPS',
    group: 'edge',
    keywords: 'intrusion detection prevention snort suricata siem security monitoring',
    kits: ['system', 'network'],
    w: 140,
    h: 56,
    labelX: 80,
    labelY: 28,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 4), o), ...glyph.eye(o, 24, h / 2)],
  },

  // Network
  'load-balancer': {
    name: 'Load balancer',
    group: 'network',
    keywords: 'lb alb nlb elb haproxy round robin l4 l7 f5 adc',
    kits: ['system', 'network'],
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
    group: 'network',
    keywords: 'kong apigee aws api gateway routing bff graphql gateway',
    w: 164,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[3, h / 2], [20, 3], [w - 20, 3], [w - 3, h / 2], [w - 20, h - 3], [20, h - 3]], o)],
  },
  'reverse-proxy': {
    name: 'Reverse proxy',
    group: 'network',
    keywords: 'nginx envoy haproxy traefik caddy proxy ingress controller',
    w: 160,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[20, 3], [w - 3, 3], [w - 20, h - 3], [3, h - 3]], o)],
  },
  'service-mesh': {
    name: 'Service mesh',
    group: 'network',
    keywords: 'istio linkerd sidecar envoy consul connect mtls',
    w: 110,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const corners: [number, number][] = [[c - 26, 10], [c + 26, 10], [c + 26, 58], [c - 26, 58]];
      const edges = corners.flatMap(([x, y], i) => {
        const [nx, ny] = corners[(i + 1) % 4];
        return [gen.line(x, y, nx, ny, l), gen.line(x, y, c, 34, l)];
      });
      return [...edges, ...corners.map(([x, y]) => gen.circle(x, y, 14, o)), gen.circle(c, 34, 16, o)];
    },
  },
  realtime: {
    name: 'Realtime gateway',
    group: 'network',
    keywords: 'websocket socket.io sse server sent events long polling push pusher ably',
    w: 170,
    h: 56,
    labelX: 96,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.arrows(o, 24, h / 2)],
  },
  vpn: {
    name: 'VPN / private link',
    group: 'network',
    keywords: 'vpn bastion private link peering tunnel wireguard ipsec vpc site to site openvpn concentrator',
    kits: ['system', 'network'],
    w: 170,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.rectangle(14, 4, w - 28, 40, o),
        gen.ellipse(14, 24, 16, 40, o),
        gen.ellipse(w - 14, 24, 16, 40, o),
        gen.rectangle(c - 7, 22, 14, 11, l),
        gen.path(`M${c - 4} 22 V18 A4 4 0 0 1 ${c + 4} 18 V22`, l),
      ];
    },
  },

  // Compute
  service: {
    name: 'Service',
    group: 'compute',
    keywords: 'microservice backend api server app monolith rest grpc',
    kits: ['system', 'software'],
    w: 150,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h)],
  },
  worker: {
    name: 'Worker',
    group: 'compute',
    keywords: 'background job consumer async processor sidekiq celery',
    w: 156,
    h: 64,
    labelX: 72,
    labelY: 37,
    draw: (o, w, h) => [gen.path(roundRect(12, 3, w - 15, h - 14, 12), o), gen.path(roundRect(3, 11, w - 15, h - 14, 12), o)],
  },
  function: {
    name: 'Serverless function',
    group: 'compute',
    keywords: 'lambda faas cloud functions edge functions cloudflare workers vercel',
    w: 180,
    h: 56,
    labelX: 100,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.lambda(o, 24, h / 2)],
  },
  container: {
    name: 'Container',
    group: 'compute',
    keywords: 'docker pod oci ecs fargate cloud run image',
    w: 140,
    h: 70,
    labelY: 60,
    draw: (o, w) => {
      const l = line(o), ribs = Math.floor((w - 8) / 11);
      return [gen.rectangle(4, 4, w - 8, 36, o), ...Array.from({ length: ribs - 1 }, (_, k) => gen.line(4 + 11 * (k + 1), 9, 4 + 11 * (k + 1), 35, l))];
    },
  },
  kubernetes: {
    name: 'Kubernetes cluster',
    group: 'compute',
    keywords: 'k8s eks gke aks cluster orchestration pods nodes helm',
    w: 150,
    h: 100,
    labelY: 50,
    draw: (o, w, h) => {
      const pts = Array.from({ length: 7 }, (_, k): [number, number] => {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 7;
        return [w / 2 + 72 * Math.cos(a), h / 2 + 2 + 48 * Math.sin(a)];
      });
      return [gen.polygon(pts, o)];
    },
  },
  vm: {
    name: 'Server / VM',
    group: 'compute',
    keywords: 'ec2 vm virtual machine host bare metal instance compute engine droplet server dhcp file server mail server hypervisor esxi',
    kits: ['system', 'network'],
    w: 110,
    h: 92,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [0, 30].flatMap((y) => [gen.rectangle(c - 34, 4 + y, 68, 26, o), gen.line(c - 26, 17 + y, c + 8, 17 + y, l), gen.circle(c + 22, 17 + y, 6, l)]);
    },
  },
  cron: {
    name: 'Scheduler / cron',
    group: 'compute',
    keywords: 'cron scheduled job timer periodic quartz eventbridge scheduler',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = { ...line(o), strokeWidth: 2 };
      return [gen.circle(c, 30, 56, o), gen.line(c, 30, c, 11, l), gen.line(c, 30, c + 13, 37, l)];
    },
  },
  workflow: {
    name: 'Workflow engine',
    group: 'compute',
    keywords: 'temporal step functions airflow orchestrator saga cadence conductor state machine',
    w: 170,
    h: 84,
    labelY: 42,
    draw: (o, w, h) => [gen.polygon([[w / 2, 3], [w - 3, h / 2], [w / 2, h - 3], [3, h / 2]], o)],
  },

  // Data
  'sql-db': { name: 'SQL DB', group: 'data', kits: ['system', 'software'], keywords: 'postgres postgresql mysql aurora rds sql server oracle relational replica', w: 130, h: 76, labelY: 46, draw: cylinder },
  'nosql-db': {
    name: 'NoSQL DB',
    group: 'data',
    keywords: 'mongodb cassandra dynamodb scylla couchbase firestore document wide column',
    w: 130,
    h: 80,
    labelY: 54,
    draw: (o, w, h) => [...cylinder(o, w, h), gen.path(`M4 22 A${w / 2 - 4} 8 0 0 0 ${w - 4} 22`, line(o)), gen.path(`M4 33 A${w / 2 - 4} 8 0 0 0 ${w - 4} 33`, line(o))],
  },
  'key-value': {
    name: 'Key-value store',
    group: 'data',
    keywords: 'redis dynamodb etcd riak foundationdb kv',
    w: 150,
    h: 76,
    labelX: 86,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), ...glyph.key(o, 26, 46)],
  },
  cache: {
    name: 'Cache',
    group: 'data',
    keywords: 'redis memcached in-memory valkey elasticache',
    kits: ['system', 'software'],
    w: 130,
    h: 76,
    labelX: 74,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), gen.linearPath([[26, 26], [17, 44], [28, 44], [19, 62]], { ...line(o), stroke: NOTE_COLOR, strokeWidth: 2 })],
  },
  'graph-db': {
    name: 'Graph DB',
    group: 'data',
    keywords: 'neo4j neptune dgraph graph relationships social graph',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const n: [number, number][] = [[c, 10], [c - 28, 52], [c + 28, 52]];
      return [gen.line(...n[0], ...n[1], l), gen.line(...n[1], ...n[2], l), gen.line(...n[2], ...n[0], l), ...n.map(([x, y]) => gen.circle(x, y, 18, o))];
    },
  },
  'time-series': {
    name: 'Time-series DB',
    group: 'data',
    keywords: 'influxdb timescaledb prometheus tsdb metrics questdb',
    w: 130,
    h: 92,
    labelY: 82,
    draw: (o, w) => [...cylinder(o, w, 66), gen.linearPath([[16, 50], [32, 38], [46, 48], [62, 32], [78, 44], [94, 30], [112, 40]], line(o))],
  },
  'vector-db': {
    name: 'Vector DB',
    group: 'data',
    keywords: 'pinecone pgvector weaviate milvus qdrant chroma embeddings similarity ann rag',
    w: 130,
    h: 92,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [...cylinder(o, w, 66), gen.line(c - 20, 54, c + 16, 30, l), gen.line(c - 20, 54, c + 26, 46, l), gen.line(c - 20, 54, c - 4, 28, l)];
    },
  },
  search: {
    name: 'Search',
    group: 'data',
    keywords: 'elasticsearch opensearch solr algolia meilisearch typesense full text index',
    w: 120,
    h: 88,
    labelY: 78,
    draw: (o, w) => [gen.circle(w / 2 - 6, 28, 46, o), gen.line(w / 2 + 11, 45, w / 2 + 26, 60, { ...line(o), strokeWidth: 3 })],
  },
  'object-storage': {
    name: 'Object storage',
    group: 'data',
    keywords: 's3 gcs blob azure blob r2 minio bucket files media',
    w: 120,
    h: 80,
    labelY: 48,
    draw: (o, w, h) => [gen.path(`M4 12 L16 ${h - 10} Q${w / 2} ${h + 2} ${w - 16} ${h - 10} L${w - 4} 12`, o), gen.ellipse(w / 2, 12, w - 8, 18, o)],
  },
  'file-storage': {
    name: 'File / block storage',
    group: 'data',
    keywords: 'nfs efs ebs disk volume block filesystem shared drive',
    w: 160,
    h: 72,
    labelY: 42,
    draw: (o, w, h) => [gen.path(`M4 ${h - 4} V12 Q4 6 10 6 H44 L52 16 H${w - 4} V${h - 4} Z`, o)],
  },
  warehouse: {
    name: 'Data warehouse',
    group: 'data',
    keywords: 'snowflake bigquery redshift clickhouse olap analytics bi',
    w: 170,
    h: 80,
    labelY: 52,
    draw: (o, w, h) => [gen.polygon([[4, 26], [w / 2, 4], [w - 4, 26], [w - 4, h - 4], [4, h - 4]], o)],
  },
  'data-lake': {
    name: 'Data lake',
    group: 'data',
    keywords: 's3 hdfs delta lake iceberg hudi parquet raw lakehouse',
    w: 170,
    h: 74,
    labelY: 64,
    draw: (o, w) => {
      const l = line(o);
      return [gen.ellipse(w / 2, 24, w - 8, 44, o), gen.path(waves(30, 18, 6, 18), l), gen.path(waves(42, 30, 5, 18), l)];
    },
  },

  // Messaging / events
  queue: {
    name: 'Queue',
    group: 'messaging',
    keywords: 'sqs rabbitmq activemq message queue amqp job queue bullmq',
    kits: ['system', 'software'],
    w: 170,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const x = 4, pw = w - 22, l = line(o);
      return [gen.rectangle(x, 4, pw, 40, o), gen.ellipse(x + pw, 24, 16, 40, o), ...[1, 2, 3].map((i) => gen.line(x + (i * pw) / 4, 4, x + (i * pw) / 4, 44, l))];
    },
  },
  pubsub: {
    name: 'Pub/Sub topic',
    group: 'messaging',
    keywords: 'sns google pub/sub topic fanout broadcast nats redis pubsub subscribe',
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o) => {
      const cx = 30, cy = 32, l = line(o);
      const arc = (r: number) => gen.path(`M${cx + r * 0.707} ${cy - r * 0.707} A${r} ${r} 0 0 1 ${cx + r * 0.707} ${cy + r * 0.707}`, l);
      return [gen.circle(cx, cy, 22, o), arc(22), arc(34), arc(46)];
    },
  },
  stream: {
    name: 'Event stream',
    group: 'messaging',
    keywords: 'kafka kinesis pulsar redpanda event log stream partition topic append only',
    w: 190,
    h: 70,
    labelY: 60,
    draw: (o, w) => {
      const l = line(o);
      return [...Array.from({ length: 6 }, (_, i) => gen.rectangle(4 + 24 * i, 6, 24, 34, o)), gen.line(152, 23, w - 6, 23, l), gen.linearPath([[w - 12, 17], [w - 6, 23], [w - 12, 29]], l)];
    },
  },
  'event-bus': {
    name: 'Event bus',
    group: 'messaging',
    keywords: 'eventbridge event bus broker mediator event driven',
    kits: ['system', 'software'],
    w: 190,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const l = line(o);
      return [gen.path(roundRect(3, 6, w - 6, 16, 8), o), ...[0.25, 0.5, 0.75].flatMap((f) => [gen.line(w * f, 22, w * f, 38, l), gen.circle(w * f, 41, 7, o)])];
    },
  },
  notification: {
    name: 'Push notifications',
    group: 'messaging',
    keywords: 'push apns fcm onesignal notification alert mobile push',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 24} 52 Q${c - 18} 48 ${c - 18} 34 Q${c - 18} 10 ${c} 10 Q${c + 18} 10 ${c + 18} 34 Q${c + 18} 48 ${c + 24} 52 Z`, o),
        gen.circle(c, 57, 9, l),
        gen.line(c, 4, c, 10, l),
      ];
    },
  },
  email: {
    name: 'Email / SMS',
    group: 'messaging',
    keywords: 'smtp ses sendgrid mailgun postmark twilio sms text message',
    w: 110,
    h: 78,
    labelY: 68,
    draw: (o, w) => [gen.rectangle(w / 2 - 34, 6, 68, 44, o), gen.linearPath([[w / 2 - 34, 6], [w / 2, 30], [w / 2 + 34, 6]], line(o))],
  },

  // Observability / ops
  monitoring: {
    name: 'Metrics / monitoring',
    group: 'ops',
    keywords: 'prometheus grafana datadog cloudwatch new relic metrics dashboard monitoring slo nms snmp zabbix nagios prtg',
    kits: ['system', 'network'],
    w: 140,
    h: 80,
    labelY: 70,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(`M${c - 42} 52 A42 42 0 0 1 ${c + 42} 52 Z`, o), gen.line(c, 52, c + 20, 24, { ...line(o), strokeWidth: 2 })];
    },
  },
  logging: {
    name: 'Logging',
    group: 'ops',
    keywords: 'elk elasticsearch loki splunk logs logstash fluentd fluent bit cloudwatch logs',
    w: 100,
    h: 92,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 24} 4 H${c + 12} L${c + 24} 16 V66 H${c - 24} Z`, o),
        gen.linearPath([[c + 12, 4], [c + 12, 16], [c + 24, 16]], l),
        ...[28, 38, 48].map((y) => gen.line(c - 15, y, c + 15, y, l)),
        gen.line(c - 15, 58, c + 4, 58, l),
      ];
    },
  },
  tracing: {
    name: 'Tracing',
    group: 'ops',
    keywords: 'jaeger zipkin opentelemetry otel tempo apm spans distributed tracing',
    w: 140,
    h: 72,
    labelY: 62,
    draw: (o) => [gen.rectangle(6, 4, 70, 11, o), gen.rectangle(30, 19, 60, 11, o), gen.rectangle(52, 34, 80, 11, o)],
  },
  alerting: {
    name: 'Alerting / on-call',
    group: 'ops',
    keywords: 'pagerduty opsgenie alertmanager alerts incident on call',
    w: 130,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = { ...line(o), strokeWidth: 2.4 };
      return [gen.polygon([[c, 4], [c + 36, 62], [c - 36, 62]], o), gen.line(c, 24, c, 44, l), gen.line(c, 51, c, 54, l)];
    },
  },
  'ci-cd': {
    name: 'CI/CD pipeline',
    group: 'ops',
    keywords: 'github actions jenkins gitlab ci argo cd circleci deploy pipeline build release',
    w: 170,
    h: 68,
    labelY: 58,
    draw: (o) =>
      [0, 1, 2].map((i) => {
        const x = 4 + i * 52;
        return gen.polygon([[x, 4], [x + 40, 4], [x + 54, 24], [x + 40, 44], [x, 44], [x + 14, 24]], o);
      }),
  },
  registry: {
    name: 'Service registry',
    group: 'ops',
    keywords: 'consul etcd zookeeper eureka service discovery config configuration parameter store',
    w: 200,
    h: 56,
    labelX: 110,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.list(o, 26, h / 2)],
  },
  'feature-flags': {
    name: 'Feature flags',
    group: 'ops',
    keywords: 'launchdarkly unleash growthbook toggles experiments a/b testing rollout',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.line(c - 20, 4, c - 20, 64, { ...line(o), strokeWidth: 2 }), gen.path(`M${c - 20} 6 H${c + 24} L${c + 14} 20 L${c + 24} 34 H${c - 20} Z`, o)];
    },
  },

  // Analytics / AI
  'stream-processor': {
    name: 'Stream processor',
    group: 'analytics',
    keywords: 'flink spark streaming kafka streams beam dataflow ksqldb real time processing',
    w: 180,
    h: 56,
    labelX: 100,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.gear(o, 26, h / 2)],
  },
  batch: {
    name: 'Batch processing',
    group: 'analytics',
    keywords: 'spark hadoop mapreduce emr dataproc databricks batch jobs',
    w: 170,
    h: 64,
    labelX: 79,
    labelY: 40,
    draw: (o, w, h) => [16, 10, 4].map((d) => gen.rectangle(d, 20 - d, w - 20, h - 20, o)),
  },
  etl: {
    name: 'ETL pipeline',
    group: 'analytics',
    keywords: 'etl elt airbyte fivetran dbt ingestion pipeline cdc debezium',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.polygon([[c - 36, 4], [c + 36, 4], [c + 8, 34], [c + 8, 60], [c - 8, 60], [c - 8, 34]], o)];
    },
  },
  'ml-model': {
    name: 'ML model',
    group: 'analytics',
    keywords: 'inference sagemaker vertex model serving tensorflow pytorch recommendation ranking feed ranking classifier',
    w: 120,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const layers: [number, number][][] = [
        [[c - 34, 16], [c - 34, 44]],
        [[c, 8], [c, 30], [c, 52]],
        [[c + 34, 30]],
      ];
      const links = layers.slice(1).flatMap((to, i) => to.flatMap((b) => layers[i].map((a) => gen.line(...a, ...b, l))));
      return [...links, ...layers.flat().map(([x, y]) => gen.circle(x, y, 13, o))];
    },
  },
  llm: {
    name: 'LLM',
    group: 'analytics',
    keywords: 'ai agent openai anthropic claude gpt gemini llama chat completion rag genai',
    w: 140,
    h: 70,
    labelX: 78,
    labelY: 28,
    draw: (o, w) => [
      gen.path(`M17 3 H${w - 17} Q${w - 3} 3 ${w - 3} 17 V39 Q${w - 3} 53 ${w - 17} 53 H44 L26 66 L30 53 H17 Q3 53 3 39 V17 Q3 3 17 3 Z`, o),
      ...glyph.sparkle(o, 26, 28),
    ],
  },

  // Third party
  external: {
    name: 'External API',
    group: 'external',
    keywords: 'third party saas partner webhook vendor integration',
    kits: ['system', 'software'],
    w: 150,
    h: 56,
    labelY: 28,
    dashed: true,
    draw: (o, w, h) => [box(o, w, h)],
  },
  payment: {
    name: 'Payment provider',
    group: 'external',
    keywords: 'stripe paypal adyen braintree billing checkout card subscription',
    w: 160,
    h: 78,
    labelY: 50,
    dashed: true,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 8), o), gen.line(3, 18, w - 3, 18, { ...line(o), strokeWidth: 6 })],
  },

  // Network: routing / switching
  router: {
    name: 'Router',
    group: 'net-core',
    keywords: 'router gateway edge router cisco mikrotik juniper bgp ospf nat wan',
    w: 120,
    h: 70,
    labelY: 62,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [...cylinder(o, w, 46), ...arrow(l, c - 30, c - 6, 26), ...arrow(l, c + 30, c + 6, 26)];
    },
  },
  switch: {
    name: 'Switch',
    group: 'net-core',
    keywords: 'switch layer 2 l2 ethernet lan access switch poe vlan cisco catalyst aruba',
    w: 140,
    h: 66,
    labelY: 58,
    draw: (o, w) => {
      const l = line(o), m = w / 2;
      return [gen.rectangle(4, 6, w - 8, 34, o), ...arrow(l, 22, m - 6, 16), ...arrow(l, m + 6, w - 22, 16), ...arrow(l, m - 6, 22, 30), ...arrow(l, w - 22, m + 6, 30)];
    },
  },
  'l3-switch': {
    name: 'Layer 3 switch',
    group: 'net-core',
    keywords: 'l3 multilayer core switch distribution switch inter vlan routing',
    w: 110,
    h: 82,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.rectangle(c - 32, 4, 64, 48, o),
        ...arrow(l, c - 6, c - 24, 28),
        ...arrow(l, c + 6, c + 24, 28),
        gen.line(c, 22, c, 10, l),
        gen.linearPath([[c - 4, 14], [c, 10], [c + 4, 14]], l),
        gen.line(c, 34, c, 46, l),
        gen.linearPath([[c - 4, 42], [c, 46], [c + 4, 42]], l),
      ];
    },
  },
  hub: {
    name: 'Hub',
    group: 'net-core',
    keywords: 'hub repeater ethernet hub',
    w: 130,
    h: 60,
    labelY: 50,
    draw: (o, w) => [gen.rectangle(4, 8, w - 8, 24, o), ...Array.from({ length: 6 }, (_, i) => gen.rectangle(16 + i * 17, 16, 9, 8, line(o)))],
  },
  'access-point': {
    name: 'Wireless AP',
    group: 'net-core',
    keywords: 'wifi wi-fi wireless access point ap wlan ubiquiti unifi mesh',
    w: 100,
    h: 82,
    labelY: 72,
    draw: (o, w) => [gen.path(roundRect(w / 2 - 26, 40, 52, 16, 8), o), ...glyph.wifi(o, w / 2, 34)],
  },
  'wireless-controller': {
    name: 'Wireless controller',
    group: 'net-core',
    keywords: 'wlc wifi controller wireless lan controller',
    w: 180,
    h: 56,
    labelX: 100,
    labelY: 28,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 4), o), ...glyph.wifi(o, 26, 38)],
  },
  modem: {
    name: 'Modem / ONT',
    group: 'net-core',
    keywords: 'modem ont fiber dsl cable modem isp box adsl vdsl gpon',
    w: 100,
    h: 74,
    labelY: 64,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.line(c - 22, 22, c - 28, 4, l), gen.line(c + 22, 22, c + 28, 4, l), gen.rectangle(c - 34, 22, 68, 24, o), ...[0, 1, 2, 3].map((i) => gen.circle(c - 18 + i * 12, 34, 4, l))];
    },
  },
  'patch-panel': {
    name: 'Patch panel',
    group: 'net-core',
    keywords: 'patch panel cabling structured cabling rj45 keystone',
    w: 160,
    h: 60,
    labelY: 52,
    draw: (o, w) => [
      gen.rectangle(4, 6, w - 8, 30, o),
      ...[12, 23].flatMap((y) => Array.from({ length: 8 }, (_, i) => gen.rectangle(16 + i * 17, y, 9, 7, line(o)))),
    ],
  },

  // Network: end devices
  pc: {
    name: 'Desktop PC',
    group: 'net-device',
    keywords: 'pc computer desktop workstation end user host windows mac',
    w: 130,
    h: 86,
    labelY: 78,
    draw: (o) => {
      const l = line(o);
      return [
        gen.rectangle(4, 6, 80, 48, o),
        gen.line(44, 54, 44, 62, l),
        gen.line(28, 64, 60, 64, l),
        gen.rectangle(94, 4, 30, 62, o),
        gen.line(100, 14, 118, 14, l),
        gen.line(100, 22, 118, 22, l),
      ];
    },
  },
  laptop: {
    name: 'Laptop',
    group: 'net-device',
    keywords: 'laptop notebook macbook portable computer',
    w: 110,
    h: 74,
    labelY: 66,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.rectangle(c - 32, 6, 64, 40, o), gen.polygon([[c - 40, 46], [c + 40, 46], [c + 48, 56], [c - 48, 56]], o)];
    },
  },
  printer: {
    name: 'Printer',
    group: 'net-device',
    keywords: 'printer mfp copier print server scanner',
    w: 100,
    h: 80,
    labelY: 72,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 20, 4, 40, 16, l), gen.rectangle(c - 36, 18, 72, 30, o), gen.circle(c + 26, 26, 4, l), gen.rectangle(c - 22, 42, 44, 16, l)];
    },
  },
  'ip-phone': {
    name: 'IP phone',
    group: 'net-device',
    keywords: 'voip sip phone desk phone telephone pbx',
    w: 100,
    h: 80,
    labelY: 72,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.polygon([[c - 30, 24], [c + 30, 24], [c + 36, 58], [c - 36, 58]], o),
        gen.path(roundRect(c - 34, 8, 68, 14, 7), o),
        ...[0, 1, 2].flatMap((i) => [gen.circle(c - 12 + i * 12, 36, 4, l), gen.circle(c - 12 + i * 12, 47, 4, l)]),
      ];
    },
  },
  camera: {
    name: 'IP camera',
    group: 'net-device',
    keywords: 'cctv security camera surveillance nvr dvr',
    w: 100,
    h: 76,
    labelY: 66,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.line(c - 20, 30, c - 20, 48, l),
        gen.line(c - 32, 48, c - 8, 48, l),
        gen.rectangle(c - 34, 10, 52, 20, o),
        gen.polygon([[c + 18, 10], [c + 34, 5], [c + 34, 35], [c + 18, 30]], o),
      ];
    },
  },

  // Network: racks / storage / power
  rack: {
    name: 'Server rack',
    group: 'net-infra',
    keywords: 'rack cabinet server room data center 42u',
    w: 100,
    h: 104,
    labelY: 96,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 26, 2, 52, 78, o), ...[0, 1, 2, 3, 4].flatMap((i) => [gen.line(c - 20, 10 + i * 14, c + 20, 10 + i * 14, l), gen.circle(c + 14, 16 + i * 14, 3, l)])];
    },
  },
  nas: {
    name: 'NAS / SAN',
    group: 'net-infra',
    keywords: 'nas san storage synology qnap file server iscsi raid backup',
    w: 100,
    h: 82,
    labelY: 72,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.rectangle(c - 34, 4, 68, 52, o), ...[0, 1, 2, 3].map((i) => gen.rectangle(c - 28 + i * 15, 10, 11, 40, line(o)))];
    },
  },
  ups: {
    name: 'UPS / power',
    group: 'net-infra',
    keywords: 'ups power battery pdu generator electricity',
    w: 100,
    h: 82,
    labelY: 72,
    draw: (o, w) => {
      const c = w / 2;
      return [
        gen.rectangle(c - 8, 2, 16, 6, o),
        gen.rectangle(c - 30, 8, 60, 50, o),
        gen.linearPath([[c + 4, 16], [c - 7, 34], [c + 5, 34], [c - 6, 52]], { ...line(o), stroke: NOTE_COLOR, strokeWidth: 2 }),
      ];
    },
  },

  // Network: WAN / internet
  internet: {
    name: 'Internet',
    group: 'net-wan',
    keywords: 'internet www wan isp mpls cloud public network',
    w: 170,
    h: 90,
    labelY: 60,
    draw: (o, w, h) => [cloud(o, w, h)],
  },
  'cell-tower': {
    name: 'Cell tower',
    group: 'net-wan',
    keywords: '4g 5g lte cellular mobile network base station antenna radio',
    w: 100,
    h: 86,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const t = 22;
      const arc = (r: number, side: 1 | -1) => gen.path(`M${c + side * r * 0.5} ${t - r * 0.866} A${r} ${r} 0 0 ${side > 0 ? 1 : 0} ${c + side * r * 0.5} ${t + r * 0.866}`, l);
      return [gen.polygon([[c, t], [c + 18, 66], [c - 18, 66]], o), gen.line(c - 9, 42, c + 9, 42, l), gen.line(c - 14, 54, c + 14, 54, l), gen.circle(c, t, 8, o), arc(14, 1), arc(22, 1), arc(14, -1), arc(22, -1)];
    },
  },

  // Clients / users
  'desktop-app': {
    name: 'Desktop app',
    group: 'client',
    keywords: 'electron tauri native desktop windows macos linux app wpf qt winforms',
    kits: ['system', 'network'],
    w: 130,
    h: 80,
    labelY: 46,
    draw: (o, w, h) => [gen.rectangle(4, 4, w - 8, h - 8, o), gen.line(4, 18, w - 4, 18, line(o)), ...[0, 1, 2].map((i) => gen.circle(14 + i * 9, 11, 4, line(o)))],
  },
  console: {
    name: 'TV / console',
    group: 'client',
    keywords: 'smart tv game console playstation xbox nintendo switch set top box apple tv roku chromecast display digital signage projector screen',
    kits: ['system', 'network'],
    w: 130,
    h: 86,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 44, 4, 88, 52, o), gen.line(c - 12, 56, c - 16, 64, l), gen.line(c + 12, 56, c + 16, 64, l), gen.line(c - 24, 64, c + 24, 64, l)];
    },
  },
  admin: tiled('Admin / back office', 'client', 'admin panel back office backoffice internal tool retool dashboard staff console cms ui', glyph.list, 190),

  // Edge / security
  ddos: {
    name: 'DDoS protection',
    group: 'edge',
    keywords: 'ddos shield aws shield cloudflare magic transit scrubbing anti-ddos akamai prolexic volumetric',
    kits: ['system', 'network'],
    w: 100,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(`M${c} 2 L${w - 14} 12 L${w - 14} 32 Q${w - 14} 52 ${c} 64 Q14 52 14 32 L14 12 Z`, o), ...glyph.wave(o, c, 32)];
    },
  },
  certificate: {
    name: 'Certificates / PKI',
    group: 'edge',
    keywords: 'tls ssl certificate ca pki acm lets encrypt letsencrypt cert-manager mtls x509 signing',
    kits: ['system', 'network'],
    w: 100,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.rectangle(c - 28, 4, 56, 44, o),
        gen.line(c - 20, 14, c + 20, 14, l),
        gen.line(c - 20, 22, c + 6, 22, l),
        gen.circle(c + 12, 46, 16, o),
        gen.linearPath([[c + 6, 53], [c + 4, 66], [c + 12, 61], [c + 20, 66], [c + 18, 53]], l),
      ];
    },
  },

  // Network
  'nat-gateway': {
    name: 'NAT / internet gateway',
    group: 'network',
    keywords: 'nat gateway internet gateway igw egress cloud nat snat masquerade outbound',
    kits: ['system', 'network'],
    w: 120,
    h: 86,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 30, 56, o), gen.line(c - 14, 18, c - 14, 42, l), ...arrow(l, c - 14, c + 16, 30)];
    },
  },
  'forward-proxy': {
    name: 'Forward proxy',
    group: 'network',
    keywords: 'squid forward proxy egress proxy web filter zscaler secure web gateway swg content filter outbound proxy',
    kits: ['system', 'network'],
    w: 160,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[3, 3], [w - 20, 3], [w - 3, h - 3], [20, h - 3]], o)],
  },
  'service-discovery': {
    name: 'Service discovery',
    group: 'network',
    keywords: 'consul eureka zookeeper etcd service registry dns-sd discovery nacos',
    w: 110,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const around: [number, number][] = [[c, 8], [c - 26, 50], [c + 26, 50]];
      return [...around.map(([x, y]) => gen.line(c, 34, x, y, l)), ...around.map(([x, y]) => gen.circle(x, y, 14, o)), gen.circle(c, 34, 20, o)];
    },
  },
  webrtc: tiled('WebRTC / media relay', 'network', 'webrtc turn stun sfu mcu media server janus mediasoup livekit agora voice video call conferencing', glyph.wave, 190),

  // Compute
  bff: tiled('GraphQL / BFF', 'compute', 'graphql apollo hasura bff backend for frontend federation schema stitching resolver', glyph.graph, 170),
  'game-server': tiled('Game server', 'compute', 'dedicated game server multiplayer authoritative tick netcode photon agones gamelift playfab matchmaking lobby relay', glyph.gamepad, 170),
  gpu: {
    name: 'GPU / accelerator',
    group: 'compute',
    keywords: 'gpu cuda nvidia tpu inference accelerator a100 h100 gpu node triton vllm',
    w: 110,
    h: 88,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const pins = [0, 1, 2, 3].flatMap((i) => {
        const x = c - 15 + i * 10, y = 17 + i * 10;
        return [gen.line(x, 0, x, 6, l), gen.line(x, 58, x, 64, l), gen.line(c - 32, y, c - 26, y, l), gen.line(c + 26, y, c + 32, y, l)];
      });
      return [gen.rectangle(c - 26, 6, 52, 52, o), gen.rectangle(c - 12, 20, 24, 24, l), ...pins];
    },
  },
  media: tiled('Media processing', 'compute', 'transcoding ffmpeg video audio image resize thumbnail encoder mediaconvert mux hls dash streaming vod', glyph.play, 180),
  mainframe: {
    name: 'Mainframe / legacy',
    group: 'compute',
    keywords: 'mainframe legacy cobol as400 ibm z erp on-prem monolith system of record',
    w: 110,
    h: 96,
    labelY: 88,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 30, 2, 60, 72, o), ...[0, 1, 2, 3, 4].map((i) => gen.line(c - 22, 12 + i * 10, c + 22, 12 + i * 10, l)), gen.circle(c + 18, 64, 5, l)];
    },
  },

  // Data
  olap: {
    name: 'OLAP / columnar',
    group: 'data',
    keywords: 'clickhouse druid pinot olap columnar duckdb starrocks analytics database cube',
    w: 150,
    h: 76,
    labelX: 88,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), ...glyph.bars(o, 28, 44)],
  },
  'block-storage': {
    name: 'Block storage',
    group: 'data',
    keywords: 'ebs disk volume block storage persistent volume pv pvc ssd persistent disk iscsi',
    w: 120,
    h: 78,
    labelY: 70,
    draw: (o, w) =>
      [36, 22, 8].flatMap((y) => [gen.path(`M8 ${y} L8 ${y + 10} A${w / 2 - 8} 7 0 0 0 ${w - 8} ${y + 10} L${w - 8} ${y}`, o), gen.ellipse(w / 2, y, w - 16, 14, o)]),
  },
  'local-db': {
    name: 'On-device storage',
    group: 'data',
    keywords: 'sqlite indexeddb localstorage local storage realm core data room on device embedded database offline keychain',
    w: 110,
    h: 90,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(roundRect(c - 24, 2, 48, 70, 8), line(o)), gen.path(`M${c - 14} 26 L${c - 14} 50 A14 5 0 0 0 ${c + 14} 50 L${c + 14} 26`, o), gen.ellipse(c, 26, 28, 10, o)];
    },
  },
  backup: {
    name: 'Backup / archive',
    group: 'data',
    keywords: 'backup snapshot archive glacier cold storage restore disaster recovery dr velero veeam borg restic',
    kits: ['system', 'network'],
    w: 110,
    h: 78,
    labelY: 70,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.rectangle(c - 28, 20, 56, 38, o), gen.rectangle(c - 32, 6, 64, 14, o), gen.path(roundRect(c - 9, 28, 18, 7, 3), line(o))];
    },
  },
  ledger: {
    name: 'Ledger / blockchain',
    group: 'data',
    keywords: 'blockchain ledger ethereum solana smart contract web3 immutable qldb chain crypto wallet',
    w: 150,
    h: 64,
    labelY: 56,
    draw: (o) => {
      const l = line(o);
      return [gen.line(40, 22, 60, 22, l), gen.line(90, 22, 110, 22, l), ...[10, 60, 110].map((x) => gen.rectangle(x, 7, 30, 30, o))];
    },
  },

  // Messaging / events
  webhook: tiled('Webhook', 'messaging', 'webhook callback http callback event delivery svix hookdeck outgoing webhooks', glyph.link, 150),
  cdc: {
    name: 'Change data capture',
    group: 'messaging',
    keywords: 'cdc debezium change data capture binlog wal outbox replication fivetran dms',
    w: 160,
    h: 72,
    labelY: 64,
    draw: (o, w) => {
      const l = line(o);
      return [
        gen.path('M4 12 L4 40 A25 7 0 0 0 54 40 L54 12', o),
        gen.ellipse(29, 12, 50, 14, o),
        ...arrow(l, 62, 98, 26),
        ...[16, 26, 36].map((y) => gen.line(108, y, w - 4, y, l)),
      ];
    },
  },
  mqtt: tiled('MQTT broker', 'messaging', 'mqtt broker mosquitto emqx hivemq aws iot core azure iot hub amqp coap telemetry', glyph.wifi, 160, {
    kits: ['system', 'network'],
    draw: (o, w, h) => [box(o, w, h), ...glyph.wifi(o, 26, 38)],
  }),

  // Observability / ops
  iac: tiled('Infrastructure as code', 'ops', 'terraform pulumi cloudformation cdk ansible crossplane bicep opentofu iac provisioning', glyph.doc, 210),
  git: tiled('Source control', 'ops', 'git github gitlab bitbucket repository repo source code version control monorepo pull request', glyph.branch, 170),
  config: tiled('Config / settings', 'ops', 'config server parameter store app config consul kv spring cloud config remote config env settings', glyph.gear, 170),

  // Analytics / AI
  agent: tiled('AI agent', 'analytics', 'ai agent autonomous agent tool use function calling mcp langchain langgraph crewai assistant copilot planner', glyph.robot, 150),
  bi: tiled('BI / dashboard', 'analytics', 'bi dashboard grafana metabase looker tableau power bi superset redash reporting kpi', glyph.bars, 170),
  'product-analytics': tiled('Product analytics', 'analytics', 'segment amplitude mixpanel posthog google analytics ga4 heap events tracking telemetry snowplow rudderstack', glyph.trend, 190),
  'feature-store': {
    name: 'Feature store',
    group: 'analytics',
    keywords: 'feast tecton feature store ml features online offline hopsworks',
    w: 150,
    h: 76,
    labelX: 86,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), ...glyph.list(o, 28, 46)],
  },
  recommender: tiled('Recommendation engine', 'analytics', 'recommendation recommender personalization ranking collaborative filtering feed ranking two tower', glyph.star, 220),
  notebook: {
    name: 'Notebook',
    group: 'analytics',
    keywords: 'jupyter notebook databricks colab sagemaker studio hex data science experiment',
    w: 100,
    h: 82,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 22, 4, 48, 58, o), ...[0, 1, 2, 3].map((i) => gen.circle(c - 22, 14 + i * 13, 6, l)), ...[18, 28, 38].map((y, i) => gen.line(c - 10, y, c + (i === 2 ? 6 : 16), y, l))];
    },
  },
  training: tiled('Model training', 'analytics', 'training pipeline fine tuning fine-tune gpu cluster sagemaker vertex ai kubeflow mlflow mlops experiment tracking', glyph.cycle, 180),

  // Third party
  sms: tiled('SMS / voice', 'external', 'twilio sms voice otp call vonage messagebird whatsapp sinch phone verification', glyph.phone, 160, { dashed: true }),
  maps: tiled('Maps / geo', 'external', 'google maps mapbox geocoding location gps here osm openstreetmap routing geolocation places', glyph.pin, 160, { dashed: true }),
  crm: tiled('CRM / ERP', 'external', 'salesforce hubspot sap erp crm zendesk netsuite dynamics odoo customer support helpdesk', glyph.list, 160, { dashed: true }),
  'cloud-provider': {
    name: 'Cloud provider',
    group: 'external',
    keywords: 'aws amazon web services azure gcp google cloud oracle cloud ibm cloud digitalocean hetzner ovh cloud account tenant',
    kits: ['system', 'network'],
    w: 170,
    h: 90,
    labelY: 60,
    dashed: true,
    draw: (o, w, h) => [cloud(o, w, h)],
  },

  // Network: routing / switching
  'sd-wan': {
    name: 'SD-WAN edge',
    group: 'net-core',
    keywords: 'sd-wan sdwan velocloud meraki mx fortinet silver peak viptela branch wan edge',
    w: 120,
    h: 70,
    labelY: 62,
    draw: (o, w) => [...cylinder(o, w, 46), gen.path(waves(w / 2 - 24, 26, 4, 12), line(o))],
  },
  'media-converter': {
    name: 'Media converter',
    group: 'net-core',
    keywords: 'media converter sfp sfp+ transceiver fiber copper gbic optics qsfp',
    w: 110,
    h: 60,
    labelY: 52,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 34, 8, 68, 26, o), gen.rectangle(c - 26, 16, 12, 10, l), gen.rectangle(c + 14, 16, 12, 10, l), gen.line(c - 10, 21, c + 10, 21, l)];
    },
  },
  kvm: {
    name: 'KVM / console server',
    group: 'net-core',
    keywords: 'kvm console server serial out of band oob ipmi idrac ilo bmc lantronix opengear',
    w: 120,
    h: 70,
    labelY: 62,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 30, 4, 60, 26, o), gen.rectangle(c - 40, 34, 80, 16, o), ...Array.from({ length: 6 }, (_, i) => gen.line(c - 32 + i * 12, 42, c - 26 + i * 12, 42, l))];
    },
  },
  pbx: tiled('PBX / VoIP gateway', 'net-core', 'pbx voip gateway asterisk 3cx sip trunk freepbx call manager cucm session border controller sbc', glyph.phone, 190),
  ntp: tiled('NTP / time server', 'net-core', 'ntp ptp time server gps clock stratum chrony', glyph.clock, 180),
  ipam: tiled('DHCP / IPAM', 'net-core', 'dhcp ipam infoblox address management ip allocation dhcp server netbox phpipam', glyph.list, 160),

  // Network: end devices
  server: {
    name: 'Rack server',
    group: 'net-device',
    keywords: 'rack server 1u 2u dell poweredge hp proliant supermicro bare metal hypervisor host esxi proxmox',
    w: 150,
    h: 58,
    labelY: 50,
    draw: (o, w) => {
      const l = line(o);
      return [gen.rectangle(4, 6, w - 8, 30, o), ...Array.from({ length: 5 }, (_, i) => gen.rectangle(12 + i * 16, 12, 12, 18, l)), gen.circle(w - 20, 21, 6, l)];
    },
  },
  tablet: {
    name: 'Tablet',
    group: 'net-device',
    keywords: 'ipad tablet android tablet surface kiosk handheld scanner',
    w: 110,
    h: 76,
    labelY: 68,
    draw: (o, w) => [gen.path(roundRect(w / 2 - 34, 4, 68, 50, 6), o), gen.circle(w / 2 + 28, 29, 3, line(o))],
  },
  pos: {
    name: 'POS terminal',
    group: 'net-device',
    keywords: 'pos point of sale card reader payment terminal cash register checkout kiosk verifone ingenico',
    w: 100,
    h: 76,
    labelY: 68,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.polygon([[c - 20, 4], [c + 20, 4], [c + 16, 30], [c - 16, 30]], o), gen.rectangle(c - 30, 32, 60, 24, o), gen.line(c - 20, 42, c + 20, 42, line(o))];
    },
  },
  'badge-reader': {
    name: 'Access control',
    group: 'net-device',
    keywords: 'badge reader card reader rfid nfc door access control turnstile biometric fingerprint intercom',
    w: 100,
    h: 80,
    labelY: 72,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.path(roundRect(c - 16, 2, 32, 58, 6), o), gen.circle(c, 22, 14, l), gen.line(c - 8, 42, c + 8, 42, l), gen.circle(c, 51, 3, l)];
    },
  },
  nvr: {
    name: 'NVR / recorder',
    group: 'net-device',
    keywords: 'nvr dvr video recorder surveillance storage cctv recorder hikvision',
    w: 130,
    h: 58,
    labelY: 50,
    draw: (o, w) => [gen.rectangle(4, 6, w - 8, 30, o), ...glyph.play(o, 26, 21), ...[0, 1, 2].map((i) => gen.circle(w - 40 + i * 10, 21, 4, line(o)))],
  },

  // Network: racks / storage / power
  pdu: {
    name: 'PDU',
    group: 'net-infra',
    keywords: 'pdu power distribution unit power strip rack power metered switched',
    w: 150,
    h: 46,
    labelY: 38,
    draw: (o, w) => [gen.rectangle(4, 6, w - 8, 18, o), ...Array.from({ length: 6 }, (_, i) => gen.rectangle(16 + i * 20, 11, 8, 8, line(o)))],
  },
  generator: {
    name: 'Generator',
    group: 'net-infra',
    keywords: 'generator diesel backup power genset ats automatic transfer switch fuel',
    w: 120,
    h: 76,
    labelY: 68,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.rectangle(c - 40, 4, 80, 46, o),
        gen.circle(c - 16, 27, 28, l),
        gen.linearPath([[c + 18, 14], [c + 10, 28], [c + 20, 28], [c + 12, 42]], { ...l, stroke: NOTE_COLOR, strokeWidth: 2 }),
        gen.line(c - 34, 50, c - 34, 56, l),
        gen.line(c + 34, 50, c + 34, 56, l),
      ];
    },
  },
  cooling: {
    name: 'Cooling / HVAC',
    group: 'net-infra',
    keywords: 'crac crah hvac cooling air conditioning chiller in-row cooling airflow temperature',
    w: 100,
    h: 82,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const blades = [0, 1, 2].map((i) => {
        const a = (i * 2 * Math.PI) / 3;
        return gen.path(`M${c} 32 Q${c + 16 * Math.cos(a + 0.6)} ${32 + 16 * Math.sin(a + 0.6)} ${c + 17 * Math.cos(a)} ${32 + 17 * Math.sin(a)}`, l);
      });
      return [gen.rectangle(c - 30, 2, 60, 60, o), gen.circle(c, 32, 44, l), ...blades];
    },
  },
  tape: {
    name: 'Tape library',
    group: 'net-infra',
    keywords: 'tape library lto backup archive tape drive autoloader',
    w: 110,
    h: 66,
    labelY: 58,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 36, 4, 72, 42, o), ...[-16, 16].flatMap((d) => [gen.circle(c + d, 24, 22, l), gen.circle(c + d, 24, 6, l)]), gen.line(c - 16, 35, c + 16, 35, l)];
    },
  },

  // Network: WAN / internet
  satellite: {
    name: 'Satellite link',
    group: 'net-wan',
    keywords: 'satellite starlink vsat oneweb geo leo uplink dish ground station',
    w: 100,
    h: 86,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.path(`M${c - 26} 12 A30 30 0 0 0 ${c + 20} 54 Z`, o), gen.line(c - 4, 33, c + 12, 20, l), gen.circle(c + 14, 18, 6, l), gen.line(c - 8, 44, c - 12, 64, l), gen.line(c - 24, 64, c, 64, l)];
    },
  },
  mpls: {
    name: 'MPLS / leased line',
    group: 'net-wan',
    keywords: 'mpls leased line metro ethernet private wan dark fiber e-line carrier circuit vpls',
    w: 170,
    h: 58,
    labelY: 50,
    draw: (o, w) => {
      const l = line(o);
      return [gen.path(roundRect(4, 10, w - 8, 24, 12), o), gen.circle(18, 22, 10, l), gen.circle(w - 18, 22, 10, l), gen.line(30, 22, w - 30, 22, { ...l, strokeWidth: 2 })];
    },
  },
  microwave: {
    name: 'Wireless bridge',
    group: 'net-wan',
    keywords: 'microwave point to point p2p ptp ptmp radio link wireless bridge airfiber nanobeam licensed',
    w: 150,
    h: 72,
    labelY: 64,
    draw: (o, w) => {
      const l = line(o);
      return [...[22, w - 22].flatMap((x) => [gen.line(x, 46, x, 56, l), gen.ellipse(x, 26, 14, 40, o)]), gen.path(waves(36, 26, 6, (w - 72) / 6), l)];
    },
  },

  // Software: use case / UML
  'use-case': {
    name: 'Use case',
    group: 'sw-uml',
    keywords: 'use case usecase uml scenario user goal oval ellipse',
    w: 170,
    h: 64,
    labelY: 32,
    draw: (o, w, h) => [gen.ellipse(w / 2, h / 2, w - 6, h - 6, o)],
  },
  class: {
    name: 'Class',
    group: 'sw-uml',
    keywords: 'class uml object type attributes methods oop model',
    w: 170,
    h: 100,
    labelY: 18,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 33, w - 3, 33, l), gen.line(3, 66, w - 3, 66, l), gen.line(14, 46, w * 0.55, 46, l), gen.line(14, 79, w * 0.45, 79, l)];
    },
  },
  interface: tiled('Interface', 'sw-uml', 'interface contract protocol trait abstract api uml lollipop', glyph.lollipop, 160),
  module: {
    name: 'Component / module',
    group: 'sw-uml',
    keywords: 'uml component module bounded unit deployable part subsystem',
    w: 180,
    h: 60,
    labelX: 96,
    labelY: 30,
    draw: (o, w, h) => [gen.rectangle(12, 3, w - 15, h - 6, o), gen.rectangle(4, 13, 16, 9, o), gen.rectangle(4, h - 22, 16, 9, o)],
  },
  package: {
    name: 'Package / namespace',
    group: 'sw-uml',
    keywords: 'package namespace folder module uml directory',
    w: 180,
    h: 70,
    labelY: 42,
    draw: (o, w, h) => [gen.rectangle(3, 3, 64, 12, o), gen.rectangle(3, 15, w - 6, h - 18, o)],
  },
  table: {
    name: 'Entity / table',
    group: 'sw-uml',
    keywords: 'er erd entity relationship table schema database model columns rows',
    w: 170,
    h: 96,
    labelY: 17,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 31, w - 3, 31, l), ...[48, 63, 78].map((y, i) => gen.line(14, y, w * (0.6 - i * 0.08), y, l))];
    },
  },

  // Software: architecture
  layer: {
    name: 'Layer',
    group: 'sw-arch',
    keywords: 'layer tier presentation business domain persistence infrastructure n-tier onion clean architecture',
    w: 260,
    h: 50,
    labelY: 25,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, h - 6, o)],
  },
  ui: tiled('UI / view', 'sw-arch', 'ui view page screen frontend presentation mvc mvvm component', glyph.eye, 150),
  controller: tiled('Controller / handler', 'sw-arch', 'controller handler endpoint route resolver mvc http api', glyph.arrows, 215),
  'app-service': tiled('Application service', 'sw-arch', 'application service use case interactor orchestrator business logic service layer', glyph.gear, 210),
  repository: tiled('Repository', 'sw-arch', 'repository dao data access orm persistence', glyph.db, 160),
  port: {
    name: 'Port',
    group: 'sw-arch',
    keywords: 'port hexagonal ports and adapters inbound outbound clean architecture boundary',
    w: 150,
    h: 60,
    labelY: 30,
    draw: (o, w, h) => [gen.polygon([[3, h / 2], [22, 3], [w - 22, 3], [w - 3, h / 2], [w - 22, h - 3], [22, h - 3]], o)],
  },
  adapter: tiled('Adapter', 'sw-arch', 'adapter driver driven gateway client integration anti-corruption layer acl hexagonal', glyph.link, 150),
  library: tiled('Library / SDK', 'sw-arch', 'library sdk package dependency npm shared lib framework', glyph.doc, 170),

  // Software: domain / CQRS
  aggregate: {
    name: 'Aggregate',
    group: 'sw-ddd',
    keywords: 'aggregate root ddd domain consistency boundary',
    w: 170,
    h: 70,
    labelY: 35,
    draw: (o, w, h) => [box(o, w, h), gen.path(roundRect(10, 10, w - 20, h - 20, 7), line(o))],
  },
  entity: {
    name: 'Domain entity',
    group: 'sw-ddd',
    keywords: 'entity domain model ddd identity object',
    w: 160,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h)],
  },
  'value-object': {
    name: 'Value object',
    group: 'sw-ddd',
    keywords: 'value object ddd immutable money address dto',
    w: 160,
    h: 56,
    labelY: 28,
    dashed: true,
    draw: (o, w, h) => [box(o, w, h)],
  },
  command: tiled('Command', 'sw-ddd', 'command cqrs write intent request event storming', glyph.play, 160),
  query: tiled('Query / read model', 'sw-ddd', 'query cqrs read model projection view', glyph.list, 205),
  'domain-event': tiled('Domain event', 'sw-ddd', 'domain event sourcing fact happened event storming integration event', glyph.sparkle, 170),
  policy: tiled('Policy / saga', 'sw-ddd', 'policy saga process manager reaction orchestration choreography compensation', glyph.cycle, 170),

  // Software: flow / activity / state
  start: {
    name: 'Start',
    group: 'sw-flow',
    keywords: 'start initial node begin entry activity state flowchart',
    w: 70,
    h: 62,
    labelY: 54,
    draw: (o, w) => [gen.circle(w / 2, 18, 28, { ...o, fill: 'currentColor', fillStyle: 'solid' })],
  },
  end: {
    name: 'End',
    group: 'sw-flow',
    keywords: 'end final node finish stop terminate flowchart',
    w: 70,
    h: 62,
    labelY: 54,
    draw: (o, w) => [gen.circle(w / 2, 18, 32, line(o)), gen.circle(w / 2, 18, 18, { ...o, fill: 'currentColor', fillStyle: 'solid' })],
  },
  action: {
    name: 'Action / step',
    group: 'sw-flow',
    keywords: 'action activity step task process flowchart',
    w: 170,
    h: 52,
    labelY: 26,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, (h - 6) / 2), o)],
  },
  choice: {
    name: 'Decision / branch',
    group: 'sw-flow',
    keywords: 'decision branch condition if choice merge gateway flowchart diamond',
    w: 180,
    h: 90,
    labelY: 45,
    draw: (o, w, h) => [gen.polygon([[w / 2, 3], [w - 3, h / 2], [w / 2, h - 3], [3, h / 2]], o)],
  },
  fork: {
    name: 'Fork / join',
    group: 'sw-flow',
    keywords: 'fork join parallel sync bar concurrency split',
    w: 160,
    h: 34,
    labelY: 26,
    draw: (o, w) => [gen.rectangle(4, 3, w - 8, 7, { ...o, fill: 'currentColor', fillStyle: 'solid' })],
  },
  state: {
    name: 'State',
    group: 'sw-flow',
    keywords: 'state machine status statechart fsm mode',
    w: 160,
    h: 70,
    labelY: 17,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 14), o), gen.line(3, 31, w - 3, 31, line(o))],
  },
  signal: {
    name: 'Signal / message',
    group: 'sw-flow',
    keywords: 'signal send message emit notify event',
    w: 170,
    h: 52,
    labelX: 76,
    labelY: 26,
    draw: (o, w, h) => [gen.polygon([[3, 3], [w - 24, 3], [w - 3, h / 2], [w - 24, h - 3], [3, h - 3]], o)],
  },
  timer: tiled('Timer / wait', 'sw-flow', 'timer wait delay timeout schedule sleep time event', glyph.clock, 160),
};

/** Kits whose palette lists `t`. */
export const kitsOf = (t: ComponentType): Kit[] => SHAPES[t].kits ?? [GROUPS.find((g) => g.key === SHAPES[t].group)!.kit];

/** Lowercase text the palette search matches against. */
export const searchText = (t: ComponentType) => `${SHAPES[t].name} ${t} ${SHAPES[t].keywords}`.toLowerCase();

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
    ? { stroke: 'currentColor', strokeWidth: 1.4, roughness: 1.2, fill, fillStyle: 'hachure', hachureGap: 11, fillWeight: 0.8, seed, ...extra }
    : { stroke: 'currentColor', strokeWidth: 1.2, roughness: 0, bowing: 0, disableMultiStroke: true, fill: fill && `${fill}30`, fillStyle: 'solid', seed, ...extra };
}

export const toPaths = (drawables: Drawable[]): PathInfo[] => drawables.flatMap((d) => gen.toPaths(d));

export function drawShape(type: ComponentType, sketch: boolean, seed: number) {
  const s = SHAPES[type];
  return toPaths(s.draw(options(sketch, GROUP_COLOR[s.group], seed), s.w, s.h));
}

export { gen };

// Words too common across parts to say anything about the type.
const GENERIC = new Set('api app apps server servers web data service services system the and for with main core new application'.split(' '));
const WORDS = Object.entries(SHAPES).map(([type, s]) => [type, new Set(`${s.name} ${s.keywords}`.toLowerCase().split(/\s+/))] as const);

// Products listed under several parts, and the one they are usually drawn as.
const PREFER: Record<string, ComponentType> = { redis: 'cache', database: 'sql-db', spring: 'service' };

/**
 * Picks a part type from free text such as "PostgreSQL Orders DB" or "Kafka consumer Mailer", trying the last word first:
 * the head of a name says what a thing is ("Kafka consumer" is a worker). Undefined when nothing specific matches.
 */
export function guessType(text: string): ComponentType | undefined {
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).reverse()) {
    if (word.length < 3 || GENERIC.has(word)) continue;
    if (PREFER[word]) return PREFER[word];
    const hit = WORDS.find(([, words]) => words.has(word));
    if (hit) return hit[0] as ComponentType;
  }
}
