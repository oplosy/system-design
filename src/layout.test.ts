import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDesign } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { LAYOUTS, layout, placeNew } from './layout.ts';
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

test('a selection pushes aside what it would cover', async () => {
  const d = sample();
  const size = new Map<string, { w: number; h: number }>([
    ...d.components.map((c) => [c.id, SHAPES[c.type]] as const),
    ...d.notes.map((n) => [n.id, NOTE_SIZE] as const),
    ...d.decisions.map((x) => [x.id, DECISION_SIZE] as const),
  ]);
  const w = Math.max(...[...size.values()].map((s) => s.w)) + 30, h = Math.max(...[...size.values()].map((s) => s.h)) + 30;
  // A tight grid, five to a row; the first four of the first row get stacked into a tall tree.
  const at = new Map(items(d).map((id, i) => [id, { x: (i % 5) * w, y: Math.floor(i / 5) * h }]));
  const ids = new Set(d.components.slice(0, 4).map((c) => c.id));
  const pos = await layout(d, 'tree', { ids, at });
  const boxes = items(d).map((id) => ({ id, ...(pos.get(id) ?? at.get(id)!), ...size.get(id)! }));
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1)) assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `overlaps ${a.id} and ${b.id}`);
  assert.ok([...pos.keys()].some((id) => !ids.has(id)), 'nothing was pushed');
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

test('new items land beside their neighbours, clear of everything placed by hand', async () => {
  const d = sample();
  const pos = await layout(d);
  // The sheet was laid out, then shifted and rearranged by hand; three parts arrive later without positions.
  for (const x of [...d.components, ...d.notes, ...d.decisions]) x.position = { x: pos.get(x.id)!.x + 500, y: pos.get(x.id)!.y + 300 };
  const [a, b, c] = d.components.slice(0, 3);
  const moved = d.components[3];
  // Moved by hand onto the spot the layout keeps for `a`.
  moved.position = { ...a.position! };
  for (const x of [a, b, c]) x.position = undefined;
  const before = JSON.stringify(d);
  const at = placeNew(d, pos);
  assert.equal(JSON.stringify(d), before, 'nothing placed moves');
  assert.deepEqual([...at.keys()], [a.id, b.id, c.id]);
  assert.deepEqual(at.get(b.id), { x: pos.get(b.id)!.x + 500, y: pos.get(b.id)!.y + 300 }, 'a free spot keeps the layout, shifted like the rest');
  const placedBoxes = [...d.components, ...d.notes, ...d.decisions]
    .filter((x) => x.position)
    .map((x) => ({ ...x.position!, ...('type' in x ? SHAPES[x.type] : 'text' in x ? NOTE_SIZE : DECISION_SIZE) }));
  for (const x of [a, b, c]) {
    const p = { ...at.get(x.id)!, ...SHAPES[x.type] };
    for (const q of placedBoxes) assert.ok(p.x >= q.x + q.w || q.x >= p.x + p.w || p.y >= q.y + q.h || q.y >= p.y + p.h, `${x.id} covers a placed item`);
  }
  const p = at.get(a.id)!;
  assert.ok(Math.hypot(p.x - moved.position!.x, p.y - moved.position!.y) < 400, 'pushed only as far as needed');
  // With nothing placed yet, the layout is used as it is.
  const blank = sample();
  assert.deepEqual(placeNew(blank, pos), new Map([...blank.components, ...blank.notes, ...blank.decisions].map((x) => [x.id, pos.get(x.id)!])));
});
