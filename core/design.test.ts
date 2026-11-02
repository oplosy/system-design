import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './test-env.ts';

const store = await import('./store.ts');
const m = await import('./mutations.ts');
const { parseDesign } = await import('./schema.ts');

test('the list keeps up with every change to the files, without reading ones that did not change', async () => {
  const file = path.join(store.DESIGNS_DIR, 'listed.json');
  const title = async () => (await store.listDesigns()).find((x) => x.id === 'listed')?.title;
  await store.createDesign({ id: 'listed', title: 'First' });
  assert.equal(await title(), 'First');
  await store.updateDesign('listed', (x) => void (x.title = 'Second'));
  assert.equal(await title(), 'Second');

  // Same size and time: only a read could notice this, so a list that still shows the design did not read it.
  const raw = await fs.readFile(file, 'utf8'), at = new Date(1_700_000_000_000);
  await fs.utimes(file, at, at);
  assert.equal(await title(), 'Second');
  await fs.writeFile(file, 'x'.repeat(Buffer.byteLength(raw)));
  await fs.utimes(file, at, at);
  assert.equal(await title(), 'Second');

  await fs.writeFile(file, '{ broken');
  assert.equal(await title(), undefined, 'a file that breaks leaves the list');
  await fs.writeFile(file, raw);
  assert.equal(await title(), 'Second');
  await fs.rm(file);
  assert.equal(await title(), undefined);
});

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
  assert.throws(() => m.addComponent(x, { type: 'service', label: 'Loop', detail: 'demo' }), /own design/);
  x.connections = x.connections.filter((c) => c.id !== 'bad');
  x.components[0].detail = 'demo';
  await assert.rejects(store.writeDesign(x), /opens its own design/);
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
  m.addFlow(x, { title: 'Read', path: [api, db, api] });

  const clip = m.copyItems(x, [vpc, x.notes[0].id]);
  assert.deepEqual(clip.components.map((c) => c.id), [api, db], 'a boundary brings its contents');
  const pasted = m.pasteItems(x, clip, { step, offset: 40 });
  assert.deepEqual(pasted, ['vpc-2', 'api-2', 'db-2', 'note-2']);
  const copy = x.components.find((c) => c.id === 'db-2')!;
  assert.deepEqual([copy.boundary, copy.position], ['vpc-2', { x: 40, y: 140 }]);
  assert.equal(x.notes.find((n) => n.id === 'note-2')!.attachTo, 'db-2');
  assert.ok(x.connections.some((c) => c.from === 'api-2' && c.to === 'db-2'));
  assert.deepEqual(x.flows.at(-1)!.path, ['api-2', 'db-2', 'api-2'], 'a flow comes along with its stops');
  await store.writeDesign(x);

  const y = await store.readDesign('revert');
  m.revertStep(y, step);
  assert.deepEqual(y.components.map((c) => c.id), [api]);
  assert.equal(y.components[0].boundary, undefined);
  assert.deepEqual([y.steps.length, y.connections.length, y.notes.length, y.boundaries.length, y.flows.length], [1, 0, 0, 0, 0]);
  await store.writeDesign(y);
});

