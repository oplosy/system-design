import type { Options } from 'roughjs/bin/core';
import type { ComponentType } from '../../core/schema.ts';
import { type Spec, gen, line } from './base.ts';

const shield = (o: Options, c: number) => gen.path(`M${c} 3 L${c + 28} 13 V34 Q${c + 28} 54 ${c} 66 Q${c - 28} 54 ${c - 28} 34 V13 Z`, o);

/** Parts of a threat model. The defences it points at come from the system kit (see `kits` on those parts). */
export const security = {
  'threat-actor': {
    name: 'Threat actor',
    group: 'threat',
    keywords: 'attacker adversary hacker malicious insider intruder',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 26} 64 Q${c - 28} 40 ${c - 16} 30 Q${c - 20} 4 ${c} 4 Q${c + 20} 4 ${c + 16} 30 Q${c + 28} 40 ${c + 26} 64 Z`, o),
        gen.ellipse(c, 24, 20, 24, l),
        gen.line(c - 6, 22, c - 2, 24, l),
        gen.line(c + 6, 22, c + 2, 24, l),
      ];
    },
  },
  threat: {
    name: 'Threat',
    group: 'threat',
    keywords: 'attack stride spoofing tampering repudiation disclosure elevation exploit abuse',
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.polygon([[c, 4], [c + 36, 62], [c - 36, 62]], o), gen.line(c, 24, c, 44, { ...l, strokeWidth: 2.4 }), gen.circle(c, 53, 3, l)];
    },
  },
  vulnerability: {
    name: 'Vulnerability',
    group: 'threat',
    keywords: 'weakness cve cwe owasp flaw exposure misconfiguration',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [shield(o, c), gen.linearPath([[c + 3, 3], [c - 6, 20], [c + 5, 30], [c - 5, 44], [c + 2, 66]], line(o))];
    },
  },
  asset: {
    name: 'Asset',
    group: 'threat',
    keywords: 'crown jewels sensitive pii phi confidential protected valuable',
    w: 110,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.polygon([[c - 22, 6], [c + 22, 6], [c + 38, 24], [c, 62], [c - 38, 24]], o), gen.line(c - 38, 24, c + 38, 24, l), gen.linearPath([[c - 22, 6], [c - 12, 24], [c, 62], [c + 12, 24], [c + 22, 6]], l)];
    },
  },
  mitigation: {
    name: 'Mitigation',
    group: 'threat',
    keywords: 'countermeasure safeguard security control compensating remediation defense hardening',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [shield(o, c), gen.linearPath([[c - 12, 33], [c - 3, 43], [c + 13, 22]], { ...line(o), strokeWidth: 2.4 })];
    },
  },
} satisfies Partial<Record<ComponentType, Spec>>;
