import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.SYSTEM_DESIGN_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-test-'));
const store = await import('./store.ts');
const m = await import('./mutations.ts');
const { parseDesign } = await import('./schema.ts');

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

test('feedback goes back to the agent and returns the step for review', async () => {
  const x = await store.createDesign({ id: 'review', title: 'Review' });
  const step = m.addStep(x, { title: 'Add cache' });
  const cache = m.addComponent(x, { type: 'cache', label: 'Cache' });
  const onItem = m.addComment(x, { target: cache, text: 'Why not CDN?', by: 'reviewer' });
  m.requestChanges(x, step, 'Size it first');
  assert.equal(x.steps[1].seen, true);
  assert.deepEqual(
    m.feedback(x).map((f) => [f.step, f.comments.length, f.comments[0].about]),
    [[step, 2, { id: cache, label: 'Cache' }]],
  );

  m.resolveFeedback(x, { comments: [onItem], reply: 'Reads repeat per user, a CDN would not hit.' });
  assert.equal(x.steps[1].changesRequested, true, 'one comment is still open');
  m.resolveFeedback(x, { step });
  assert.equal(x.steps[1].changesRequested, undefined);
  assert.equal(x.steps[1].seen, false, 'the step goes back to the reviewer');
  assert.deepEqual(m.feedback(x), []);

  m.removeItem(x, cache);
  assert.equal(x.comments[0].target, undefined, 'feedback outlives the item');
  await store.writeDesign(x);
});

test('reverting a step removes what it added, and paste makes fresh copies', async () => {
  const x = await store.createDesign({ id: 'revert', title: 'Revert' });
  const api = m.addComponent(x, { type: 'service', label: 'API', position: { x: 0, y: 0 } });
  const step = m.addStep(x, { title: 'Add DB' });
  const vpc = m.addBoundary(x, { kind: 'vpc', label: 'VPC', members: [api] });
  const db = m.addComponent(x, { type: 'sql-db', label: 'DB', boundary: vpc, position: { x: 0, y: 100 } });
  m.connect(x, { from: api, to: db });
  m.addNote(x, { text: 'Primary only', attachTo: db });

  const clip = m.copyItems(x, [vpc, x.notes[0].id]);
  assert.deepEqual(clip.components.map((c) => c.id), [api, db], 'a boundary brings its contents');
  const pasted = m.pasteItems(x, clip, { step, offset: 40 });
  assert.deepEqual(pasted, ['vpc-2', 'api-2', 'db-2', 'note-2']);
  const copy = x.components.find((c) => c.id === 'db-2')!;
  assert.deepEqual([copy.boundary, copy.position], ['vpc-2', { x: 40, y: 140 }]);
  assert.equal(x.notes.find((n) => n.id === 'note-2')!.attachTo, 'db-2');
  assert.ok(x.connections.some((c) => c.from === 'api-2' && c.to === 'db-2'));
  await store.writeDesign(x);

  const y = await store.readDesign('revert');
  m.revertStep(y, step);
  assert.deepEqual(y.components.map((c) => c.id), [api]);
  assert.equal(y.components[0].boundary, undefined);
  assert.deepEqual([y.steps.length, y.connections.length, y.notes.length, y.boundaries.length], [1, 0, 0, 0]);
  await store.writeDesign(y);
});

test('exports Mermaid and a decision record', async () => {
  const { toMermaid, toDecisionRecord } = await import('./export.ts');
  const x = await store.createDesign({ id: 'export', title: 'Export' });
  const vpc = m.addBoundary(x, { kind: 'vpc', label: 'VPC', detail: '10.0.0.0/16' });
  const api = m.addComponent(x, { type: 'service', label: 'API', boundary: vpc });
  const db = m.addComponent(x, { id: 'end', type: 'sql-db', label: 'Say "hi"', tech: 'PostgreSQL' });
  m.connect(x, { from: api, to: db, label: 'SQL', async: true });
  m.addDecision(x, { title: 'Postgres', why: 'Joins', alternatives: ['MySQL'], links: [db] });
  assert.equal(
    toMermaid(x),
    ['%% Export', 'flowchart LR', '  subgraph vpc["VPC · 10.0.0.0/16"]', '    api["API"]', '  end', '  end_[("Say #quot;hi#quot; (PostgreSQL)")]', '  api -.->|"SQL"| end_', ''].join('\n'),
  );
  const iface = m.addComponent(x, { type: 'interface', label: 'Store' });
  const impl = m.connect(x, { from: db, to: iface, kind: 'implementation', route: 'elbow' });
  assert.deepEqual(
    (({ kind, route }) => ({ kind, route }))(parseDesign(structuredClone(x)).connections.find((c) => c.id === impl)!),
    { kind: 'implementation', route: 'elbow' },
  );
  assert.match(toMermaid(x), /end_ -\.-> store/);
  const adr = toDecisionRecord(x);
  assert.match(adr, /## D1\. Postgres/);
  assert.match(adr, /\*\*Affects:\*\* Say "hi"/);
  assert.match(adr, /- MySQL/);
});

test('flows follow connections and skip removed stops', async () => {
  const x = await store.createDesign({ id: 'flows', title: 'Flows' });
  const user = m.addComponent(x, { type: 'user', label: 'User' });
  const api = m.addComponent(x, { type: 'service', label: 'API' });
  const db = m.addComponent(x, { type: 'sql-db', label: 'DB' });
  m.connect(x, { from: user, to: api });
  m.connect(x, { from: api, to: db });
  assert.throws(() => m.addFlow(x, { title: 'Skip', path: [user, db] }), /no connection/);
  const login = m.addFlow(x, { title: 'Login', path: [user, api, db, api, user] });
  await store.writeDesign(x);

  const y = await store.readDesign('flows');
  m.removeItem(y, db);
  assert.deepEqual(y.flows[0].path, [user, api, user]);
  m.removeItem(y, api);
  assert.equal(y.flows.length, 0, 'one stop left is no flow');
  m.removeItem(x, login);
  assert.equal(x.flows.length, 0);
});

test('lint flags likely smells', async () => {
  const { lint } = await import('./lint.ts');
  const x = await store.createDesign({ id: 'lint', title: 'Lint' });
  const pub = m.addBoundary(x, { kind: 'subnet', label: 'Public' });
  const client = m.addComponent(x, { type: 'client', label: 'Web' });
  const lb = m.addComponent(x, { type: 'load-balancer', label: 'LB' });
  const api = m.addComponent(x, { type: 'service', label: 'API' });
  const db = m.addComponent(x, { type: 'sql-db', label: 'DB', boundary: pub });
  const q = m.addComponent(x, { type: 'queue', label: 'Jobs' });
  m.addComponent(x, { type: 'cache', label: 'Lonely' });
  m.connect(x, { from: client, to: lb });
  m.connect(x, { from: lb, to: api });
  m.connect(x, { from: client, to: db });
  m.connect(x, { from: api, to: q });
  m.addDecision(x, { title: 'Why', why: 'Because' });
  assert.deepEqual(
    lint(x).map((i) => `${i.id}:${i.rule}`),
    ['lb:single-target', 'db:public-datastore', 'db:client-to-datastore', 'jobs:one-sided', 'lonely:isolated', 'decision-why:unlinked-decision'],
  );
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