test('a flow carries sequence fragments and activations', async () => {
  const { flowActivations, flowSequence, toMermaidSequence } = await import('./export.ts');
  const x = await store.createDesign({ id: 'frames', title: 'Frames' });
  const user = m.addComponent(x, { type: 'user', label: 'User' });
  const api = m.addComponent(x, { type: 'service', label: 'API' });
  const db = m.addComponent(x, { type: 'sql-db', label: 'DB' });
  m.connect(x, { from: user, to: api });
  m.connect(x, { from: api, to: db });
  const path = [user, api, db, api, user];
  assert.throws(() => m.addFlow(x, { title: 'Long', path, fragments: [{ kind: 'opt', from: 0, to: 4 }] }), /do not fit/);
  assert.throws(() => m.addFlow(x, { title: 'Cross', path, fragments: [{ kind: 'opt', from: 0, to: 2 }, { kind: 'opt', from: 1, to: 3 }] }), /overlap/);
  assert.throws(() => m.addFlow(x, { title: 'Split', path, fragments: [{ kind: 'loop', from: 0, to: 2, split: 1 }] }), /no split/);
  m.addFlow(x, { title: 'Read', path, fragments: [{ kind: 'alt', label: 'cached', from: 0, to: 3, split: 2 }, { kind: 'loop', label: 'retry', from: 1, to: 1 }] });
  assert.equal(
    toMermaidSequence(x, x.flows[0]).split('\n').slice(6).join('\n'),
    ['  alt cached', '  user->>api: call', '  loop retry', '  api->>db: call', '  end', '  else', '  db-->>api: reply', '  api-->>user: reply', '  end', ''].join('\n'),
  );
  assert.deepEqual(flowActivations(flowSequence(x, x.flows[0]).messages).map((a) => [a.id, a.from, a.to]), [[db, 1, 2], [api, 0, 3]]);
  assert.deepEqual(flowActivations([{ from: 'a', to: 'b', reply: false, async: false }, { from: 'b', to: 'c', reply: false, async: true }]).map((a) => [a.id, a.from, a.to]), [['b', 0, 1]]);
  await store.writeDesign(x);
  m.removeItem(x, db);
  assert.equal(x.flows[0].fragments, undefined, 'hop numbers mean nothing once the hops change');
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
  const { toMermaidSequence } = await import('./export.ts');
  assert.equal(
    toMermaidSequence(x, x.flows[0]),
    [
      'sequenceDiagram',
      '  title Login',
      '  autonumber',
      '  participant user as User',
      '  participant api as API',
      '  participant db as DB',
      '  user->>api: call',
      '  api->>db: call',
      '  db-->>api: reply',
      '  api-->>user: reply',
      '',
    ].join('\n'),
    'hops against the line are replies',
  );
  const { flowLatency } = await import('./export.ts');
  assert.deepEqual(flowLatency(x, x.flows[0]), { total: 0, unknown: 4 });
  m.updateTracked(x, db, { cost: 0.5 });
  assert.equal(parseDesign(structuredClone(x)).components.find((c) => c.id === db)!.cost, 0.5);
  m.updateTracked(x, 'user-to-api', { latency: 20, qps: 1500 });
  x.connections.find((c) => c.id === 'api-to-db')!.latency = 5;
  assert.deepEqual(flowLatency(x, x.flows[0]), { total: 50, unknown: 0 }, 'a reply hop counts its line again');
  assert.deepEqual(x.steps.at(-1)!.changed, undefined, 'edits inside the step that added the line are not changes');

  const y = await store.readDesign('flows');
  m.removeItem(y, db);
  assert.deepEqual(y.flows[0].path, [user, api, user]);
  m.removeItem(y, api);
  assert.equal(y.flows.length, 0, 'one stop left is no flow');
  m.removeItem(x, login);
  assert.equal(x.flows.length, 0);
});

test('agent removals and changes are recorded on the step for its diff', async () => {
  const x = await store.createDesign({ id: 'tracked', title: 'Tracked' });
  const api = m.addComponent(x, { type: 'service', label: 'API', position: { x: 10, y: 20 } });
  const cache = m.addComponent(x, { type: 'cache', label: 'Cache', tech: 'Redis' });
  const vpc = m.addBoundary(x, { kind: 'vpc', label: 'VPC' });
  m.connect(x, { from: api, to: cache });
  x.steps[0].seen = true;
  const step = m.addStep(x, { title: 'Swap cache', seen: true });

  m.updateTracked(x, cache, { tech: 'Memcached' });
  m.updateTracked(x, cache, { tech: 'Valkey', label: 'Cache' });
  m.updateTracked(x, cache, { boundary: vpc });
  m.removeTracked(x, 'api-to-cache');
  m.removeTracked(x, api);
  const fresh = m.addComponent(x, { type: 'worker', label: 'Worker' });
  m.updateTracked(x, fresh, { tech: 'Go' });
  m.removeTracked(x, fresh);

  const s = x.steps.find((t) => t.id === step)!;
  assert.equal(s.seen, false, 'the step reopens for review');
  assert.deepEqual(s.changed, [
    { id: cache, field: 'tech', from: 'Redis', to: 'Valkey' },
    { id: cache, field: 'boundary', from: undefined, to: vpc },
  ]);
  assert.deepEqual(s.removed, [
    { id: 'api-to-cache', label: 'API → Cache', type: undefined, position: undefined },
    { id: api, label: 'API', type: 'service', position: { x: 10, y: 20 } },
  ]);
  assert.equal(x.components.find((c) => c.id === cache)!.boundary, vpc);
  await store.writeDesign(x);

  const y = await store.readDesign('tracked');
  const db = m.addComponent(y, { type: 'sql-db', label: 'DB', step: 'start' });
  m.connect(y, { from: cache, to: db, step: 'start' });
  const later = m.addStep(y, { title: 'Drop DB' });
  m.updateTracked(y, 'cache-to-db', { latency: 8 });
  assert.deepEqual(y.steps.at(-1)!.changed, [{ id: 'cache-to-db', field: 'latency', from: undefined, to: '8' }], 'numbers are recorded as text');
  m.removeTracked(y, db);
  assert.deepEqual(y.steps.at(-1)!.removed!.map((r) => r.label), ['DB', 'Cache → DB'], 'lines to a removed part are listed');
  m.revertStep(y, later);
  m.revertStep(y, step);
  const cacheNow = y.components.find((c) => c.id === cache)!;
  assert.deepEqual([cacheNow.tech, cacheNow.boundary], ['Redis', undefined], 'reverting puts changed fields back');
  assert.deepEqual(y.components.map((c) => c.id).sort(), [api, cache, db].sort(), 'and brings removed parts back');
  assert.deepEqual(y.connections.map((c) => c.id).sort(), ['api-to-cache', 'cache-to-db']);
  assert.equal(y.connections.find((c) => c.id === 'cache-to-db')!.latency, undefined, 'a restored line is as it was before the step');
  await store.writeDesign(y);
});

