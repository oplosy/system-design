import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './test-env.ts';

const store = await import('./store.ts');
const m = await import('./mutations.ts');
const { parseDesign } = await import('./schema.ts');

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

test('decisions go out as decision records and records come back as decisions', async () => {
  const { toAdrs, importAdrsAsStep, saveAdrs, loadAdrs } = await import('./adr.ts');
  const d = m.blankDesign('adr', 'Shop');
  const api = m.addComponent(d, { type: 'service', label: 'Orders API' });
  const db = m.addComponent(d, { type: 'sql-db', label: 'Orders DB' });
  m.addDecision(d, { title: 'Use PostgreSQL for orders', why: 'Orders need transactions.', alternatives: ['DynamoDB'], tradeoffs: 'One more server to run.', links: [db] });

  // Written records are numbered after the folder's own and found again by their marker.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-adr-'));
  await fs.writeFile(path.join(dir, '0007-old-choice.md'), '# 7. Old choice\n\n## Status\n\nAccepted\n\n## Context\n\nLegacy.\n');
  assert.deepEqual(await saveAdrs(d, dir), ['0008-use-postgresql-for-orders.md']);
  const ours = await fs.readFile(path.join(dir, '0008-use-postgresql-for-orders.md'), 'utf8');
  assert.match(ours, /- Affects: Orders DB\n/);
  assert.match(ours, /## Considered options\n\n- Use PostgreSQL for orders \(chosen\)\n- DynamoDB\n/);
  assert.deepEqual(await saveAdrs(d, dir), [], 'nothing changed, nothing written');
  d.decisions[0].why = 'Orders need transactions and joins.';
  assert.deepEqual(toAdrs(d, await loadAdrs(dir)).map((f) => f.name), ['0008-use-postgresql-for-orders.md'], 'an edit rewrites the same file');

  // Reading: Nygard and MADR shapes, our own record skipped, rejected ones left out, parts linked by name.
  await fs.writeFile(
    path.join(dir, '0009-cache.md'),
    '---\nstatus: accepted\n---\n# Cache order lookups\n\n## Context and Problem Statement\n\nThe Orders API is slow.\n\n## Considered Options\n\n* **Redis**\n* Nothing\n\n## Decision Outcome\n\nChosen option: Redis.\n\n### Consequences\n\n* Good: faster\n',
  );
  await fs.writeFile(path.join(dir, '0010-mongo.md'), '# 10. Use MongoDB\n\n## Status\n\nRejected\n\n## Context\n\nTried it.\n');
  await fs.writeFile(path.join(dir, 'README.md'), '# Decisions\n');
  const x = structuredClone(d);
  const r = importAdrsAsStep(x, await loadAdrs(dir));
  assert.deepEqual(r.added, ['Old choice', 'Cache order lookups']);
  assert.deepEqual(r.leftOut, ['0010-mongo.md (rejected)']);
  const cache = x.decisions.find((y) => y.title === 'Cache order lookups')!;
  assert.deepEqual([cache.links, cache.alternatives, cache.tradeoffs], [[api], ['Redis', 'Nothing'], '* Good: faster']);
  assert.equal(cache.why, 'The Orders API is slow.\n\nChosen option: Redis.');
  assert.throws(() => importAdrsAsStep(x, [{ name: 'a.md', text: ours }]), /No decision records the design lacks/);
});

test('a design draws as an SVG for a README, unplaced parts laid out, and a badge says its state', async () => {
  const { designSvg, badgeSvg } = await import('../cli/render.ts');
  const d = m.blankDesign('pic', 'Shop <&>');
  const vpc = m.addBoundary(d, { kind: 'vpc', label: 'Prod' });
  const web = m.addComponent(d, { type: 'service', label: 'Web', tech: 'Node', boundary: vpc, position: { x: 0, y: 0 } });
  const db = m.addComponent(d, { type: 'sql-db', label: 'Orders "DB"', boundary: vpc });
  m.connect(d, { from: web, to: db, label: 'reads', qps: 40, latency: 3 });
  const svg = await designSvg(d);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+" viewBox=/);
  assert.match(svg, /<title>Shop &#60;&#38;&#62;<\/title>/);
  for (const text of ['Prod', 'Web', 'Node', 'Orders &#34;DB&#34;', 'reads', '3 ms · 40/s']) assert.ok(svg.includes(`>${text}</text>`), text);
  assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
  assert.match(badgeSvg('design', 'in sync', '#2f9e44'), /aria-label="design: in sync"/);
});
