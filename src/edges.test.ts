import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeGeometry } from './edges.ts';

const a = { x: 0, y: 0, w: 100, h: 60 };
const b = { x: 400, y: 0, w: 100, h: 60 };
const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;

test('a curve bends to one side, and a dragged handle sets the bend', () => {
  const ab = edgeGeometry(a, b), ba = edgeGeometry(b, a);
  assert.ok(ab.mid.y > 0 && ba.mid.y < 0, 'A→B and B→A arc apart');
  assert.ok(ab.tip.x < 350 && ab.tip.x > 340, 'stops just short of the target');
  const g = edgeGeometry(a, b, 'curve', 80);
  assert.ok(near(g.bendAt({ x: 200, y: 80 }), 80));
  assert.deepEqual(g.mid, { x: 200, y: 80 }, 'the middle passes through the handle');
});

test('an elbow runs at right angles and its middle run follows the bend', () => {
  const g = edgeGeometry(a, { ...b, y: 200 }, 'elbow', 30);
  const p = g.points!;
  for (let i = 1; i < p.length; i++) assert.ok(p[i].x === p[i - 1].x || p[i].y === p[i - 1].y, 'segment is axis-aligned');
  assert.equal(p[1].x, 230);
  assert.ok(near(g.angle, 0), 'arrow points right, into the target side');
  assert.equal(g.bendAt({ x: 250, y: 0 }), 50);
  const down = edgeGeometry(a, { ...a, y: 300 }, 'elbow');
  assert.ok(near(down.angle, Math.PI / 2), 'stacked boxes connect top to bottom');
});

test('a straight line has no handle', () => {
  const g = edgeGeometry(a, b, 'straight');
  assert.equal(g.bendable, false);
  assert.match(g.d, /^M56,0 L344,0$/);
});
