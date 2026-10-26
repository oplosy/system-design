import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_TYPES } from '../core/schema.ts';
import { GROUPS, KITS, SHAPES, drawShape, kitsOf, searchText } from './shapes.ts';

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
  assert.ok(!software.includes('router'), 'network gear stays out of the software kit');
});