test('a step can offer options, and picking one keeps it and records the rest as alternatives', async () => {
  const x = await store.createDesign({ id: 'options', title: 'Options' });
  const api = m.addComponent(x, { type: 'service', label: 'API' });
  const step = m.addStep(x, { title: 'Speed up reads', options: [{ title: 'Redis', summary: 'Cache per user' }, { title: 'CDN' }] });
  assert.throws(() => m.addStep(x, { title: 'Lonely', options: [{ title: 'Only one' }] }), /at least two/);
  assert.throws(() => m.addComponent(x, { type: 'cache', label: 'Nope', option: 'memcached' }), /no option/);
  const cache = m.addComponent(x, { type: 'cache', label: 'Cache', option: 'redis' });
  m.connect(x, { from: api, to: cache, option: 'redis' });
  const cdn = m.addComponent(x, { type: 'cdn', label: 'Edge', option: 'cdn' });
  m.connect(x, { from: cdn, to: api, option: 'cdn' });
  await store.writeDesign(x);

  const bad = structuredClone(await store.readDesign('options'));
  bad.connections.push({ id: 'mixed', from: cdn, to: cache, option: 'cdn', step });
  await assert.rejects(store.writeDesign(bad), /from another option/);

  const y = await store.readDesign('options');
  const decision = m.pickOption(y, step, 'redis');
  assert.deepEqual(y.components.map((c) => [c.id, c.option]), [[api, undefined], [cache, undefined]]);
  assert.deepEqual(y.connections.map((c) => c.id), ['api-to-cache']);
  assert.equal(y.steps.find((s) => s.id === step)!.options, undefined);
  const d = y.decisions.find((i) => i.id === decision)!;
  assert.deepEqual([d.title, d.why, d.alternatives, d.links], ['Speed up reads: Redis', 'Cache per user', ['CDN'], [cache]]);
  await store.writeDesign(y);
});

