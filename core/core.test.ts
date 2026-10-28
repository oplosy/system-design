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

test('Mermaid flowcharts import, including our own export', async () => {
  const { importMermaid, parseMermaid } = await import('./mermaid.ts');
  const { toMermaid } = await import('./export.ts');
  const src = await store.createDesign({ id: 'mermaid-src', title: 'Src' });
  const vpc = m.addBoundary(src, { kind: 'vpc', label: 'VPC', detail: '10.0.0.0/16' });
  const api = m.addComponent(src, { type: 'service', label: 'API', boundary: vpc });
  const db = m.addComponent(src, { id: 'end', type: 'sql-db', label: 'Say "hi"', tech: 'PostgreSQL' });
  const q = m.addComponent(src, { type: 'queue', label: 'Jobs' });
  m.connect(src, { from: api, to: db, label: 'SQL', async: true });
  m.connect(src, { from: api, to: q });
  const back = await store.createDesign({ id: 'mermaid-back', title: 'Back' });
  importMermaid(back, toMermaid(src));
  assert.deepEqual(
    back.components.map((c) => [c.id, c.type, c.label, c.tech ?? null, c.boundary ?? null]),
    src.components.map((c) => [c.id, c.type === 'interface' ? 'service' : c.type, c.label, c.tech ?? null, c.boundary ?? null]),
    'ids, labels, tech, boundaries and data shapes survive the round trip',
  );
  assert.deepEqual(back.connections.map((c) => [c.from, c.to, c.label ?? null, !!c.async]), src.connections.map((c) => [c.from, c.to, c.label ?? null, !!c.async || c.kind === 'implementation']));
  await store.writeDesign(back);

  const hand = [
    'graph TD',
    '  %% a comment',
    '  A[Web app] -->|HTTPS| B{{Gateway}}',
    '  B --> C(Orders) & D(Users)',
    '  C -- SQL --> E[(Postgres)]',
    '  C -.-> Q([Events])',
    '  classDef hot fill:#f00',
    '  C ==> ???',
    '  subgraph data["Data tier"]',
    '    E',
    '  end',
  ].join('\n');
  const p = parseMermaid(hand);
  assert.deepEqual(p.skipped, [8], 'a line that cannot be read is reported');
  assert.deepEqual(p.edges.map((e) => `${e.from}>${e.to}:${e.label ?? ''}:${e.async}`), ['A>B:HTTPS:false', 'B>C::false', 'B>D::false', 'C>E:SQL:false', 'C>Q::true']);
  const x = await store.createDesign({ id: 'mermaid-hand', title: 'Hand' });
  const guess = (w: string) => (/postgres/i.test(w) ? ('sql-db' as const) : /web/i.test(w) ? ('client' as const) : undefined);
  importMermaid(x, hand, { guess });
  assert.deepEqual(
    x.components.map((c) => `${c.id}:${c.type}:${c.boundary ?? ''}`),
    ['a:client:', 'b:api-gateway:', 'c:service:', 'd:service:', 'e:sql-db:data', 'q:queue:'],
  );
  await store.writeDesign(x);
  assert.throws(() => parseMermaid('pie title Pets'), /only Mermaid flowcharts, sequence/);
  const { guessType } = await import('../src/shapes.ts');
  const real = m.blankDesign('mermaid-real', 'Real');
  importMermaid(real, 'flowchart LR\n  m[Mailer (Kafka consumer)] --> r[Sessions (Redis)]\n  r --> o[Orders API]\n  o --> p[Orders DB (PostgreSQL)]', { guess: guessType });
  assert.deepEqual(
    real.components.map((c) => c.type),
    ['worker', 'cache', 'service', 'sql-db'],
    'the head word decides: a Kafka consumer is a worker; generic names stay services',
  );
});

