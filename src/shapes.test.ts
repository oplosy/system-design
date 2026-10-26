import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_TYPES } from '../core/schema.ts';
import { GROUPS, SHAPES, drawShape, searchText } from './shapes.ts';

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
});
