import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDesign } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { LAYOUTS, layout } from './layout.ts';
import { DECISION_SIZE, NOTE_SIZE, SHAPES } from './shapes.ts';

function sample() {
  const d = parseDesign(JSON.parse(readFileSync(new URL('../templates/twitter.json', import.meta.url), 'utf8')));
  // A boundary inside a boundary, so every layout also handles nesting.
  const region = m.addBoundary(d, { kind: 'region', label: 'Region' });
  const vpc = m.addBoundary(d, { kind: 'vpc', label: 'VPC', parent: region });
  for (const c of d.components.slice(3, 7)) m.placeIn(d, c.id, vpc);
  // A cycle: radial once recursed forever on these.
  const [x, y, z] = d.components.slice(8, 11).map((c) => c.id);
  m.connect(d, { from: x, to: y });
  m.connect(d, { from: y, to: z });
  m.connect(d, { from: z, to: x });
  return d;
}

const items = (d: ReturnType<typeof sample>) => [...d.components, ...d.notes, ...d.decisions].map((x) => x.id);

test('every layout places every item without overlaps', async () => {
  const d = sample();
  const size = new Map<string, { w: number; h: number }>([
    ...d.components.map((c) => [c.id, SHAPES[c.type]] as const),
    ...d.notes.map((n) => [n.id, NOTE_SIZE] as const),
    ...d.decisions.map((x) => [x.id, DECISION_SIZE] as const),
  ]);
  for (const { key } of LAYOUTS) {
    const pos = await layout(d, key);
    for (const id of items(d)) assert.ok(pos.has(id), `${key} left out ${id}`);
    const boxes = [...size].map(([id, s]) => ({ id, ...pos.get(id)!, ...s }));
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `${key} overlaps ${a.id} and ${b.id}`);
  }
});

test('tiers put clients above the data they reach', async () => {
  const d = sample();
  const pos = await layout(d, 'tiers');
  const y = (group: string) => d.components.filter((c) => SHAPES[c.type].group === group && !c.boundary).map((c) => pos.get(c.id)!.y);
  assert.ok(Math.max(...y('client')) < Math.min(...y('data')));
});

test('a selection moves alone and keeps its corner', async () => {
  const d = sample();
  const ids = new Set(d.components.slice(0, 4).map((c) => c.id));
  const at = new Map([...ids].map((id, i) => [id, { x: 500 + i * 10, y: 300 + i * 10 }]));
  const pos = await layout(d, 'grid', { ids, at });
  assert.deepEqual([...pos.keys()].sort(), [...ids].sort());
  assert.equal(Math.min(...[...pos.values()].map((p) => p.x)), 500);
  assert.equal(Math.min(...[...pos.values()].map((p) => p.y)), 300);
});
