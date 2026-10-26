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

test('templates load and start unseen', async () => {
  const files = (await fs.readdir(store.TEMPLATES_DIR)).filter((f) => f.endsWith('.json'));
  const templates = await store.listTemplates();
  assert.equal(templates.length, files.length, 'every template file must be valid');
  for (const t of templates) {
    const d = await store.createDesign({ id: `from-${t.id}`, title: t.title, template: t.id });
    assert.ok(d.steps.every((s) => !s.seen));
  }
});
