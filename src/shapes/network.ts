import type { ComponentType } from '../../core/schema.ts';
import { NOTE_COLOR, type Spec, gen, roundRect, cylinder, line, glyph, cloud, arrow } from './base.ts';

/** Parts of a physical or office network. */
export const network = {
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
    name: 'Modem',
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
    name: 'NAS',
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
    name: 'UPS',
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
} satisfies Partial<Record<ComponentType, Spec>>;
