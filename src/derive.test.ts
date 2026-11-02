import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDesign } from '../core/schema.ts';
import { deriveSheet, type SheetInput } from './derive.ts';

const design = parseDesign(JSON.parse(fs.readFileSync(new URL('../templates/three-tier.json', import.meta.url), 'utf8')));
const base = (over: Partial<SheetInput> = {}): SheetInput => ({
  design,
  current: design.steps[0],
  view: 0,
  selected: null,
  diff: false,
  presenting: false,
  flow: null,
  recording: null,
  inOption: () => true,
  tag: null,
  live: null,
  ...over,
});
const shown = (s: ReturnType<typeof deriveSheet>) => s.nodes.filter((n) => n.type === 'component');

test('the first step shows only its own parts, and the lines between them', () => {
  const s = deriveSheet(base());
  const ids = shown(s).map((n) => n.id);
  assert.deepEqual(ids, design.components.filter((c) => c.step === design.steps[0].id).map((c) => c.id));
  assert.ok(s.edges.length > 0);
  assert.ok(s.edges.every((e) => ids.includes(e.source) && ids.includes(e.target)), 'a line to a part from a later step is left out');
});

test('a later step adds its parts, and the selected part is marked', () => {
  const last = design.steps.length - 1;
  const s = deriveSheet(base({ current: design.steps[last], view: last, selected: design.components[0].id }));
  assert.equal(shown(s).length, design.components.length);
  assert.deepEqual(s.nodes.filter((n) => n.selected).map((n) => n.id), [design.components[0].id]);
});

test('without a design the sheet is empty', () => {
  const s = deriveSheet(base({ design: null, current: undefined }));
  assert.deepEqual([s.nodes.length, s.edges.length], [0, 0]);
});

test('a tag view hides the parts without that tag', () => {
  const last = design.steps.length - 1;
  const s = deriveSheet(base({ current: design.steps[last], view: last, tag: 'no-such-tag' }));
  assert.equal(shown(s).length, 0);
});
