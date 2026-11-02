import type { ComponentType } from '../../core/schema.ts';
import { NOTE_COLOR, type Spec, gen, roundRect, cylinder, line, glyph, tiled, waves } from './base.ts';

/** Parts added after the first release. guessType ranks them last (see FALLBACK in shapes.ts). */
export const networkMore = {
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
    name: 'KVM',
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
    name: 'NVR',
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
    name: 'Cooling',
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
    name: 'MPLS',
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
} satisfies Partial<Record<ComponentType, Spec>>;