test('a step moves the cost by what it adds, edits and removes', async () => {
  const { stepCostChange } = await import('./export.ts');
  const x = await store.createDesign({ id: 'cost', title: 'Cost' });
  const api = m.addComponent(x, { type: 'service', label: 'API', cost: 120 });
  const db = m.addComponent(x, { type: 'sql-db', label: 'DB', cost: 0.5 });
  const tune = m.addStep(x, { title: 'Tune' });
  m.addComponent(x, { type: 'cache', label: 'Cache', cost: 30 });
  m.updateTracked(x, api, { cost: 100 });
  m.removeTracked(x, db);
  assert.equal(stepCostChange(x, tune), 30 - 20 - 0.5);
  assert.equal(stepCostChange(x, x.steps[0].id), 120.5, 'a step counts its parts at the cost it left them');
  const { costAt, money, codeUrl } = await import('./export.ts');
  const apiPart = x.components.find((c) => c.id === api)!;
  assert.deepEqual([costAt(x, apiPart, x.steps[0].id), costAt(x, apiPart, tune)], [120, 100], 'the cost as each step left it');
  x.steps[1].seen = true;
  m.updateTracked(x, api, { cost: 90 }, tune, false);
  assert.equal(x.steps[1].seen, true, "the reviewer's own edit keeps the step reviewed");
  assert.equal(stepCostChange(x, tune), 30 - 30 - 0.5, 'and still counts in its cost change');
  assert.deepEqual([money(1500), money(340.5, 'EUR')], ['$1,500', '€340.50']);
  assert.equal(codeUrl(x, 'services/orders'), undefined, 'a path opens only against a repo');
  x.repo = 'https://github.com/acme/shop/tree/main/';
  assert.deepEqual(
    [codeUrl(x, './services/orders'), codeUrl(x, '.'), codeUrl(x, 'https://gitlab.com/x'), codeUrl(x, 'javascript:alert(1)')],
    ['https://github.com/acme/shop/tree/main/services/orders', 'https://github.com/acme/shop/tree/main/', 'https://gitlab.com/x', 'https://github.com/acme/shop/tree/main/javascript:alert(1)'],
  );
  assert.throws(() => parseDesign({ ...structuredClone(x), repo: 'javascript:alert(1)' }), /http/);
  assert.throws(() => parseDesign({ ...structuredClone(x), currency: 'euro' }), /three-letter/);
  m.addStep(x, { title: 'Trim' });
  m.updateTracked(x, 'cache', { cost: 10 });
  m.removeTracked(x, 'cache');
  assert.equal(stepCostChange(x, x.steps[2].id), -30, 'an edit before a removal in the same step is not counted twice');
  assert.equal(x.steps.reduce((t, s) => t + stepCostChange(x, s.id), 0), 90, 'the steps add up to the current total');
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

test('files from before versioning load as the current version, newer ones are refused', () => {
  const { version, ...old } = m.blankDesign('old', 'Old');
  assert.equal(parseDesign(old).version, version);
  assert.throws(() => parseDesign({ ...old, version: version + 1 }), /newer than this app/);
  assert.throws(() => parseDesign({ ...old, version: 'two' }), /whole number/);
});

test('tags are kept once each and their edits are recorded on the step', () => {
  const x = m.blankDesign('tags', 'Tags');
  const api = m.addComponent(x, { type: 'service', label: 'API', tags: ['payments', 'payments', 'pii'] });
  assert.deepEqual(x.components[0].tags, ['payments', 'pii']);
  m.addComponent(x, { type: 'service', label: 'Bare', tags: [] });
  assert.equal(x.components[1].tags, undefined);
  const step = m.addStep(x, { title: 'Retag' });
  m.updateTracked(x, api, { tags: ['payments'] }, step);
  assert.deepEqual(x.steps.find((s) => s.id === step)!.changed, [{ id: api, field: 'tags', from: 'payments, pii', to: 'payments' }]);
  assert.deepEqual(parseDesign(structuredClone(x)).components[0].tags, ['payments']);
  assert.throws(() => parseDesign({ ...structuredClone(x), components: [{ ...x.components[0], tags: ['  '] }, x.components[1]] }));
});

test('designs move to the data folder once, go to the trash and come back, and copy or import under a free id', async () => {
  // The old folder next to the code is copied once; what is already there wins, and a marker stops a second copy.
  const from = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-legacy-'));
  const to = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-data-'));
  await fs.writeFile(path.join(from, 'old.json'), JSON.stringify(m.blankDesign('old', 'Old')));
  await fs.writeFile(path.join(from, 'kept.json'), JSON.stringify(m.blankDesign('kept', 'From legacy')));
  await fs.writeFile(path.join(to, 'kept.json'), JSON.stringify(m.blankDesign('kept', 'Already here')));
  await fs.writeFile(path.join(from, 'notes.txt'), 'not a design');
  assert.deepEqual(store.adoptLegacy(from, to), ['old']);
  assert.equal(JSON.parse(await fs.readFile(path.join(to, 'kept.json'), 'utf8')).title, 'Already here');
  await fs.rm(path.join(to, 'old.json'));
  assert.deepEqual(store.adoptLegacy(from, to), [], 'a design deleted after the move does not come back');
  assert.ok(await fs.stat(path.join(from, 'old.json')), 'the originals stay');

  // Trash and restore.
  await store.createDesign({ id: 'bin-me', title: 'Bin me' });
  await store.trashDesign('bin-me');
  await assert.rejects(store.readDesign('bin-me'), store.NotFoundError);
  const [t] = (await store.listTrash()).filter((x) => x.id === 'bin-me');
  assert.equal(t.title, 'Bin me');
  await assert.rejects(store.restoreDesign('../escape.1'), /invalid id/);
  await store.createDesign({ id: 'bin-me', title: 'Taken' });
  await assert.rejects(store.restoreDesign(t.entry), store.ConflictError);
  await store.trashDesign('bin-me');
  assert.equal((await store.restoreDesign(t.entry)).title, 'Bin me');
  assert.equal((await store.readDesign('bin-me')).title, 'Bin me');
  assert.equal((await store.listTrash()).filter((x) => x.id === 'bin-me').length, 1, 'the other copy waits in the trash');

  // A copy keeps the steps; a file comes in under a free id and is validated.
  const src = await store.updateDesign('bin-me', (d) => void m.addComponent(d, { type: 'service', label: 'API' }));
  const dup = await store.createDesign({ id: 'bin-me-copy', title: 'Bin me copy', from: 'bin-me' });
  assert.deepEqual([dup.components.length, dup.steps.length, dup.rev], [src.components.length, src.steps.length, 0]);
  assert.equal((await store.importDesign(src)).id, 'bin-me-2');
  assert.equal((await store.importDesign(src)).id, 'bin-me-3');
  await assert.rejects(store.importDesign({ id: 'x' }));
  assert.ok((await store.listDesigns()).every((d) => typeof d.updated === 'number'));
});

test('a save that meets a newer file replays the edits onto it instead of dropping them', async () => {
  const { mergeDesigns } = await import('./merge.ts');
  const base = m.blankDesign('merge', 'Shop');
  const api = m.addComponent(base, { type: 'service', label: 'API' });
  const db = m.addComponent(base, { type: 'sql-db', label: 'DB' });
  const old = m.addComponent(base, { type: 'cache', label: 'Old cache' });
  const mine = structuredClone(base), theirs = structuredClone(base);
  // Mine: rename the API, move the DB, delete the cache, add a note.
  mine.components.find((c) => c.id === api)!.label = 'Orders API';
  mine.components.find((c) => c.id === db)!.position = { x: 10, y: 20 };
  mine.components = mine.components.filter((c) => c.id !== old);
  m.addNote(mine, { text: 'Mine' });
  // Theirs (an agent): a new step with a line, a tech on the API, and the DB renamed too.
  m.addStep(theirs, { title: 'Agent step' });
  m.connect(theirs, { from: api, to: db });
  theirs.components.find((c) => c.id === api)!.tech = 'Go';
  theirs.components.find((c) => c.id === db)!.label = 'Orders DB';
  theirs.rev = 5;
  const r = mergeDesigns(base, mine, theirs)!;
  assert.equal(r.merged.rev, 5);
  assert.deepEqual(r.clashes, []);
  const byId = (id: string) => r.merged.components.find((c) => c.id === id);
  assert.deepEqual([byId(api)?.label, byId(api)?.tech, byId(db)?.label, byId(db)?.position, byId(old)], ['Orders API', 'Go', 'Orders DB', { x: 10, y: 20 }, undefined]);
  assert.equal(r.merged.connections.length, 1);
  assert.equal(r.merged.notes[0].text, 'Mine');
  assert.equal(r.merged.steps.at(-1)?.title, 'Agent step');

  // Both renamed the API: mine wins and it is reported.
  theirs.components.find((c) => c.id === api)!.label = 'Billing API';
  assert.deepEqual(mergeDesigns(base, mine, theirs)!.clashes, [`${api}.label`]);
  // A part mine deleted stays if theirs changed it; a new line of theirs to a part mine deleted can't be merged.
  const gone = structuredClone(mine);
  gone.components = gone.components.filter((c) => c.id !== db);
  assert.ok(mergeDesigns(base, gone, theirs)!.merged.components.some((c) => c.id === db));
  const toOld = structuredClone(base);
  m.connect(toOld, { from: api, to: old });
  assert.equal(mergeDesigns(base, mine, toOld), undefined);
});

test('git merges two branches of a design item by item, and leaves a real clash to a person', async () => {
  const { mergeFiles } = await import('./merge.ts');
  const text = (d: unknown) => `${JSON.stringify(d, null, 2)}\n`;
  const base = m.blankDesign('git', 'Git');
  m.addComponent(base, { type: 'service', label: 'API' });
  const ours = structuredClone(base), theirs = structuredClone(base);
  m.addComponent(ours, { type: 'cache', label: 'Cache' });
  ours.rev = 3;
  m.addComponent(theirs, { type: 'queue', label: 'Queue' });
  theirs.rev = 5;

  const clean = mergeFiles(text(base), text(ours), text(theirs));
  assert.deepEqual(clean.clashes, []);
  const merged = JSON.parse(clean.text);
  assert.deepEqual(merged.components.map((c: { id: string }) => c.id).sort(), ['api', 'cache', 'queue']);
  assert.equal(merged.rev, 6);

  const left = structuredClone(base), right = structuredClone(base);
  left.title = 'Left';
  right.title = 'Right';
  assert.deepEqual(mergeFiles(text(base), text(left), text(right)).clashes, ['title']);
  assert.throws(() => mergeFiles('', text(left), text(right)));
});
