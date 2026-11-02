import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_TYPES } from '../core/schema.ts';
import { GROUPS, KITS, SHAPES, drawShape, guessType, insideOf, kitsOf, searchRank, searchText } from './shapes.ts';
import type { ComponentType } from '../core/schema.ts';

test('every component type draws cleanly in both styles and sits in a palette group', () => {
  const groups = new Set<string>(GROUPS.map((g) => g.key));
  for (const t of COMPONENT_TYPES) {
    assert.ok(groups.has(SHAPES[t].group), `${t} has an unknown group`);
    for (const sketch of [true, false]) {
      const paths = drawShape(t, sketch, 1);
      assert.ok(paths.length > 0, `${t} draws nothing`);
      for (const p of paths) assert.ok(!/NaN|undefined/.test(p.d), `${t} has a broken path: ${p.d.slice(0, 60)}`);
    }
  }
});

test('search matches products, not just names', () => {
  const find = (q: string) => COMPONENT_TYPES.filter((t) => searchText(t).includes(q));
  assert.ok(find('kafka').includes('stream'));
  assert.ok(find('s3').includes('object-storage'));
  assert.ok(find('nginx').includes('reverse-proxy'));
  assert.ok(find('wifi').includes('access-point'));
  assert.ok(find('active directory').includes('identity'));
});

test('the network kit has its own devices plus the shared ones', () => {
  const network = COMPONENT_TYPES.filter((t) => kitsOf(t).includes('network'));
  for (const t of ['router', 'switch', 'pc', 'printer', 'firewall', 'vm'] as const) assert.ok(network.includes(t), `${t} missing from network kit`);
  assert.ok(!network.includes('stream'), 'software-only parts stay out of the network kit');
  for (const k of KITS) assert.ok(COMPONENT_TYPES.some((t) => kitsOf(t).includes(k.key)), `${k.key} kit is empty`);
});

test('the software kit has diagram parts plus actors, services and stores', () => {
  const software = COMPONENT_TYPES.filter((t) => kitsOf(t).includes('software'));
  for (const t of ['use-case', 'class', 'port', 'aggregate', 'choice', 'state', 'user', 'service', 'sql-db'] as const) assert.ok(software.includes(t), `${t} missing from software kit`);
  for (const t of ['fragment', 'activation', 'dto', 'domain-service', 'error-event', 'page', 'state-store'] as const) assert.ok(software.includes(t), `${t} missing from software kit`);
  assert.ok(!software.includes('router'), 'network gear stays out of the software kit');
  assert.equal(guessType('Test service'), undefined);
  assert.equal(guessType('Redux'), 'state-store');
});

test('the security kit has threat parts plus the defences and systems they point at', () => {
  const security = COMPONENT_TYPES.filter((t) => kitsOf(t).includes('security'));
  for (const t of ['threat-actor', 'threat', 'vulnerability', 'asset', 'mitigation', 'mfa', 'siem', 'dlp', 'sast', 'firewall', 'waf', 'identity', 'user', 'service', 'sql-db'] as const) assert.ok(security.includes(t), `${t} missing from security kit`);
  assert.ok(!security.includes('router'), 'network gear stays out of the security kit');
  assert.ok(kitsOf('waf').includes('system'), 'shared parts stay in the system kit');
  assert.ok(kitsOf('siem').every((k) => k === 'security'), 'its own parts stay out of the other kits');
  assert.ok(kitsOf('policy-engine').includes('system'), 'shared parts stay in the system kit');
});

test('threat parts do not take words from older parts or ordinary names', () => {
  assert.equal(guessType('Vulnerability'), 'vulnerability-scanner');
  assert.equal(guessType('attacker'), 'threat-actor');
  assert.equal(guessType('Asset service'), undefined);
  assert.equal(guessType('risk'), undefined);
  assert.equal(guessType('SIEM'), 'ids');
  assert.equal(guessType('CrowdStrike'), 'edr');
});

test('a word that several parts list is never guessed as a part that does not list it, and later parts do not take old words', () => {
  const words = (t: ComponentType) => new Set(`${SHAPES[t].name} ${SHAPES[t].keywords}`.toLowerCase().split(/\s+/));
  for (const t of COMPONENT_TYPES) {
    for (const w of words(t)) {
      // guessType splits on punctuation, so "anti-ddos" is looked up as the words "anti" and "ddos".
      for (const p of w.split(/[^p{L}p{N}]+/u).filter((x) => x.length >= 3)) {
        const owner = guessType(p);
        if (owner) assert.ok(words(owner).has(p) || [...words(owner)].some((x) => x.split(/[^p{L}p{N}]+/u).includes(p)), `"${p}" guesses ${owner}, which does not list it`);
      }
    }
  }
  assert.equal(guessType('Single-Page App'), 'ui');
  assert.equal(guessType('Container registry'), 'registry');
  assert.equal(guessType('Schema registry'), 'registry');
  assert.equal(guessType('uptime-kuma'), 'status-page');
});

test('the part tables keep their order, so a shared word still means what it always did', () => {
  assert.equal(guessType('switch'), 'switch');
  assert.equal(guessType('hub'), 'hub');
  assert.equal(guessType('cell tower'), 'cell-tower');
  assert.equal(guessType('NAS backup'), 'nas');
});

test('a search ranks names before keywords', () => {
  assert.equal(searchRank('queue', ['queue']), 0);
  assert.equal(searchRank('dead-letter-queue', ['queue']), 1);
  assert.equal(searchRank('api-gateway', ['gateway']), 1);
  assert.equal(searchRank('forward-proxy', ['gateway']), 2);
  assert.equal(searchRank('stream', ['kafka']), 2);
  assert.equal(searchRank('queue', ['kafka']), undefined);
  assert.equal(searchRank('queue', []), undefined);
});

test('every hand-drawn hatch has an inside to be clipped to, so it cannot spill past the outline', () => {
  for (const t of COMPONENT_TYPES) {
    const hatched = drawShape(t, true, 3).some((p) => p.hatch);
    if (hatched) assert.ok(insideOf(t).length > 0, `${t}: hatching with nothing to clip it to`);
    assert.ok(!drawShape(t, false, 3).some((p) => p.hatch), `${t}: the clean style has no hatching`);
  }
});
