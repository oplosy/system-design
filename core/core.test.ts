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
  assert.throws(() => parseMermaid('sequenceDiagram\n  A->>B: hi'), /only Mermaid flowcharts/);
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