test('imports docker-compose and Kubernetes manifests', async () => {
  const { importInfra } = await import('./infra.ts');
  const guess = (w: string) => (/postgres/i.test(w) ? ('sql-db' as const) : /redis/i.test(w) ? ('cache' as const) : undefined);
  const compose = [
    'services:',
    '  web:',
    '    image: ghcr.io/acme/web:1.2',
    '    depends_on: [api]',
    '    networks: [front]',
    '  api:',
    '    build: .',
    '    environment:',
    '      DATABASE_URL: postgres://app:secret@db:5432/app',
    '      - ignored',
    '    networks: [front, back]',
    '  db:',
    '    image: postgres:16',
    '    networks: { back: {} }',
  ].join('\n');
  const x = await store.createDesign({ id: 'compose', title: 'Compose' });
  assert.throws(() => importInfra(x, compose), /YAML/, 'a broken file fails before anything is added');
  assert.equal(x.components.length, 0);
  importInfra(x, compose.replace('      - ignored\n', '').replace('    environment:\n', '    environment:\n      - CACHE=redis\n      - MODE=web\n').replace('      DATABASE_URL: ', '      - DATABASE_URL='), { guess });
  assert.deepEqual(
    x.components.map((c) => `${c.id}:${c.type}:${c.tech ?? ''}:${c.boundary ?? ''}`),
    ['web:service:web:1.2:front', 'api:service::front', 'db:sql-db:postgres:16:back'],
  );
  assert.deepEqual(x.components.map((c) => c.code ?? null), [null, '.', null], 'a build context is where the code lives');
  assert.deepEqual(x.connections.map((c) => `${c.from}>${c.to}`), ['web>api', 'api>db'], 'the password and port are not hosts, and MODE=web names no host');
  await store.writeDesign(x);

  const kube = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata: { name: orders, namespace: shop }',
    'spec:',
    '  template:',
    '    metadata: { labels: { app: orders } }',
    '    spec:',
    '      containers:',
    '        - image: acme/orders:3',
    '          env:',
    '            - { name: DB_HOST, value: orders-db }',
    '            - { name: CACHE, value: cache.infra.svc.cluster.local:6379 }',
    '---',
    'kind: StatefulSet',
    'metadata: { name: pg, namespace: shop }',
    'spec: { template: { metadata: { labels: { app: pg } }, spec: { containers: [{ image: postgres:16 }] } } }',
    '---',
    'kind: Deployment',
    'metadata: { name: redis, namespace: infra }',
    'spec: { template: { metadata: { labels: { app: redis } }, spec: { containers: [{ image: redis:7 }] } } }',
    '---',
    'kind: CronJob',
    'metadata: { name: backup, namespace: shop }',
    'spec: { jobTemplate: { spec: { template: { spec: { containers: [{ image: postgres:16, env: [{ name: PGHOST, value: orders-db }, { name: TARGET, value: orders }] }] } } } } }',
    '---',
    'kind: Service',
    'metadata: { name: orders-db, namespace: shop }',
    'spec: { selector: { app: pg } }',
    '---',
    'kind: Service',
    'metadata: { name: orders, namespace: shop }',
    'spec: { selector: { app: orders } }',
    '---',
    'kind: Service',
    'metadata: { name: cache, namespace: infra }',
    'spec: { selector: { app: redis } }',
    '---',
    'kind: Ingress',
    'metadata: { name: public, namespace: shop }',
    'spec: { rules: [{ host: shop.io, http: { paths: [{ path: /api, backend: { service: { name: orders } } }] } }] }',
    '---',
    'kind: ConfigMap',
    'metadata: { name: settings }',
  ].join('\n');
  const k = await store.createDesign({ id: 'kube', title: 'Kube' });
  const { readInfra } = await import('./infra.ts');
  assert.deepEqual(readInfra(kube).skipped, ['ConfigMap settings'], 'what draws nothing is reported');
  assert.throws(() => readInfra('kind: Deployment\nmetadata: { name: {{ .Release.Name }} }'), /helm template/);
  importInfra(k, kube, { guess });
  assert.deepEqual(
    k.components.map((c) => `${c.id}:${c.type}:${c.tech ?? ''}:${c.boundary ?? ''}`),
    ['orders:service:orders:3:shop', 'pg:sql-db:postgres:16:shop', 'redis:cache:redis:7:infra', 'backup:cron:postgres:16:shop', 'public:load-balancer:Ingress:shop'],
  );
  assert.deepEqual(
    k.connections.map((c) => `${c.from}>${c.to}:${c.label ?? ''}`),
    ['orders>pg:', 'orders>redis:', 'backup>pg:', 'public>orders:shop.io/api'],
  );
  await store.writeDesign(k);
  assert.throws(() => importInfra(k, 'just: text'), /docker-compose file/);
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

test('files from before versioning load as the current version, newer ones are refused', () => {
  const { version, ...old } = m.blankDesign('old', 'Old');
  assert.equal(parseDesign(old).version, version);
  assert.throws(() => parseDesign({ ...old, version: version + 1 }), /newer than this app/);
  assert.throws(() => parseDesign({ ...old, version: 'two' }), /whole number/);
});

test('imports Terraform state and plan JSON, and finds what the design lacks', async () => {
  const { readInfra, importInfra, infraDrift, syncInfra } = await import('./infra.ts');
  const res = (address: string, type: string, values: object, extra: object = {}) => ({ address, mode: 'managed', type, name: address.split('.').pop()!.replace(/\[.*/, ''), values, ...extra });
  const state = JSON.stringify({
    format_version: '1.0',
    values: {
      root_module: {
        resources: [
          res('aws_lb.public', 'aws_lb', { name: 'public' }, { depends_on: ['aws_ecs_service.api'] }),
          res('aws_ecs_service.api', 'aws_ecs_service', { name: 'api' }, { depends_on: ['aws_db_instance.main', 'aws_iam_role.task'] }),
          res('aws_iam_role.task', 'aws_iam_role', {}),
          res('aws_iam_role.other', 'aws_iam_role', {}),
          { address: 'data.aws_vpc.default', mode: 'data', type: 'aws_vpc', name: 'default', values: {} },
        ],
        child_modules: [{ address: 'module.data', resources: [res('module.data.aws_db_instance.main', 'aws_db_instance', { identifier: 'orders-db', engine: 'postgres' })] }],
      },
    },
  });
  const read = readInfra(state);
  assert.deepEqual(read.parts.map((p) => `${p.label}:${p.type}:${p.tech}:${p.group}`), ['public:load-balancer:ALB/NLB:root', 'api:service:ECS:root', 'orders-db:sql-db:RDS postgres:module.data']);
  assert.deepEqual(read.skipped, ['aws_iam_role ×2'], 'IAM and data sources draw nothing');
  assert.throws(() => readInfra('resource "aws_s3_bucket" "b" {}'), /terraform show -json/);

  // depends_on in state is relative to the module, so "aws_db_instance.main" from the root does not reach module.data.
  const x = await store.createDesign({ id: 'tf', title: 'TF' });
  importInfra(x, state, { guess: () => 'container' });
  assert.equal(x.components.find((c) => c.id === 'api')?.type, 'service', 'a Terraform type is not second-guessed');
  assert.deepEqual(x.connections.map((c) => `${c.from}>${c.to}`), ['public>api']);

  // A plan's configuration references (by attribute, across modules) become lines too.
  const plan = JSON.stringify({
    format_version: '1.2',
    planned_values: { root_module: { resources: [res('aws_ecs_service.api', 'aws_ecs_service', { name: 'api' }), res('aws_sqs_queue.jobs[0]', 'aws_sqs_queue', { name: 'jobs' })] } },
    configuration: { root_module: { resources: [{ address: 'aws_ecs_service.api', expressions: { environment: { references: ['aws_sqs_queue.jobs.url', 'aws_sqs_queue.jobs'] } } }] } },
  });
  assert.deepEqual(readInfra(plan).links, [{ from: 'aws_ecs_service.api', to: 'aws_sqs_queue.jobs[0]' }]);

  const drift = infraDrift(x, plan);
  assert.deepEqual([drift.components, drift.connections, drift.drifted], [['jobs'], ['api → jobs'], true], 'only what the design lacks');
  assert.equal(x.components.length, 3, 'a drift check changes nothing');
  const step = syncInfra(x, plan, 'Sync with plan');
  assert.ok(step && !x.steps.find((s) => s.id === step)!.seen, 'the sync lands as a step to review');
  assert.equal(x.components.find((c) => c.id === 'jobs')?.step, step);
  assert.equal(infraDrift(x, plan).drifted, false);
  assert.equal(syncInfra(x, plan, 'Again'), undefined, 'no empty step when nothing is missing');
});

test('a shared HTML file inlines the app and bakes in the design and what its parts open', async () => {
  const { shareHtml } = await import('../server/share.ts');
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-dist-'));
  await fs.mkdir(path.join(dist, 'assets'));
  await fs.writeFile(
    path.join(dist, 'index.html'),
    '<html><head><title>System Design</title>\n<script type="module" crossorigin src="/assets/index-a.js"></script>\n<link rel="stylesheet" crossorigin href="/assets/index-b.css"></head><body></body></html>',
  );
  await fs.writeFile(path.join(dist, 'assets/index-a.js'), 'const s = "</script>"; const r = "$&";');
  await fs.writeFile(path.join(dist, 'assets/index-b.css'), 'body{color:red}');
  const inner = await store.createDesign({ id: 'share-inner', title: 'Inner' });
  const outer = await store.createDesign({ id: 'share-outer', title: 'Outer <b>' });
  m.addComponent(outer, { type: 'service', label: '</script><x>', detail: inner.id });
  m.addComponent(outer, { type: 'service', label: 'Gone', detail: 'share-missing' });
  await store.writeDesign(outer);

  const html = await shareHtml('share-outer', dist);
  assert.match(html, /<title>Outer &#60;b&#62;<\/title>/);
  assert.match(html, /<style>body\{color:red\}<\/style>/);
  assert.ok(html.includes('<script type="module">const s = "<\\/script>"; const r = "$&";</script>'), 'the bundle cannot close its tag, and "$&" stays literal');
  assert.doesNotMatch(html, /src="\/assets|href="\/assets/);
  const baked = JSON.parse(html.match(/<script type="application\/json" id="shared-designs">(.*?)<\/script>/s)![1]);
  assert.deepEqual(baked.map((d: { id: string }) => d.id), ['share-outer', 'share-inner'], 'drill-downs come along; a missing one is skipped');
  assert.equal(baked[0].components[0].label, '</script><x>');
  await assert.rejects(shareHtml('share-nope', dist), /not found/);
  await assert.rejects(shareHtml('share-outer', path.join(dist, 'none')), /npm run build/);
});

test('capacity is checked against incoming load, and a failure shows what it breaks', async () => {
  const { lint, failureImpact, loadOf } = await import('./lint.ts');
  const x = m.blankDesign('cap', 'Cap');
  const add = (label: string, type: Parameters<typeof m.addComponent>[1]['type'], capacity?: number) => m.addComponent(x, { label, type, capacity });
  const user = add('User', 'user');
  const lb = add('LB', 'load-balancer', 10000);
  const a = add('API A', 'service', 1000);
  const b = add('API B', 'service', 1000);
  const db = add('DB', 'sql-db', 1500);
  const cache = add('Cache', 'cache');
  m.connect(x, { from: user, to: lb, qps: 2000 });
  m.connect(x, { from: lb, to: a, qps: 1000 });
  m.connect(x, { from: lb, to: b, qps: 900 });
  m.connect(x, { from: a, to: db, qps: 700 });
  m.connect(x, { from: b, to: db, qps: 900 });
  m.connect(x, { from: a, to: cache });
  m.addFlow(x, { title: 'Read', path: [user, lb, a, db] });

  assert.deepEqual(loadOf(x, db), { load: 1600, capacity: 1500 });
  const issues = lint(x).filter((i) => i.rule.includes('capacity')).map((i) => `${i.id}:${i.rule}`);
  assert.deepEqual(issues, ['api-a:near-capacity', 'api-b:near-capacity', 'db:over-capacity'], 'at 100% is near, past it is over; no capacity, no check');

  assert.deepEqual(failureImpact(x, a), { flows: ['Read'], cutOff: ['Cache'] }, 'DB still has B; only A reaches the cache');
  assert.deepEqual(failureImpact(x, lb), { flows: ['Read'], cutOff: ['API A', 'API B', 'DB', 'Cache'] });
  assert.deepEqual(failureImpact(x, cache), { flows: [], cutOff: [] });
});

test('drift matches parts by where they came from and removes what the infrastructure dropped', async () => {
  const { importInfra, infraDrift, syncInfra } = await import('./infra.ts');
  const compose = (names: string[]) => `services:\n${names.map((n) => `  ${n}:\n    image: ${n}`).join('\n')}`;
  const x = m.blankDesign('src', 'Src');
  importInfra(x, compose(['api', 'worker']));
  assert.deepEqual(x.components.map((c) => c.source), ['compose:api', 'compose:worker']);
  // Renamed in the design, removed from the infrastructure, plus a hand-drawn part and one from Terraform.
  x.components[0].label = 'Orders API';
  m.addComponent(x, { type: 'cdn', label: 'CDN' });
  m.addComponent(x, { type: 'queue', label: 'jobs', source: 'terraform:aws_sqs_queue.jobs' });

  const drift = infraDrift(x, compose(['api']));
  assert.deepEqual([drift.components, drift.removed], [[], ['worker']], 'the renamed part still matches; only what compose put there can go');
  const step = syncInfra(x, compose(['api']), 'Sync')!;
  assert.deepEqual(x.components.map((c) => c.label), ['Orders API', 'CDN', 'jobs']);
  assert.deepEqual(x.steps.find((s) => s.id === step)!.removed?.map((r) => r.label), ['worker'], 'the removal is on the step, so the diff shows it and revert brings it back');
  assert.match(x.steps.find((s) => s.id === step)!.summary!, /No longer in the infrastructure: worker/);

  // A design drawn by hand gets its sources on the first sync, by name.
  const hand = m.blankDesign('hand', 'Hand');
  m.addComponent(hand, { type: 'service', label: 'api' });
  assert.equal(infraDrift(hand, compose(['api'])).drifted, false);
  syncInfra(hand, compose(['api', 'db']), 'Sync');
  assert.deepEqual(hand.components.map((c) => c.source), ['compose:api', 'compose:db']);
});

test('Terraform lines follow wiring and undrawn resources, not shared plumbing', async () => {
  const { readInfra } = await import('./infra.ts');
  const res = (address: string, values: object = {}, depends_on: string[] = []) => ({ address, mode: 'managed', type: address.split('.')[0], name: address.split('.')[1], values, depends_on });
  const state = JSON.stringify({
    format_version: '1.0',
    values: {
      root_module: {
        resources: [
          res('aws_lb.web', { name: 'web' }),
          res('aws_lb_listener.http', {}, ['aws_lb.web', 'aws_lb_target_group.api']),
          res('aws_lb_target_group.api'),
          res('aws_ecs_service.api', { name: 'api' }, ['aws_lb_target_group.api', 'aws_ecs_task_definition.api', 'aws_iam_role.shared', 'aws_security_group.app']),
          res('aws_ecs_task_definition.api', {}, ['aws_db_instance.db']),
          res('aws_db_instance.db', { identifier: 'db' }),
          res('aws_sqs_queue.jobs', { name: 'jobs' }),
          res('aws_lambda_event_source_mapping.jobs', {}, ['aws_sqs_queue.jobs', 'aws_lambda_function.worker']),
          res('aws_lambda_function.worker', { function_name: 'worker' }, ['aws_iam_role.shared', 'aws_security_group.app']),
          res('aws_iam_role.shared'),
          res('aws_security_group.app', {}, ['aws_db_instance.db']),
        ],
      },
    },
  });
  const { parts, links } = readInfra(state);
  const label = new Map(parts.map((p) => [p.key, p.label]));
  assert.deepEqual(
    links.map((l) => `${label.get(l.from)}>${label.get(l.to)}`).sort(),
    ['api>db', 'jobs>worker', 'web>api'],
    'LB → service through listener and target group, queue → function through the mapping, service → DB through its task definition; the shared role and security group link nothing',
  );
});

test('exports Structurizr DSL, C4-PlantUML and draw.io', async () => {
  const { toStructurizr, toPlantUml, toDrawio } = await import('./interop.ts');
  const x = m.blankDesign('shop', 'Shop "v2"');
  const vpc = m.addBoundary(x, { kind: 'vpc', label: 'VPC' });
  const sub = m.addBoundary(x, { kind: 'subnet', label: 'Private', parent: vpc });
  const user = m.addComponent(x, { type: 'user', label: 'Buyer', position: { x: 0, y: 0 } });
  const stripe = m.addComponent(x, { type: 'payment', label: 'Stripe', boundary: vpc });
  const api = m.addComponent(x, { id: '1-api', type: 'service', label: 'API', tech: 'Go', boundary: vpc, position: { x: 200, y: 0 } });
  const db = m.addComponent(x, { type: 'sql-db', label: 'Orders <db>', tech: 'PostgreSQL', boundary: sub, position: { x: 200, y: 200 } });
  const q = m.addComponent(x, { type: 'queue', label: 'Jobs', position: { x: 400, y: 0 } });
  m.connect(x, { from: user, to: api, label: 'HTTPS' });
  m.connect(x, { from: api, to: db });
  m.connect(x, { from: api, to: q, async: true });
  m.connect(x, { from: api, to: stripe, label: 'charge' });

  const dsl = toStructurizr(x);
  assert.match(dsl, /^workspace "Shop \\"v2\\"" "" \{/);
  assert.match(dsl, /buyer = person "Buyer" ""/);
  assert.match(dsl, /stripe = softwareSystem "Stripe" "" "External"/, 'a third party sits outside the system, even inside a boundary');
  assert.match(dsl, /group "VPC" \{\n\s+group "Private" \{\n\s+orders_db = container "Orders <db>" "" "PostgreSQL" "Database"/);
  assert.match(dsl, /x1_api = container "API" "" "Go" ""/, 'identifiers never start with a digit');
  assert.match(dsl, /buyer -> system_\.x1_api "HTTPS"/);
  assert.match(dsl, /system_\.x1_api -> system_\.jobs "" "" "Async"/);
  assert.equal(dsl.split('{').length, dsl.split('}').length, 'braces balance');

  const puml = toPlantUml(x);
  assert.match(puml, /Person\(buyer, "Buyer", ""\)/);
  assert.match(puml, /Boundary\(b_vpc, "VPC", "vpc"\) \{\n {2}Boundary\(b_private, "Private", "subnet"\) \{\n {4}ContainerDb\(orders_db, "Orders <db>", "PostgreSQL", ""\)/);
  assert.match(puml, /System_Ext\(stripe, "Stripe", ""\)/);
  assert.match(puml, /Rel\(x1_api, jobs, "async"\)/);
  assert.match(puml, /title Shop "v2"/);

  const xml = toDrawio(x);
  assert.match(xml, /value="Orders &#60;db&#62;&lt;br&gt;&lt;i&gt;PostgreSQL&lt;\/i&gt;" style="shape=cylinder3/);
  assert.match(xml, /id="c-stripe"[^>]*><mxGeometry x="\d+" y="\d+"/, 'a part never laid out still gets a place');
  assert.match(xml, /id="e-[^"]+" value="" style="endArrow=block;html=1;dashed=1;" edge="1" parent="1" source="c-1-api" target="c-jobs"/);
  // The VPC box holds the Private box, which holds the DB at (200, 200).
  const geo = (id: string) => xml.match(new RegExp(`id="${id}"[^>]*><mxGeometry x="(-?\\d+)" y="(-?\\d+)" width="(\\d+)" height="(\\d+)"`))!.slice(1).map(Number);
  const [px, py, pw, ph] = geo('b-private');
  assert.ok(px <= 200 && py <= 200 && px + pw >= 360 && py + ph >= 270);
  const [vx, vy, vw, vh] = geo('b-vpc');
  assert.ok(vx <= px && vy <= py && vx + vw >= px + pw && vy + vh >= py + ph);
  assert.ok(xml.indexOf('id="b-vpc"') < xml.indexOf('id="b-private"'), 'outer boxes draw first');
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

test('imports OpenTelemetry and Jaeger traces with measured load, latency and flows', async () => {
  const { importInfra, infraDrift, syncInfra, readInfra } = await import('./infra.ts');
  const ms = (n: number) => String(BigInt(1_700_000_000_000 + n) * 1_000_000n);
  const attr = (o: Record<string, string>) => Object.entries(o).map(([key, v]) => ({ key, value: { stringValue: v } }));
  const span = (trace: string, id: string, parent: string, name: string, kind: number, start: number, end: number, a: Record<string, string> = {}) => ({
    traceId: trace, spanId: id, parentSpanId: parent, name, kind, startTimeUnixNano: ms(start), endTimeUnixNano: ms(end), attributes: attr(a),
  });
  const batch = (service: string, spans: object[]) => JSON.stringify({ resourceSpans: [{ resource: { attributes: attr({ 'service.name': service }) }, scopeSpans: [{ spans }] }] });
  // Two requests a second apart; the collector's file exporter writes one JSON object per line.
  const trace = (t: string, at: number) => [
    batch('frontend', [span(t, 's1', '', 'GET /orders', 2, at, at + 100), span(t, 'c1', 's1', 'GET', 3, at + 10, at + 60)]),
    batch('orders', [
      span(t, 's2', 'c1', 'GET /orders', 2, at + 15, at + 55),
      span(t, 'c2', 's2', 'SELECT', 3, at + 20, at + 30, { 'db.system': 'postgresql', 'db.name': 'shop' }),
      span(t, 'p1', 's2', 'publish', 4, at + 35, at + 36, { 'messaging.system': 'kafka', 'messaging.destination.name': 'order-events' }),
    ]),
    batch('payments', [
      span(t, 'k1', 'p1', 'process', 5, at + 200, at + 210, { 'messaging.system': 'kafka', 'messaging.destination.name': 'order-events' }),
      span(t, 'h1', 'k1', 'POST', 3, at + 201, at + 205, { 'url.full': 'https://api.stripe.com/v1/charges' }),
    ]),
  ];
  const otlp = [...trace('t1', 0), ...trace('t2', 1000)].join('\n');

  const x = m.blankDesign('otel', 'OTel');
  importInfra(x, otlp);
  const byId = (id: string) => x.components.find((c) => c.id === id)!;
  assert.deepEqual(x.components.map((c) => `${c.label}:${c.type}:${c.tech ?? ''}`).sort(), ['api.stripe.com:external:', 'frontend:service:', 'order-events:stream:kafka', 'orders:service:', 'payments:service:', 'shop:sql-db:postgresql']);
  const line = (a: string, b: string) => x.connections.find((c) => byId(c.from).label === a && byId(c.to).label === b);
  assert.deepEqual(line('frontend', 'orders') && [line('frontend', 'orders')!.latency, line('frontend', 'orders')!.qps], [25, 1.7], 'half the 50 ms the caller saw; 2 calls in 1.2 s');
  assert.equal(line('orders', 'shop')?.latency, 5);
  assert.deepEqual([line('orders', 'order-events')?.async, line('order-events', 'payments')?.async, line('order-events', 'payments')?.latency], [true, true, undefined]);
  assert.ok(line('payments', 'api.stripe.com'));
  assert.equal(x.connections.length, 5, 'no direct orders → payments line: that hop goes through the topic');
  assert.deepEqual(
    x.flows.map((f) => [f.title, f.path.map((p) => byId(p).label).join(' > ')]),
    [['GET /orders', 'frontend > orders > shop > orders > order-events > payments > api.stripe.com']],
  );
  assert.equal(parseDesign(structuredClone(x)).flows.length, 1);

  // A design drawn by hand gets the measured numbers on its lines, as a reviewed change, and traces never remove parts.
  const hand = m.blankDesign('hand-otel', 'Hand');
  const fe = m.addComponent(hand, { type: 'service', label: 'frontend' });
  const or = m.addComponent(hand, { type: 'service', label: 'orders' });
  m.addComponent(hand, { type: 'cdn', label: 'CDN', source: 'otel:svc:cdn' });
  m.connect(hand, { from: fe, to: or, qps: 1.6, latency: 100 });
  const drift = infraDrift(hand, otlp);
  assert.deepEqual([drift.updated, drift.removed, drift.flows], [['frontend → orders: 1.7 req/s, 25 ms'], [], ['GET /orders']], 'qps within a quarter keeps its value; latency 4× off is replaced');
  const step = syncInfra(hand, otlp, 'Sync with traces')!;
  assert.deepEqual([hand.connections[0].qps, hand.connections[0].latency], [1.6, 25]);
  assert.deepEqual(hand.steps.find((s) => s.id === step)!.changed?.map((c) => `${c.field}:${c.from}>${c.to}`), ['latency:100>25']);
  assert.ok(hand.components.some((c) => c.label === 'CDN'));

  // Jaeger's JSON download.
  const jaeger = JSON.stringify({
    data: [{
      traceID: 'j1',
      processes: { p1: { serviceName: 'web' }, p2: { serviceName: 'api' } },
      spans: [
        { traceID: 'j1', spanID: 'a', operationName: 'GET /', references: [], startTime: 0, duration: 30000, processID: 'p1', tags: [{ key: 'span.kind', value: 'server' }] },
        { traceID: 'j1', spanID: 'b', operationName: 'GET /api', references: [{ refType: 'CHILD_OF', spanID: 'a' }], startTime: 1000, duration: 20000, processID: 'p1', tags: [{ key: 'span.kind', value: 'client' }] },
        { traceID: 'j1', spanID: 'c', operationName: 'GET /api', references: [{ refType: 'CHILD_OF', spanID: 'b' }], startTime: 2000, duration: 10000, processID: 'p2', tags: [{ key: 'span.kind', value: 'server' }] },
        { traceID: 'j1', spanID: 'd', operationName: 'GET', references: [{ refType: 'CHILD_OF', spanID: 'c' }], startTime: 3000, duration: 2000, processID: 'p2', tags: [{ key: 'span.kind', value: 'client' }, { key: 'db.system', value: 'redis' }] },
      ],
    }],
  });
  const j = readInfra(jaeger);
  assert.deepEqual(j.parts.map((p) => `${p.label}:${p.type}`), ['web:service', 'api:service', 'redis:cache']);
  assert.deepEqual(j.links.map((l) => `${l.from}>${l.to}:${l.latency}`), ['svc:web>svc:api:10', 'svc:api>db:redis::1']);
  assert.throws(() => readInfra('{"resourceSpans": []}'), /no spans/);
});

test('imports Mermaid sequence, C4 and architecture diagrams, and pastes any format as a step', async () => {
  const { importMermaid, parseMermaid, mermaidKind } = await import('./mermaid.ts');
  const { importAsStep, formatOf } = await import('./importer.ts');
  const { toMermaidSequence } = await import('./export.ts');
  const { toPlantUml } = await import('./interop.ts');
  const { guessType } = await import('../src/shapes.ts');
  const labels = (d: { components: { id: string; label: string }[] }, ids: string[]) => ids.map((id) => d.components.find((c) => c.id === id)!.label).join(' > ');

  // A flow exported as a sequence diagram comes back as the same parts, lines and flow.
  const src = m.blankDesign('seq-src', 'Src');
  const user = m.addComponent(src, { type: 'user', label: 'User' });
  const api = m.addComponent(src, { type: 'service', label: 'Orders API' });
  const db = m.addComponent(src, { type: 'sql-db', label: 'Orders DB' });
  m.connect(src, { from: user, to: api });
  m.connect(src, { from: api, to: db });
  m.addFlow(src, { title: 'Place order', path: [user, api, db, api, user] });
  const back = m.blankDesign('seq-back', 'Back');
  const got = importMermaid(back, toMermaidSequence(src, src.flows[0]));
  assert.deepEqual([got.components, got.connections.length, got.flows], [['User', 'Orders API', 'Orders DB'], 2, ['Place order']]);
  assert.equal(labels(back, back.flows[0].path), 'User > Orders API > Orders DB > Orders API > User');

  // Hand-written: actors, async calls, blocks and notes; a call back from an earlier participant walks the same line.
  const hand = [
    '---',
    'title: ignored front matter',
    '---',
    'sequenceDiagram',
    '  actor C as Customer',
    '  participant W as Web',
    '  C->>+W: Checkout',
    '  W-)Q: order placed',
    '  Note over W,Q: fire and forget',
    '  loop retry',
    '    W->>P: charge',
    '  end',
    '  P-->>W: ok',
    '  W-->>-C: done',
    '  this is not a message',
  ].join('\n');
  assert.equal(mermaidKind(hand), 'sequence');
  const p = parseMermaid(hand);
  assert.deepEqual(p.skipped, [15]);
  assert.deepEqual(p.edges.map((e) => `${e.from}>${e.to}:${e.label ?? ''}:${e.async}`), ['C>W:Checkout:false', 'W>Q:order placed:true', 'W>P:charge:false']);
  assert.deepEqual(p.flows, [{ title: 'Sequence diagram', path: ['C', 'W', 'Q', 'W', 'P', 'W', 'C'] }]);

  // Pasting into a design that has some of the parts reuses them, by name, and adds the rest as one new step.
  const shop = m.blankDesign('seq-shop', 'Shop');
  const web = m.addComponent(shop, { type: 'client', label: 'web' });
  const step = importAsStep(shop, hand, { guess: guessType });
  const last = shop.steps.at(-1)!;
  assert.deepEqual([last.id, last.title, last.summary, last.seen], [step, 'Import Mermaid sequence diagram', 'From a Mermaid sequence diagram: 3 parts, 3 lines, 1 flow. Left out: line 15 (can’t be read).', false]);
  assert.equal(shop.components.filter((c) => c.label.toLowerCase() === 'web').length, 1);
  assert.ok(shop.connections.some((c) => c.from === web && c.step === step));
  assert.throws(() => importAsStep(structuredClone(shop), hand), /already on the sheet/);

  // C4 in Mermaid's own syntax, with boundaries, stores, external systems and Rel_Back.
  const c4 = [
    'C4Container',
    '  title Internet banking',
    '  Person(customer, "Customer", "A bank customer")',
    '  System_Boundary(bank, "Internet Banking") {',
    '    Container(spa, "Single-Page App", "Angular", "Banking in the browser")',
    '    Container(api, "API Application", "Java, Spring")',
    '    ContainerDb(db, "Database", "MongoDB", $tags="v1")',
    '    ContainerQueue(events, "Events", "Kafka")',
    '  }',
    '  System_Ext(mail, "E-mail system")',
    '  Rel(customer, spa, "Uses", "HTTPS")',
    '  Rel(spa, api, "Calls", "JSON/HTTPS")',
    '  Rel_Back(db, api, "Reads from and writes to")',
    '  Rel(api, events, "async")',
    '  Rel(api, mail, "Sends e-mail using")',
    '  UpdateRelStyle(customer, spa, $offsetY="-40")',
  ].join('\n');
  const x = m.blankDesign('c4', 'C4');
  importMermaid(x, c4, { guess: guessType });
  assert.deepEqual(
    x.components.map((c) => `${c.label}:${c.type}:${c.tech ?? ''}:${c.boundary ?? ''}`),
    ['Customer:user::', 'Single-Page App:ui:Angular:bank', 'API Application:service:Java, Spring:bank', 'Database:nosql-db:MongoDB:bank', 'Events:stream:Kafka:bank', 'E-mail system:external::'],
    'a C4 database narrows to its technology',
  );
  assert.deepEqual([x.boundaries[0].kind, x.components[1].description], ['system', 'Banking in the browser']);
  assert.deepEqual(x.connections.map((c) => `${c.from}>${c.to}:${c.label ?? ''}:${!!c.async}`), ['customer>spa::false', 'spa>api:Calls:false', 'api>db:Reads from and writes to:false', 'api>events::true', 'api>mail:Sends e-mail using:false']);

  // Our own C4-PlantUML export reads back, boundary kinds included.
  const puml = m.blankDesign('puml', 'Puml');
  importMermaid(puml, toPlantUml(x), { guess: guessType });
  assert.equal(formatOf(toPlantUml(x)), 'C4 diagram');
  assert.deepEqual(puml.components.map((c) => `${c.label}:${c.type}`).sort(), x.components.map((c) => `${c.label}:${c.type}`).sort());
  assert.deepEqual([puml.boundaries[0].kind, puml.connections.length, puml.connections.filter((c) => c.async).length], ['system', 5, 1]);

  // architecture-beta: groups nest, icons type the parts, arrows give direction; lines through junctions are reported.
  const arch = [
    'architecture-beta',
    '  group cloud(cloud)[Cloud]',
    '  group net(cloud)[Private net] in cloud',
    '  service gw(internet)[Gateway] in cloud',
    '  service app(server)[App] in net',
    '  service db(database)[Database] in net',
    '  service fn(logos:aws-lambda)[Resize]',
    '  junction j1 in cloud',
    '  gw:R --> L:app',
    '  db:L <-- R:app',
    '  app:B -- T:fn',
    '  app:T -- B:j1',
  ].join('\n');
  assert.deepEqual(parseMermaid(arch).skipped, [12]);
  const y = m.blankDesign('arch', 'Arch');
  importMermaid(y, arch, { guess: guessType });
  assert.deepEqual(y.components.map((c) => `${c.id}:${c.type}:${c.boundary ?? ''}`), ['gw:internet:cloud', 'app:service:net', 'db:sql-db:net', 'fn:function:']);
  assert.deepEqual(y.boundaries.map((b) => `${b.id}:${b.parent ?? ''}`), ['cloud:', 'net:cloud']);
  assert.deepEqual(y.connections.map((c) => `${c.from}>${c.to}`), ['gw>app', 'app>db', 'app>fn']);

  assert.deepEqual([formatOf('just some words'), formatOf('services:\n  api:\n    image: nginx'), formatOf('flowchart LR\n  a --> b')], [undefined, 'docker-compose file', 'Mermaid flowchart']);
  assert.throws(() => importAsStep(m.blankDesign('none', 'None'), 'hello'), /Paste a Mermaid flowchart/);
});

test('imports draw.io files and Structurizr workspaces, our own exports included', async () => {
  const { readDrawio, expandDrawio } = await import('./drawio.ts');
  const { readStructurizr } = await import('./structurizr.ts');
  const { importDiagram } = await import('./diagram.ts');
  const { formatOf, importAsStep, unpack } = await import('./importer.ts');
  const { toDrawio, toStructurizr } = await import('./interop.ts');
  const { guessType } = await import('../src/shapes.ts');
  const zlib = await import('node:zlib');

  const src = m.blankDesign('rival-src', 'Shop');
  const vpc = m.addBoundary(src, { kind: 'vpc', label: 'VPC' });
  const user = m.addComponent(src, { type: 'user', label: 'Shopper', position: { x: 0, y: 0 } });
  const api = m.addComponent(src, { type: 'service', label: 'Orders API', tech: 'Node.js', boundary: vpc, position: { x: 300, y: 0 } });
  const db = m.addComponent(src, { type: 'sql-db', label: 'Orders DB', tech: 'PostgreSQL', boundary: vpc, position: { x: 300, y: 200 } });
  const q = m.addComponent(src, { type: 'queue', label: 'Jobs', boundary: vpc, position: { x: 600, y: 200 } });
  const pay = m.addComponent(src, { type: 'external', label: 'Stripe', position: { x: 900, y: 0 } });
  m.connect(src, { from: user, to: api, label: 'HTTPS' });
  m.connect(src, { from: api, to: db });
  m.connect(src, { from: api, to: q, async: true });
  m.connect(src, { from: api, to: pay, label: 'charges' });
  const shape = (d: typeof src) => ({
    parts: d.components.map((c) => `${c.label}:${c.type}:${c.tech ?? ''}:${d.boundaries.find((b) => b.id === c.boundary)?.label ?? ''}`).sort(),
    lines: d.connections.map((c) => `${d.components.find((x) => x.id === c.from)!.label}>${d.components.find((x) => x.id === c.to)!.label}:${c.label ?? ''}:${!!c.async}`).sort(),
  });

  // draw.io: our export comes back with its types, boxes (drawn around the parts) and positions.
  const fromDrawio = m.blankDesign('rival-drawio', 'Back');
  importDiagram(fromDrawio, readDrawio(toDrawio(src)), { guess: guessType });
  const want = shape(src);
  assert.deepEqual(shape(fromDrawio), { ...want, parts: want.parts.map((p) => p.replace('Stripe:external', 'Stripe:payment')) }, 'an external part is drawn as a plain grey box, so its name decides');
  assert.deepEqual(fromDrawio.components.map((c) => c.position), src.components.map((c) => c.position));

  // A hand-drawn AWS diagram: icons type the parts, a VPC group holds what is nested in it, labels may be HTML.
  const aws = `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="vpc" value="Prod VPC" style="points=[];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;dashed=0;" vertex="1" parent="1"><mxGeometry x="200" y="100" width="500" height="300" as="geometry"/></mxCell>
    <object label="Resize&lt;br&gt;images on upload" id="fn"><mxCell style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;" vertex="1" parent="vpc"><mxGeometry x="40" y="60" width="78" height="78" as="geometry"/></mxCell></object>
    <mxCell id="rds" value="" style="shape=mxgraph.aws4.rds_instance;" vertex="1" parent="vpc"><mxGeometry x="300" y="60" width="78" height="78" as="geometry"/></mxCell>
    <mxCell id="s3" value="Uploads" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;" vertex="1" parent="1"><mxGeometry x="800" y="160" width="78" height="78" as="geometry"/></mxCell>
    <mxCell id="u" value="Users" style="shape=umlActor;" vertex="1" parent="1"><mxGeometry x="20" y="160" width="30" height="60" as="geometry"/></mxCell>
    <mxCell id="note" value="draft" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="20" as="geometry"/></mxCell>
    <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="s3" target="fn"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="e1l" value="ObjectCreated" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1"><mxGeometry x="-0.1" relative="1" as="geometry"/></mxCell>
    <mxCell id="e2" value="writes" style="endArrow=none;startArrow=block;dashed=1;" edge="1" parent="1" source="rds" target="fn"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="e3" style="" edge="1" parent="1" source="u"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="e4" style="" edge="1" parent="1" source="u" target="vpc"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram><diagram id="p2" name="Notes"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>`;
  const read = readDrawio(aws);
  assert.deepEqual(read.leftOut, ['1 more page (only the first is read)', '1 line not attached at both ends', '1 line to a box rather than a part']);
  const x = m.blankDesign('rival-aws', 'AWS');
  importDiagram(x, read, { guess: guessType });
  assert.deepEqual(
    x.components.map((c) => `${c.label}:${c.type}:${c.description ?? ''}:${c.boundary ?? ''}`),
    ['Resize:function:images on upload:prod-vpc', 'Rds:sql-db::prod-vpc', 'Uploads:object-storage::', 'Users:user::'],
  );
  assert.deepEqual([x.boundaries[0].kind, x.components[0].position], ['vpc', { x: 200 + 40 + 39 - 80, y: 100 + 60 + 39 - 35 }], 'nested geometry is relative to its parent');
  assert.deepEqual(shape(x).lines, ['Resize>Rds:writes:true', 'Uploads>Resize:ObjectCreated:false'], 'an arrowhead only at the start points the line back');

  // Compressed pages (older files) and draw.io's own clipboard (URI-encoded) read the same.
  const page = /<mxGraphModel>[\s\S]*?<\/mxGraphModel>/.exec(aws)![0];
  const compressed = `<mxfile><diagram id="p1">${zlib.deflateRawSync(Buffer.from(encodeURIComponent(page))).toString('base64')}</diagram></mxfile>`;
  assert.throws(() => readDrawio(compressed), /compressed/);
  assert.deepEqual(readDrawio(await expandDrawio(compressed)).nodes.map((n) => n.label), read.nodes.map((n) => n.label));
  assert.equal(formatOf(await unpack(encodeURIComponent(page))), 'draw.io diagram');

  // Structurizr: our export comes back, the system becoming the box around its containers.
  const fromDsl = m.blankDesign('rival-dsl', 'Back');
  const dsl = readStructurizr(toStructurizr(src));
  importDiagram(fromDsl, dsl, { guess: guessType });
  assert.deepEqual(shape(fromDsl), want);
  assert.deepEqual(fromDsl.boundaries.map((b) => `${b.label}:${b.kind}:${fromDsl.boundaries.find((p) => p.id === b.parent)?.label ?? ''}`), ['Shop:system:', 'VPC:group:Shop']);

  // Hand-written: hierarchical identifiers, relationships inside blocks, components, and a dynamic view as a flow.
  const hand = `
    /* An online shop */
    workspace "Shop" {
      !identifiers hierarchical
      model {
        customer = person "Customer"
        stripe = softwareSystem "Stripe" "Payments" "External"
        shop = softwareSystem "Shop" {
          web = container "Web" "Storefront" "React"
          api = container "API" {
            technology "Go"
            orders = component "Orders" "Order handling" "Go"
            -> stripe "Charges cards" "HTTPS"
          }
          db = container "Database" "" "PostgreSQL" "Database"
          events = container "Events" "" "Kafka" "Queue"
        }
        customer -> shop "Buys from"
        customer -> shop.web "Browses"
        shop.web -> shop.api "Calls"
        shop.api.orders -> shop.db "Reads and writes"
        shop.api -> shop.events "Publishes" "" "Async"
        # a comment
        shop.web->shop.api
      }
      views {
        dynamic shop "checkout" "Customer checks out" {
          customer -> shop.web "Places order"
          shop.web -> shop.api "POST /orders"
          shop.api -> stripe "Charge"
          autoLayout
        }
        styles {
          element "Database" {
            shape cylinder
          }
        }
      }
    }`;
  const h = readStructurizr(hand);
  assert.deepEqual(h.leftOut, ['1 component (drawn as their containers)', '1 relationship with a software system drawn as a box (its containers carry them)']);
  const y = m.blankDesign('rival-hand', 'Hand');
  importDiagram(y, h, { guess: guessType });
  assert.deepEqual(shape(y), {
    parts: ['API:service:Go:Shop', 'Customer:user::', 'Database:sql-db:PostgreSQL:Shop', 'Events:stream:Kafka:Shop', 'Stripe:external::', 'Web:client:React:Shop'],
    lines: ['API>Database:Reads and writes:false', 'API>Events:Publishes:true', 'API>Stripe:Charges cards:false', 'Customer>Web:Browses:false', 'Web>API:Calls:false'],
  });
  assert.deepEqual(y.flows.map((f) => `${f.title}: ${f.path.map((p) => y.components.find((c) => c.id === p)!.label).join(' > ')}`), ['Customer checks out: Customer > Web > API > Stripe']);
  assert.equal(formatOf(hand), 'Structurizr workspace');

  // As a step: what was left out goes in its summary.
  const z = m.blankDesign('rival-step', 'Step');
  importAsStep(z, aws, { guess: guessType });
  assert.match(z.steps.at(-1)!.summary!, /^From a draw\.io diagram: 4 parts, 2 lines, 1 boundary\. Left out: 1 more page/);
});

test('imports catalogs, API specs, CloudFormation and Pulumi stacks, and checks drift against them', async () => {
  const { readInfra, infraDrift } = await import('./infra.ts');
  const { formatOf, importAsStep } = await import('./importer.ts');
  const { guessType } = await import('../src/shapes.ts');
  const lines = (d: ReturnType<typeof m.blankDesign>) =>
    d.connections.map((c) => `${d.components.find((x) => x.id === c.from)!.label}>${d.components.find((x) => x.id === c.to)!.label}${c.label ? `:${c.label}` : ''}${c.async ? ':async' : ''}`).sort();

  // Backstage: Systems box their parts, dependsOn and provided / consumed APIs become lines; Kubernetes-like kind: does not fool it.
  const catalog = `
apiVersion: backstage.io/v1alpha1
kind: System
metadata: { name: shop, title: Shop }
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: orders
  description: Takes orders
  annotations: { backstage.io/source-location: "url:https://github.com/acme/orders/" }
spec: { type: service, system: shop, dependsOn: [resource:orders-db], providesApis: [orders-api] }
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata: { name: storefront }
spec: { type: website, system: shop, consumesApis: [orders-api, payments-api] }
---
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata: { name: orders-db }
spec: { type: database, system: shop }
---
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata: { name: sessions }
spec: { type: redis }
---
apiVersion: backstage.io/v1alpha1
kind: API
metadata: { name: orders-api, title: Orders API }
spec: { type: openapi }
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata: { name: team-a }
`;
  assert.equal(formatOf(catalog), 'Backstage catalog');
  const b = m.blankDesign('cat', 'Cat');
  importAsStep(b, catalog, { guess: guessType });
  assert.deepEqual(
    b.components.map((c) => `${c.label}:${c.type}:${c.tech ?? ''}:${c.boundary ?? ''}`),
    ['orders:service::shop', 'storefront:client::shop', 'orders-db:sql-db::shop', 'sessions:cache:redis:'],
  );
  assert.equal(b.components[0].description, 'Takes orders');
  assert.equal(b.components[0].code, 'https://github.com/acme/orders/');
  assert.deepEqual(lines(b), ['orders>orders-db', 'storefront>orders:Orders API']);
  assert.match(b.steps.at(-1)!.summary!, /Left out: Group team-a, API payments-api \(no provider in the catalog\)/);
  assert.equal(infraDrift(b, catalog, guessType).drifted, false, 'a design imported from a catalog has no drift against it');
  assert.deepEqual(infraDrift(b, catalog.replace('dependsOn: [resource:orders-db], ', ''), guessType).drifted, false, 'a line gone from the catalog is not removed');
  assert.deepEqual(infraDrift(b, catalog.replace(/---\napiVersion: backstage.io\/v1alpha1\nkind: Resource\nmetadata: \{ name: sessions \}\nspec: \{ type: redis \}\n/, ''), guessType).removed, ['sessions']);

  // OpenAPI: one service, its endpoints in the description.
  const api = JSON.stringify({ openapi: '3.1.0', info: { title: 'Orders API', version: '2.0', description: 'Orders.' }, paths: { '/orders': { get: {}, post: {}, parameters: [] }, '/orders/{id}': { delete: {} } } });
  assert.equal(formatOf(api), 'OpenAPI document');
  const o = readInfra(api).parts[0];
  assert.deepEqual([o.label, o.type, o.tech, o.description], ['Orders API', 'service', 'REST 2.0', 'Orders.\n\nEndpoints: GET /orders, POST /orders, DELETE /orders/{id}']);

  // AsyncAPI 2 names operations from the client's side; 3 says send / receive. Kafka channels are streams.
  const v2 = `asyncapi: 2.6.0
info: { title: Orders }
servers: { prod: { url: kafka:9092, protocol: kafka } }
channels:
  order/placed: { publish: { message: {} } }
  invoice/sent: { subscribe: { message: {} } }
`;
  const v3 = JSON.stringify({
    asyncapi: '3.0.0',
    info: { title: 'Orders' },
    servers: { prod: { host: 'mq', protocol: 'amqp' } },
    channels: { orderPlaced: { address: 'order/placed' }, invoiceSent: { address: 'invoice/sent' } },
    operations: { onOrder: { action: 'receive', channel: { $ref: '#/channels/orderPlaced' } }, sendInvoice: { action: 'send', channel: { $ref: '#/channels/invoiceSent' } } },
  });
  for (const [text, type] of [[v2, 'stream'], [v3, 'queue']] as const) {
    assert.equal(formatOf(text), 'AsyncAPI document');
    const a = m.blankDesign('a', 'A');
    importAsStep(a, text, { guess: guessType });
    assert.deepEqual(a.components.map((c) => `${c.label}:${c.type}`), ['Orders:service', `order/placed:${type}`, `invoice/sent:${type}`]);
    assert.deepEqual(lines(a), ['Orders>invoice/sent:async', 'order/placed>Orders:async']);
  }

  // CloudFormation YAML with short-form functions: types, references and wiring follow the Terraform reader.
  const cfn = `AWSTemplateFormatVersion: "2010-09-09"
Parameters: { Stage: { Type: String } }
Resources:
  Jobs: { Type: AWS::SQS::Queue }
  Orders: { Type: AWS::DynamoDB::Table }
  Db: { Type: AWS::RDS::DBInstance, Properties: { Engine: postgres } }
  Role: { Type: AWS::IAM::Role }
  Worker:
    Type: AWS::Lambda::Function
    Properties:
      Role: !GetAtt Role.Arn
      Environment: { Variables: { TABLE: !Ref Orders, DB: !Sub "\${Db.Endpoint.Address}", STAGE: !Ref Stage } }
  Trigger:
    Type: AWS::Lambda::EventSourceMapping
    Properties: { EventSourceArn: !GetAtt [Jobs, Arn], FunctionName: !Ref Worker }
`;
  assert.equal(formatOf(cfn), 'CloudFormation template');
  const c = readInfra(cfn);
  assert.deepEqual(c.parts.map((p) => `${p.label}:${p.type}:${p.tech}`), ['Jobs:queue:SQS', 'Orders:nosql-db:DynamoDB', 'Db:sql-db:RDS postgres', 'Worker:function:Lambda']);
  assert.deepEqual(c.links.map((l) => `${l.from}>${l.to}`).sort(), ['aws_lambda_function.Worker>aws_db_instance.Db', 'aws_lambda_function.Worker>aws_dynamodb_table.Orders', 'aws_sqs_queue.Jobs>aws_lambda_function.Worker']);
  assert.deepEqual(c.skipped, ['AWS::IAM::Role', 'AWS::Lambda::EventSourceMapping']);

  // cdk synth: JSON, names from construct paths, the CDK metadata resource ignored.
  const cdk = JSON.stringify({
    Resources: {
      UploadsB4A1E2C3: { Type: 'AWS::S3::Bucket', Metadata: { 'aws:cdk:path': 'Shop/Uploads/Resource' } },
      ResizeFn9F3A: { Type: 'AWS::Lambda::Function', Properties: { Environment: { Variables: { BUCKET: { Ref: 'UploadsB4A1E2C3' } } } }, Metadata: { 'aws:cdk:path': 'Shop/Resize/Resource' } },
      CDKMetadata: { Type: 'AWS::CDK::Metadata' },
    },
  });
  const k = readInfra(cdk);
  assert.deepEqual([k.parts.map((p) => p.label), k.links.length, k.skipped], [['Uploads', 'Resize'], 1, []]);

  // Pulumi stack export: bridged type names, urn names, dependencies; components and the stack itself are not parts.
  const urn = (t: string, n: string) => `urn:pulumi:dev::shop::${t}::${n}`;
  const stack = JSON.stringify({
    version: 3,
    deployment: {
      resources: [
        { urn: urn('pulumi:pulumi:Stack', 'shop-dev'), type: 'pulumi:pulumi:Stack', custom: false },
        { urn: urn('my:app:Api', 'api'), type: 'my:app:Api', custom: false },
        { urn: urn('aws:rds/instance:Instance', 'db'), type: 'aws:rds/instance:Instance', custom: true, inputs: { engine: 'mysql' } },
        { urn: urn('aws:ec2/securityGroup:SecurityGroup', 'sg'), type: 'aws:ec2/securityGroup:SecurityGroup', custom: true },
        { urn: urn('my:app:Api$aws:lb/loadBalancer:LoadBalancer', 'front'), type: 'aws:lb/loadBalancer:LoadBalancer', custom: true },
        { urn: urn('my:app:Api$aws:ecs/service:Service', 'web'), type: 'aws:ecs/service:Service', custom: true, dependencies: [urn('aws:rds/instance:Instance', 'db'), urn('aws:ec2/securityGroup:SecurityGroup', 'sg')] },
        { urn: urn('aws:lb/listener:Listener', 'http'), type: 'aws:lb/listener:Listener', custom: true, dependencies: [urn('my:app:Api$aws:lb/loadBalancer:LoadBalancer', 'front'), urn('my:app:Api$aws:ecs/service:Service', 'web')] },
        { urn: urn('gcp:cloudrun/service:Service', 'jobs'), type: 'gcp:cloudrun/service:Service', custom: true },
      ],
    },
  });
  assert.equal(formatOf(stack), 'Pulumi stack export');
  const p = readInfra(stack);
  assert.deepEqual(p.parts.map((x) => `${x.label}:${x.type}:${x.tech}`), ['db:sql-db:RDS mysql', 'front:load-balancer:ALB/NLB', 'web:service:ECS', 'jobs:service:Cloud Run']);
  assert.deepEqual(p.links.map((l) => `${l.from.split('.')[1]}>${l.to.split('.')[1]}`).sort(), ['front>web', 'web>db']);
  assert.deepEqual(p.skipped, ['aws:ec2/securityGroup:SecurityGroup', 'aws:lb/listener:Listener']);
});

test('pasted files reuse parts by name, and catalogs, specs and stacks keep their structure', async () => {
  const { readInfra } = await import('./infra.ts');
  const { importAsStep } = await import('./importer.ts');
  const { guessType } = await import('../src/shapes.ts');

  // An OpenAPI document lands on the service already drawn: its endpoints fill the empty description, its sign-in provider and webhooks add lines.
  const d = m.blankDesign('reuse', 'Reuse');
  const orders = m.addComponent(d, { type: 'service', label: 'Orders API' });
  const api = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Orders API' },
    paths: { '/orders': { get: {} } },
    components: { securitySchemes: { auth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://login.acme.com/oauth/token' } } } } },
    webhooks: { orderShipped: { post: {} } },
  });
  importAsStep(d, api, { guess: guessType });
  assert.deepEqual(d.components.map((c) => `${c.label}:${c.type}`), ['Orders API:service', 'login.acme.com:identity', 'Orders API webhooks:webhook']);
  assert.equal(d.components.find((c) => c.id === orders)!.description, 'Endpoints: GET /orders');
  assert.match(d.steps.at(-1)!.summary!, /2 parts, 2 lines, 1 description\./);
  assert.throws(() => importAsStep(d, api, { guess: guessType }), /already on the sheet/);

  // Two services' AsyncAPI documents share the channel between them.
  const doc = (title: string, ops: Record<string, unknown>) => JSON.stringify({ asyncapi: '2.6.0', info: { title }, channels: { 'order/placed': ops } });
  importAsStep(d, doc('Checkout', { subscribe: {} }));
  importAsStep(d, doc('Billing', { publish: {} }));
  assert.equal(d.components.filter((c) => c.label === 'order/placed').length, 1);
  const channel = d.components.find((c) => c.label === 'order/placed')!.id;
  assert.equal(d.connections.filter((c) => c.from === channel || c.to === channel).length, 2);

  // Backstage: Systems sit in their Domains, subdomains in theirs; a domain with nothing drawn in it is not drawn.
  const entity = (kind: string, name: string, spec = '{}') => `apiVersion: backstage.io/v1alpha1\nkind: ${kind}\nmetadata: { name: ${name} }\nspec: ${spec}\n`;
  const catalog = [
    entity('Domain', 'commerce'),
    entity('Domain', 'payments', '{ subdomainOf: commerce }'),
    entity('Domain', 'empty'),
    entity('System', 'billing', '{ domain: payments }'),
    entity('Component', 'invoicer', '{ type: service, system: billing }'),
  ].join('---\n');
  const b = readInfra(catalog);
  assert.deepEqual(b.groups.map((g) => `${g.key}:${g.kind}:${g.parent ?? ''}`), ['commerce:context:', 'payments:context:commerce', 'billing:system:payments']);
  const x = m.blankDesign('domains', 'Domains');
  importAsStep(x, catalog);
  assert.deepEqual(x.boundaries.map((g) => `${g.label}:${x.boundaries.find((p) => p.id === g.parent)?.label ?? ''}`), ['commerce:', 'payments:commerce', 'billing:payments']);

  // Pulumi: components box what they hold, nested; azure-native types map; same names get their own parts.
  const urn = (t: string, n: string) => `urn:pulumi:dev::shop::${t}::${n}`;
  const shop = urn('my:app:Shop', 'shop');
  const web = urn('my:app:Shop$my:app:Web', 'web');
  const stack = JSON.stringify({
    deployment: {
      resources: [
        { urn: shop, type: 'my:app:Shop' },
        { urn: web, type: 'my:app:Web', parent: shop },
        { urn: urn('my:app:Shop$aws:s3/bucket:Bucket', 'assets'), type: 'aws:s3/bucket:Bucket', custom: true, parent: shop },
        { urn: urn('my:app:Shop$my:app:Web$aws:s3/bucket:Bucket', 'assets'), type: 'aws:s3/bucket:Bucket', custom: true, parent: web },
        { urn: urn('azure-native:cache:Redis', 'sessions'), type: 'azure-native:cache:Redis', custom: true },
      ],
    },
  });
  const p = readInfra(stack);
  assert.deepEqual(p.parts.map((q) => `${q.label}:${q.type}:${q.group ?? ''}`), ['assets:object-storage:shop', 'assets:object-storage:shop/web', 'sessions:cache:']);
  assert.deepEqual(p.groups.map((g) => `${g.key}:${g.label}:${g.parent ?? ''}`), ['shop:shop:', 'shop/web:web:shop']);
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

test('the command line reports drift and design changes as Markdown for pull requests', async () => {
  const { execFile } = await import('node:child_process');
  const run = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => execFile(process.execPath, args, (e, out) => resolve({ code: e ? Number(e.code) : 0, out })));
  const design = 'examples/shop/design.json';
  const drift = await run('cli/drift.ts', design, 'examples/shop/docker-compose.yml', '--markdown');
  assert.equal(drift.code, 1, 'the example leaves out the cache');
  assert.match(drift.out, /\| \+ part \| `cache` \|/);
  assert.equal((await run('cli/drift.ts', design, 'missing.yml')).code, 2);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-diff-'));
  const before = parseDesign(JSON.parse(await fs.readFile(design, 'utf8')));
  const after = structuredClone(before);
  const step = m.addStep(after, { title: 'Add a cache', summary: 'Ping @team about it.' });
  const cache = m.addComponent(after, { type: 'cache', label: 'cache', step });
  m.connect(after, { from: 'api', to: cache, step });
  m.removeItem(after, 'web');
  await fs.writeFile(path.join(dir, 'before.json'), JSON.stringify(before));
  await fs.writeFile(path.join(dir, 'after.json'), JSON.stringify(after));
  const diff = await run('cli/diff.ts', path.join(dir, 'before.json'), path.join(dir, 'after.json'), '--markdown');
  assert.equal(diff.code, 0);
  assert.match(diff.out, /\*\*New step: `Add a cache`\*\*\nPing @​team about it\./, 'mentions do not ping anyone');
  assert.match(diff.out, /- \+ part `cache \(cache\)`\n- \+ line `api → cache`/);
  assert.match(diff.out, /- − `part web`/);
  assert.match((await run('cli/diff.ts', path.join(dir, 'none.json'), design, '--markdown')).out, /is new/);
});
