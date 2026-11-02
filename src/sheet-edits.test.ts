import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import { parseDesign, type Design } from '../core/schema.ts';
import { boundaryBoxes } from './boundaries.ts';
import { addItem, carriedAlong, connectItems, emptyBoundaries, isAddKind, labelOf, landDragged, removeItems, setLabel } from './sheet-edits.ts';

const step = 's1';
const sheet = (over: Partial<Design> = {}) =>
  parseDesign({
    id: 'd',
    title: 'D',
    rev: 0,
    steps: [{ id: step, title: 'One', seen: true }],
    components: [
      { id: 'a', type: 'service', label: 'A', step, boundary: 'box', position: { x: 100, y: 100 } },
      { id: 'b', type: 'service', label: 'B', step, position: { x: 900, y: 900 } },
    ],
    connections: [],
    boundaries: [{ id: 'box', kind: 'vpc', label: 'Box', step }],
    notes: [{ id: 'n', text: 'Note', step, attachTo: 'a', position: { x: 300, y: 100 } }],
    decisions: [{ id: 'x', title: 'Pick', why: 'Because', links: ['a'], step, position: { x: 400, y: 100 } }],
    flows: [],
    comments: [],
    ...over,
  });
const nodes = (d: Design) =>
  [...d.components, ...d.notes, ...d.decisions].map((x): Node => ({ id: x.id, position: x.position!, data: {}, type: 'text' in x ? 'note' : 'label' in x ? 'component' : 'decision' }));

test('only palette words count as something to add', () => {
  for (const k of ['note', 'decision', 'boundary:vpc', 'service']) assert.ok(isAddKind(k), k);
  for (const k of ['', 'boundary:nope', 'nope']) assert.ok(!isAddKind(k), k);
});

test('a new item is centred on the point it was added at', () => {
  const d = sheet();
  const id = addItem(d, 'note', { center: { x: 500, y: 500 }, step });
  const note = d.notes.find((n) => n.id === id)!;
  assert.deepEqual(note.position, { x: 405, y: 452 });
});

test('joining parts draws a line; joining a note attaches it; two notes cannot be joined', () => {
  const d = sheet({ notes: [{ id: 'n', text: 'Note', step }, { id: 'm', text: 'Other', step }] });
  connectItems(d, { source: 'a', target: 'b' }, step);
  assert.equal(d.connections.length, 1);
  connectItems(d, { source: 'n', target: 'b' }, step);
  assert.equal(d.notes[0].attachTo, 'b');
  assert.throws(() => connectItems(d, { source: 'n', target: 'm' }, step), /Connect notes/);
});

test('joining a decision to a part twice links it once', () => {
  const d = sheet();
  connectItems(d, { source: 'x', target: 'b' }, step);
  connectItems(d, { source: 'b', target: 'x' }, step);
  assert.deepEqual(d.decisions[0].links, ['a', 'b']);
});

test('removing skips ids already gone with something else', () => {
  const d = sheet();
  removeItems(d, ['b', 'b', 'nothing']);
  assert.ok(!d.components.some((c) => c.id === 'b'));
});

test('an item edits the text it shows, and a line may lose its label', () => {
  const d = sheet();
  connectItems(d, { source: 'a', target: 'b' }, step);
  const line = d.connections[0].id;
  assert.deepEqual(labelOf(d, 'a'), { value: 'A', multiline: false });
  assert.deepEqual(labelOf(d, 'n'), { value: 'Note', multiline: true });
  assert.deepEqual(labelOf(d, line), { value: '', multiline: false });
  assert.equal(labelOf(d, 'nothing'), undefined);
  setLabel(d, 'x', 'Chosen');
  assert.equal(d.decisions[0].title, 'Chosen');
  setLabel(d, line, 'calls');
  setLabel(d, line, '');
  assert.equal(d.connections[0].label, undefined);
});

test('dragging a boundary carries its parts and the notes about them', () => {
  const d = sheet();
  const box: Node = { id: 'box', type: 'boundary', position: { x: 0, y: 0 }, data: {} };
  const carried = carriedAlong(d, [box, ...nodes(d)], [box]);
  assert.deepEqual([...carried.keys()].sort(), ['a', 'box', 'n', 'x']);
});

test('a dragged boundary moves everything it carries by the same distance', () => {
  const d = sheet();
  const box: Node = { id: 'box', type: 'boundary', position: { x: 0, y: 0 }, data: {} };
  const carried = carriedAlong(d, [box, ...nodes(d)], [box]);
  landDragged(d, { dragged: [{ ...box, position: { x: 10.4, y: 20 } }], carried, boxes: boundaryBoxes(d) });
  assert.deepEqual(d.components[0].position, { x: 110, y: 120 });
  assert.deepEqual(d.notes[0].position, { x: 310, y: 120 });
});

test('a part dropped in a box joins it, and the box it left holds its place', () => {
  const d = sheet();
  const boxes = boundaryBoxes(d);
  const inside = boxes.get('box')!;
  landDragged(d, { dragged: [{ id: 'b', position: { x: inside.x + 10, y: inside.y + 10 }, data: {} }], carried: new Map(), boxes });
  assert.equal(d.components[1].boundary, 'box');
  landDragged(d, { dragged: [{ id: 'a', position: { x: 2000, y: 2000 }, data: {} }, { id: 'b', position: { x: 2300, y: 2000 }, data: {} }], carried: new Map(), boxes });
  assert.deepEqual(emptyBoundaries(d).map((b) => b.id), ['box']);
  assert.deepEqual(d.boundaries[0].position, { x: inside.x, y: inside.y });
  assert.deepEqual(d.boundaries[0].size, { w: inside.w, h: inside.h });
});
