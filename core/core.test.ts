import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.SYSTEM_DESIGN_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-test-'));
const store = await import('./store.ts');
const m = await import('./mutations.ts');

test('create, edit through mutations, and reject stale writes', async () => {
  const d = await store.createDesign({ id: 'demo', title: 'Demo' });
  assert.equal(d.rev, 0);

  const updated = await store.updateDesign('demo', (x) => {
    const step = m.addStep(x, { title: 'Add cache' });
    const api = m.addComponent(x, { type: 'service', label: 'API' });
    const cache = m.addComponent(x, { type: 'cache', label: 'Cache', tech: 'Redis' });
    m.connect(x, { from: api, to: cache });
    m.addDecision(x, { title: 'Cache reads', why: 'Reads dominate', links: [cache], step });
  });
  assert.equal(updated.rev, 1);
  assert.equal(updated.steps.at(-1)!.seen, false);
  assert.deepEqual(updated.components.map((c) => c.id), ['api', 'cache']);

  await assert.rejects(store.writeDesign({ ...updated, rev: 0 }), store.ConflictError);
  await assert.rejects(store.createDesign({ id: 'demo', title: 'Again' }), store.ConflictError);
});

test('removing a component drops what points at it', async () => {
  const x = await store.readDesign('demo');
  m.removeItem(x, 'cache');
  assert.equal(x.connections.length, 0);
  assert.deepEqual(x.decisions[0].links, []);
  await store.writeDesign(x);
});

test('validation rejects dangling references and unsafe ids', async () => {
  const x = await store.readDesign('demo');
  x.connections.push({ id: 'bad', from: 'api', to: 'ghost', step: 'start' });
  await assert.rejects(store.writeDesign(x), /unknown to "ghost"/);
  await assert.rejects(store.readDesign('../etc/passwd'), /invalid id/);
  assert.throws(() => m.connect(x, { from: 'api', to: 'ghost' }), /unknown component/);
});

test('boundaries nest, refuse cycles and hand their contents up when removed', async () => {
  const x = await store.createDesign({ id: 'net', title: 'Net' });
  const pc = m.addComponent(x, { type: 'pc', label: 'PC' });
  const region = m.addBoundary(x, { kind: 'region', label: 'eu-west-1' });
  const vpc = m.addBoundary(x, { kind: 'vpc', label: 'Main VPC', parent: region });
  const subnet = m.addBoundary(x, { kind: 'subnet', label: 'Private', detail: '10.0.1.0/24', parent: vpc, members: [pc] });
  assert.equal(x.components[0].boundary, subnet);
  assert.throws(() => m.placeIn(x, region, subnet), /inside itself/);
  assert.throws(() => m.addComponent(x, { type: 'pc', label: 'PC 2', boundary: 'ghost' }), /unknown boundary/);

  m.removeItem(x, subnet);
  assert.equal(x.components[0].boundary, vpc);
  m.removeItem(x, region);
  assert.equal(x.boundaries.find((b) => b.id === vpc)!.parent, undefined);
  await store.writeDesign(x);

  const stored = await store.readDesign('net');
  stored.boundaries[0].parent = stored.boundaries[0].id;
  await assert.rejects(store.writeDesign(stored), /inside itself/);
});

test('templates load and start unseen', async () => {
  const files = (await fs.readdir(store.TEMPLATES_DIR)).filter((f) => f.endsWith('.json'));
  const templates = await store.listTemplates();
  assert.equal(templates.length, files.length, 'every template file must be valid');
  for (const t of templates) {
    const d = await store.createDesign({ id: `from-${t.id}`, title: t.title, template: t.id });
    assert.ok(d.steps.every((s) => !s.seen));
  }
});
