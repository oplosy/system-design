import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesign } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { boundaryAt, boundaryBoxes, type Box } from './boundaries.ts';
import { layout } from './layout.ts';

const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('auto layout keeps each boundary around its members without overlaps', async () => {
  const d = parseDesign({ id: 'office', title: 'Office', rev: 0, steps: [{ id: 'start', title: 'Start', seen: true }], components: [], connections: [], notes: [], decisions: [] });
  const site = m.addBoundary(d, { kind: 'site', label: 'HQ' });
  const office = m.addBoundary(d, { kind: 'vlan', label: 'Office', detail: 'VLAN 10', parent: site });
  const voice = m.addBoundary(d, { kind: 'vlan', label: 'Voice', detail: 'VLAN 20', parent: site });
  const router = m.addComponent(d, { type: 'router', label: 'Router' });
  const sw = m.addComponent(d, { type: 'switch', label: 'Switch', boundary: site });
  const pcs = ['PC 1', 'PC 2', 'Printer'].map((label) => m.addComponent(d, { type: 'pc', label, boundary: office }));
  const phones = ['Phone 1', 'Phone 2'].map((label) => m.addComponent(d, { type: 'ip-phone', label, boundary: voice }));
  m.connect(d, { from: router, to: sw });
  for (const x of [...pcs, ...phones]) m.connect(d, { from: sw, to: x });

  const pos = await layout(d);
  for (const c of d.components) c.position = pos.get(c.id);
  const boxes = boundaryBoxes(d);

  assert.ok(inside(boxes.get(office)!, boxes.get(site)!) && inside(boxes.get(voice)!, boxes.get(site)!), 'VLANs sit inside the site');
  assert.ok(!overlap(boxes.get(office)!, boxes.get(voice)!), 'sibling VLANs do not overlap');
  const routerAt = d.components.find((c) => c.id === router)!.position!;
  assert.equal(boundaryAt(boxes, { x: routerAt.x + 5, y: routerAt.y + 5 }), undefined, 'the router stays outside the site');
  const pcAt = d.components.find((c) => c.id === pcs[0])!.position!;
  assert.equal(boundaryAt(boxes, { x: pcAt.x + 5, y: pcAt.y + 5 }), office, 'the deepest box wins');
});
