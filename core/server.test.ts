import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import './test-env.ts';

const store = await import('./store.ts');
const m = await import('./mutations.ts');

test('every write turns into named events: steps, parts, lines, comments; layout moves are not changes', async () => {
  const { designEvents } = await import('./events.ts');
  const before = m.blankDesign('ev', 'Shop');
  const api = m.addComponent(before, { type: 'service', label: 'API', position: { x: 0, y: 0 } });
  const after = structuredClone(before);
  after.steps[0].seen = true;
  m.addStep(after, { title: 'Add a DB' });
  const db = m.addComponent(after, { type: 'sql-db', label: 'DB' });
  m.connect(after, { from: api, to: db });
  after.components.find((c) => c.id === api)!.tech = 'Go';
  after.components.find((c) => c.id === api)!.position = { x: 50, y: 50 };
  after.title = 'Shop 2';
  const types = designEvents(before, after).map((e) => `${e.type} ${e.subject}`);
  assert.deepEqual(types, ['design.changed ev', `step.approved ev/${before.steps[0].id}`, `step.added ev/${after.steps[1].id}`, `part.changed ev/${api}`, `part.added ev/${db}`, `line.added ev/${after.connections[0].id}`]);
  const changed = designEvents(before, after).find((e) => e.type === 'part.changed')!;
  assert.deepEqual([changed.data.fields, changed.data.before], [['tech'], { tech: undefined }]);
  assert.deepEqual(designEvents(after, after), []);
  assert.equal(designEvents(undefined, after)[0].type, 'design.created');
});

test('webhooks get signed CloudEvents for the events they want, chats get a line, and a dead one never fails a save', async () => {
  const { addHook, listHooks, removeHook, publicHook, testHook, deliveriesSettled, HOOKS_FILE } = await import('./hooks.ts');
  const { createHmac } = await import('node:crypto');
  const http = await import('node:http');
  const got: { url: string; type: string; sig?: string; body: string }[] = [];
  let failures = 2;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      // /flaky fails twice, then works: the retries must get it through.
      if (req.url === '/flaky' && failures-- > 0) return res.writeHead(503).end();
      got.push({ url: req.url!, type: String(req.headers['content-type']), sig: req.headers['x-system-design-signature'] as string | undefined, body });
      // /down refuses for good (4xx is not retried).
      res.writeHead(req.url === '/down' ? 410 : 200).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const errors: string[] = [];
  const log = console.error;
  console.error = (s: string) => errors.push(s);
  try {
    await assert.rejects(addHook({ url: 'file:///etc/passwd' }), /http\(s\)/);
    await assert.rejects(addHook({ url: `${base}/x`, events: ['nonsense'] }), /event type/);
    const signed = await addHook({ url: `${base}/all`, secret: 'a-long-secret', designs: ['hooked'] });
    await addHook({ url: `${base}/steps`, events: ['step.*'], designs: ['hooked'] });
    await addHook({ url: `${base}/chat`, format: 'chat', designs: ['hooked'] });
    await addHook({ url: `${base}/flaky`, events: ['design.created'], designs: ['hooked'] });
    await addHook({ url: `${base}/down`, designs: ['hooked'] });
    assert.equal((publicHook((await listHooks())[0]) as Record<string, unknown>).secret, undefined, 'the API never shows secrets');
    if (process.platform !== 'win32') assert.equal((await fs.stat(HOOKS_FILE)).mode & 0o777, 0o600);

    // The reviewer creates a design in the app: no chat line for their own work.
    const d = await store.createDesign({ id: 'hooked', title: 'Hooked' }, 'app');
    await deliveriesSettled();
    assert.deepEqual(got.map((g) => g.url).sort(), ['/all', '/down', '/flaky', '/steps']);
    const all = got.find((g) => g.url === '/all')!;
    assert.equal(all.type, 'application/cloudevents-batch+json');
    assert.equal(all.sig, `sha256=${createHmac('sha256', 'a-long-secret').update(all.body).digest('hex')}`);
    const batch = JSON.parse(all.body);
    assert.deepEqual(batch.map((e: { type: string }) => e.type), ['system-design.design.created', 'system-design.step.added']);
    assert.equal(batch[0].specversion, '1.0');
    assert.equal(batch[0].actor, 'app');
    assert.equal(batch[0].data.design.id, 'hooked');
    assert.equal(got.find((g) => g.url === '/steps')!.sig, undefined);
    assert.deepEqual(JSON.parse(got.find((g) => g.url === '/steps')!.body).map((e: { type: string }) => e.type), ['system-design.step.added']);
    assert.deepEqual(errors, [`system-design: webhook ${base}/down failed: answered 410`]);

    // An agent adds a step: the chat gets one line with the link.
    got.length = 0;
    await store.updateDesign(d.id, (x) => void m.addStep(x, { title: 'Add a cache' }));
    await deliveriesSettled();
    const chat = JSON.parse(got.find((g) => g.url === '/chat')!.body);
    assert.equal(chat.text, chat.content);
    assert.match(chat.text, /^New step in “Hooked”: Add a cache\. 1 waiting for review: http:\/\/127\.0\.0\.1:5180\/#hooked$/);

    // The older single chat webhook still works, as a chat hook for new steps.
    process.env.SYSTEM_DESIGN_WEBHOOK = `${base}/env`;
    got.length = 0;
    await store.updateDesign(d.id, (x) => void m.addStep(x, { title: 'Add a queue' }));
    await deliveriesSettled();
    assert.match(JSON.parse(got.find((g) => g.url === '/env')!.body).text, /Add a queue/);
    delete process.env.SYSTEM_DESIGN_WEBHOOK;

    assert.deepEqual(await testHook(signed.id), { ok: true, status: 200 });
    assert.equal(JSON.parse(got.at(-1)!.body)[0].type, 'system-design.ping');
    assert.equal(await removeHook(signed.id), true);
    assert.equal(await removeHook(signed.id), false);
  } finally {
    console.error = log;
    server.close();
    await fs.rm(HOOKS_FILE, { force: true });
  }
});

test('live load from Prometheus lands on the lines between the services it names', async () => {
  const { queryPrometheus, liveLines } = await import('./live.ts');
  const http = await import('node:http');
  const d = m.blankDesign('live', 'Shop');
  const web = m.addComponent(d, { type: 'service', label: 'Web' });
  const orders = m.addComponent(d, { type: 'service', label: 'Orders API', source: 'otel:orders' });
  // Named by an otel ref, which wins over a part that only shares the name.
  const pay = m.addComponent(d, { type: 'service', label: 'Billing', refs: [{ kind: 'otel', value: 'payments' }] });
  m.addComponent(d, { type: 'service', label: 'Payments' });
  const toPay = m.connect(d, { from: web, to: pay });
  const line = m.connect(d, { from: web, to: orders });

  const series = (value: string, server = 'orders') => ({ status: 'success', data: { result: [{ metric: { client: 'web', server }, value: [0, value] }] } });
  const server = http.createServer((req, res) => {
    const q = new URL(req.url!, 'http://x').searchParams.get('query') ?? '';
    const body = q.includes('failed') ? series('12') : q.includes('histogram_quantile') ? series('0.05') : { status: 'success', data: { result: [series('120').data.result[0], series('3', 'payments').data.result[0]] } };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const got = liveLines(d, await queryPrometheus(`http://127.0.0.1:${(server.address() as { port: number }).port}/`));
    assert.deepEqual(got.lines[line], { qps: 120, latency: 25, errors: 10 });
    assert.deepEqual(got.unmatched, []);
    assert.deepEqual(got.lines[toPay], { qps: 3 });
  } finally {
    server.close();
  }
  await assert.rejects(queryPrometheus('file:///x'), /http\(s\)/);
});

test('the API refuses other sites and rebound host names, but not tools or this page', async () => {
  const { trusted } = await import('../server/api.ts');
  const req = (method: string, host: string, origin?: string) => ({ method, headers: { host, ...(origin && { origin }) } }) as never;
  assert.equal(trusted(req('GET', '127.0.0.1:5180')), true);
  assert.equal(trusted(req('PUT', '127.0.0.1:5180')), true, 'curl, the CLI: no Origin');
  assert.equal(trusted(req('PUT', 'localhost:5180', 'http://localhost:5180')), true);
  assert.notEqual(trusted(req('POST', '127.0.0.1:5180', 'https://evil.example')), true);
  assert.notEqual(trusted(req('POST', '127.0.0.1:5180', 'null')), true, 'sandboxed frames and file pages');
  assert.notEqual(trusted(req('GET', 'evil.example:5180')), true, 'DNS rebinding');
  assert.equal(trusted(req('GET', 'devbox:5180'), 'devbox'), true);
  assert.equal(trusted(req('GET', '192.168.1.5:5180'), '0.0.0.0'), true);
  assert.match(String(trusted(req('GET', '192.168.1.5:5180'))), /HOST=192\.168\.1\.5/);
});

test('the versioned API publishes its OpenAPI document and design schema, and manages webhooks without showing secrets', async () => {
  const { createApi } = await import('../server/api.ts');
  const { HOOKS_FILE } = await import('./hooks.ts');
  const http = await import('node:http');
  const api = createApi();
  const server = http.createServer((req, res) => {
    req.url = req.url!.replace(/^\/api/, '') || '/';
    void api.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    const doc = (await call('GET', '/v1/openapi.json')).json;
    assert.equal(doc.openapi, '3.1.0');
    assert.ok(doc.paths['/designs/{id}'].put && doc.paths['/hooks'].post && doc.webhooks.designEvents);
    assert.ok(doc.components.schemas.Design.properties.components.items.properties.refs, 'refs are part of the contract');
    const schema = (await call('GET', '/v1/schema/design.json')).json;
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.deepEqual(schema.required.slice(0, 3), ['id', 'version', 'title']);

    // The same API answers under /api and /api/v1.
    assert.deepEqual((await call('GET', '/v1/hooks')).json, (await call('GET', '/hooks')).json);
    const bad = await call('POST', '/v1/hooks', { url: 'ftp://x' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /http\(s\) address/);
    assert.equal((await call('POST', '/v1/hooks', { url: 'https://example.com/h' }, { Origin: 'https://evil.example' })).status, 403);
    const made = await call('POST', '/v1/hooks', { url: 'https://example.com/h', secret: 'a-long-secret', events: ['step.*'] });
    assert.equal(made.status, 201);
    assert.deepEqual([made.json.signed, made.json.secret, made.json.events], [true, undefined, ['step.*']]);
    assert.equal((await call('GET', '/v1/hooks')).json[0].secret, undefined);
    assert.equal((await call('DELETE', `/v1/hooks/${made.json.id}`)).status, 200);
    assert.equal((await call('POST', `/v1/hooks/${made.json.id}/test`)).status, 404);
  } finally {
    server.close();
    api.close();
    await fs.rm(HOOKS_FILE, { force: true });
  }
});

test('a hub behind a proxy takes writes from its own public address only', async () => {
  const { trusted } = await import('../server/api.ts');
  const req = (host: string, origin?: string) => ({ method: 'PUT', headers: { host, origin } }) as never;
  assert.equal(trusted(req('hub.example', 'https://hub.example'), '0.0.0.0'), true);
  assert.equal(typeof trusted(req('hub.example', 'https://evil.example'), '0.0.0.0'), 'string');
});

test('two people on a hub: the later save merges instead of losing the first', async () => {
  const { mergeDesigns } = await import('./merge.ts');
  await store.createDesign({ id: 'together', title: 'Together' });
  const base = await store.readDesign('together');
  const ann = structuredClone(base), bo = structuredClone(base);
  m.addComment(ann, { step: 'start', text: 'From Ann', by: 'reviewer', author: 'Ann' });
  m.addComponent(bo, { type: 'cache', label: 'Cache' });
  await store.writeDesign(ann);
  await assert.rejects(store.writeDesign(bo), store.ConflictError);
  const merged = mergeDesigns(base, bo, await store.readDesign('together'))!;
  assert.deepEqual(merged.clashes, []);
  const saved = await store.writeDesign(merged.merged);
  assert.deepEqual([saved.comments[0].author, saved.components[0].id], ['Ann', 'cache']);
});

test('Slack buttons review a step, and only with Slack\'s signature', async () => {
  const crypto = await import('node:crypto');
  const http = await import('node:http');
  const { hookBody } = await import('./hooks.ts');
  const { designEvents } = await import('./events.ts');
  const { createApi } = await import('../server/api.ts');
  const slack = await import('./slack.ts');

  await store.createDesign({ id: 'chatty', title: 'Chatty <b>' });
  const before = await store.readDesign('chatty');
  const after = await store.updateDesign('chatty', (d) => void m.addStep(d, { title: 'Add a <cache>' }));
  const step = after.steps.at(-1)!.id;
  const hook = { id: 'h', url: 'https://hooks.slack.com/x', format: 'slack' as const };
  const events = designEvents(before, after);
  const body = JSON.parse(hookBody(hook, after, events, 'agent')!.body);
  assert.ok(JSON.stringify(body.blocks).includes('Add a &lt;cache&gt;'));
  assert.equal(body.blocks.at(-1).elements[1].value, `chatty/${step}`);
  assert.equal(hookBody(hook, after, events, 'app'), undefined);

  assert.equal(slack.slackClick('payload=%7B%7D'), undefined);
  assert.equal(slack.slackClick(`payload=${encodeURIComponent(JSON.stringify({ actions: [{ action_id: 'delete', value: 'a/b' }] }))}`), undefined);

  const secret = 'slack-test-secret';
  const sign = (raw: string, ts: number, key = secret) => `v0=${crypto.createHmac('sha256', key).update(`v0:${ts}:${raw}`).digest('hex')}`;
  const api = createApi();
  const server = http.createServer((req, res) => {
    req.url = req.url!.replace(/^\/api/, '');
    void api.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/slack/actions`;
  const click = (id: string) => `payload=${encodeURIComponent(JSON.stringify({ actions: [{ action_id: id, value: `chatty/${step}` }], user: { name: 'ann' } }))}`;
  const post = (raw: string, ts = Math.floor(Date.now() / 1000), signature = sign(raw, ts)) => fetch(url, { method: 'POST', body: raw, headers: { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': signature } });
  try {
    delete process.env.SYSTEM_DESIGN_SLACK_SECRET;
    assert.equal((await post(click('approve'))).status, 404);
    process.env.SYSTEM_DESIGN_SLACK_SECRET = secret;
    assert.equal((await post(click('approve'), undefined, 'v0=bad')).status, 401);
    assert.equal((await post(click('approve'), undefined, sign(click('approve'), Math.floor(Date.now() / 1000), 'other'))).status, 401);
    assert.equal((await post(click('approve'), Math.floor(Date.now() / 1000) - 3600)).status, 401);
    assert.equal((await store.readDesign('chatty')).steps.at(-1)!.seen, false);

    assert.equal((await post(click('send_back'))).status, 200);
    const sent = (await store.readDesign('chatty')).steps.at(-1)!;
    assert.equal(sent.changesRequested, true);
    assert.match((await store.readDesign('chatty')).comments[0].text, /by ann/);

    assert.equal((await post(click('approve'))).status, 200);
    const done = (await store.readDesign('chatty')).steps.at(-1)!;
    assert.deepEqual([done.seen, done.changesRequested], [true, undefined]);
  } finally {
    delete process.env.SYSTEM_DESIGN_SLACK_SECRET;
    server.close();
    api.close();
  }
});

test('hub mode: sign-in, the allow list, and what stays out of reach', async () => {
  const http = await import('node:http');
  const { createHub, hubConfig } = await import('../server/auth.ts');
  assert.equal(hubConfig({}), undefined);
  assert.throws(() => hubConfig({ SYSTEM_DESIGN_OIDC_ISSUER: 'https://id.example' }), /SYSTEM_DESIGN_ALLOWED/);
  const env = { SYSTEM_DESIGN_OIDC_CLIENT_ID: 'app', SYSTEM_DESIGN_OIDC_CLIENT_SECRET: 's', SYSTEM_DESIGN_ALLOWED: 'Boss@Other.example, @team.example', SYSTEM_DESIGN_URL: 'https://hub.example/' };
  assert.throws(() => hubConfig({ ...env, SYSTEM_DESIGN_OIDC_ISSUER: 'http://id.example' }), /must be https/);
  assert.throws(() => hubConfig({ ...env, SYSTEM_DESIGN_OIDC_ISSUER: 'https://id.example', SYSTEM_DESIGN_SESSION_SECRET: 'short' }), /32 characters/);

  // A provider that signs in whoever `claims` says.
  const crypto = await import('node:crypto');
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const part = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const idToken = (c: unknown, header: object = { alg: 'RS256', kid: 'k1' }, key = pair.privateKey) => {
    const body = `${part(header)}.${part(c)}`;
    return `${body}.${crypto.sign('sha256', Buffer.from(body), key).toString('base64url')}`;
  };
  let claims: Record<string, unknown> = {};
  let token = (c: unknown) => idToken(c);
  let tokenBody = '';
  const idp = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url!.startsWith('/.well-known')) return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1' }] }));
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      tokenBody = body;
      res.end(JSON.stringify({ id_token: token(claims) }));
    });
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  const issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;
  const gate = createHub(hubConfig({ ...env, SYSTEM_DESIGN_OIDC_ISSUER: issuer, SYSTEM_DESIGN_URL: 'http://127.0.0.1', SYSTEM_DESIGN_EDITORS: 'ann@team.example, @other.example' })!);
  const app = http.createServer(async (req, res) => {
    if (!(await gate(req, res))) res.end('app');
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const get = (p: string, cookie = '') => fetch(base + p, { redirect: 'manual', headers: { cookie } });
  const jar = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  async function signIn(who: Record<string, unknown>, change: (u: URL) => void = () => undefined, login = '/auth/login') {
    const start = await get(login);
    const to = new URL(start.headers.get('location')!);
    assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
    claims = { iss: issuer, aud: 'app', exp: Date.now() / 1000 + 60, nonce: to.searchParams.get('nonce'), ...who };
    const back = new URL(`${base}/auth/callback?code=c&state=${to.searchParams.get('state')}`);
    change(back);
    return get(back.pathname + back.search, jar(start));
  }

  try {
    assert.equal((await get('/api/designs')).status, 401);
    assert.equal((await get('/api/v1/designs')).status, 401);
    assert.match(await (await get('/')).text(), /auth\/login\?next=/);

    const ok = await signIn({ email: 'ann@team.example', name: 'Ann' });
    assert.equal(ok.status, 302);
    assert.match(tokenBody, /code_verifier=/);
    const session = jar(ok).split('; ').find((c) => c.startsWith('sd_session=') && c.length > 12)!;
    assert.match(ok.headers.getSetCookie().join(), /HttpOnly; SameSite=Lax/);
    assert.deepEqual(await (await get('/api/v1/me', session)).json(), { email: 'ann@team.example', name: 'Ann', canEdit: true });
    assert.equal(ok.headers.get('location'), '/');
    assert.equal(await (await get('/api/designs', session)).text(), 'app');
    for (const p of ['/api/hooks', '/api/v1/hooks/x/test', '/api/v1/mcp', '/api/mcp/run']) assert.equal((await get(p, session)).status, 403, p);
    assert.equal((await get('/api/designs', `${session}x`)).status, 401);
    assert.equal((await get('/api/designs', `sd_session=e30.${session.split('.')[1]}`)).status, 401);
    assert.equal((await get('/auth/logout', session)).headers.getSetCookie()[0].includes('Max-Age=0'), true);

    assert.equal((await signIn({ email: 'BOSS@other.example' })).status, 302);
    assert.equal((await signIn({ email: 'eve@evil.example' })).status, 403);
    assert.equal((await signIn({ email: 'x@team.example.evil.example' })).status, 403);
    assert.equal((await signIn({ email: 'ann@team.example', email_verified: false })).status, 403);
    assert.equal((await signIn({})).status, 403);
    assert.equal((await signIn({ email: 'ann@team.example', nonce: 'other' })).status, 400);
    assert.equal((await signIn({ email: 'ann@team.example', aud: 'other' })).status, 400);
    assert.equal((await signIn({ email: 'ann@team.example', iss: 'https://other' })).status, 400);
    assert.equal((await signIn({ email: 'ann@team.example', exp: 1 })).status, 400);
    assert.equal((await signIn({ email: 'ann@team.example' }, (u) => u.searchParams.set('state', 'forged'))).status, 400);
    assert.equal((await get('/auth/callback?code=c&state=s')).status, 400);

    // Deep links survive sign-in; anything else in `next` is dropped.
    const next = (hash: string) => signIn({ email: 'ann@team.example' }, undefined, `/auth/login?next=${encodeURIComponent(hash)}`);
    assert.equal((await next('#shop/api')).headers.get('location'), '/#shop/api');
    assert.equal((await next('https://evil.example')).headers.get('location'), '/');
    assert.equal((await next('#//evil.example?x')).headers.get('location'), '/');

    // Forged tokens.
    const refused = async (t: typeof token) => {
      token = t;
      const r = await signIn({ email: 'ann@team.example' });
      token = (c) => idToken(c);
      return r.status;
    };
    assert.equal(await refused((c) => idToken(c, undefined, other.privateKey)), 400);
    assert.equal(await refused((c) => `${part({ alg: 'none' })}.${part(c)}.`), 400);
    assert.equal(await refused((c) => idToken(c, { alg: 'HS256', kid: 'k1' })), 400);
    assert.equal(await refused(() => 'garbage'), 400);

    // A viewer reads and can't write; plugin lookups still work.
    const seen = await signIn({ email: 'vic@team.example' });
    const viewer = jar(seen).split('; ').find((c) => c.startsWith('sd_session=') && c.length > 12)!;
    assert.equal((await (await get('/api/v1/me', viewer)).json()).canEdit, false);
    assert.equal(await (await get('/api/designs', viewer)).text(), 'app');
    const send = (p: string, method: string, cookie: string) => fetch(base + p, { method, headers: { cookie } });
    assert.equal((await send('/api/designs/a', 'PUT', viewer)).status, 403);
    assert.equal((await send('/api/designs', 'POST', viewer)).status, 403);
    assert.equal(await (await send('/api/v1/designs/a/comments', 'POST', viewer)).text(), 'app');
    assert.equal((await send('/api/v1/designs/a/b/comments', 'POST', viewer)).status, 403);
    assert.equal((await send('/api/designs/a', 'DELETE', viewer)).status, 403);
    assert.equal(await (await send('/api/v1/plugins/links', 'POST', viewer)).text(), 'app');
    assert.equal(await (await send('/api/designs/a', 'PUT', session)).text(), 'app');
    // Slack signs its own requests, so it passes without a session.
    assert.equal(await (await fetch(`${base}/api/v1/slack/actions`, { method: 'POST' })).text(), 'app');
  } finally {
    app.close();
    idp.close();
  }
});

test('on a hub the server decides who wrote a comment', async () => {
  const http = await import('node:http');
  const { createApi } = await import('../server/api.ts');
  const { createHub } = await import('../server/auth.ts');
  const saved = [{ id: 'c1', step: 'start', text: 'old', by: 'reviewer' as const, author: 'Ann', at: 'x' }];
  const incoming = [{ ...saved[0], author: 'Forged' }, { ...saved[0], id: 'c2', author: 'Forged' }];
  m.keepAuthors(incoming, saved, 'Bo');
  assert.deepEqual(incoming.map((c) => c.author), ['Ann', 'Bo']);

  // Two servers with one secret accept each other's sessions.
  const config = { issuer: 'https://id.example', clientId: 'a', clientSecret: 's', url: 'http://127.0.0.1', allowed: ['@x.example'], sessionSecret: 'x'.repeat(32) };
  const crypto = await import('node:crypto');
  const body = Buffer.from(JSON.stringify({ email: 'bo@x.example', name: 'Bo', canEdit: true, exp: Date.now() + 60000 })).toString('base64url');
  const session = `sd_session=${body}.${crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url')}`;
  const gate = createHub(config);

  const api = createApi();
  const server = http.createServer(async (req, res) => {
    if (await gate(req, res)) return;
    req.url = req.url!.replace(/^\/api/, '');
    void api.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const headers = { cookie: session, 'Content-Type': 'application/json' };
  try {
    await store.createDesign({ id: 'authors', title: 'Authors' });
    const posted = await fetch(`${base}/designs/authors/comments`, { method: 'POST', headers, body: JSON.stringify({ text: 'From the viewer route', step: 'start', author: 'Forged' }) });
    assert.equal(posted.status, 201);
    assert.equal(await (await fetch(`${base}/designs/authors/comments`, { method: 'POST', headers, body: JSON.stringify({ text: '' }) })).status, 400);
    const d = await store.readDesign('authors');
    assert.equal(d.comments[0].author, 'Bo');
    m.addComment(d, { step: 'start', text: 'Saved', by: 'reviewer', author: 'Forged' });
    d.comments[0].author = 'Forged';
    assert.equal((await fetch(`${base}/designs/authors`, { method: 'PUT', headers, body: JSON.stringify(d) })).status, 200);
    assert.deepEqual((await store.readDesign('authors')).comments.map((c) => c.author), ['Bo', 'Bo']);
  } finally {
    server.close();
    api.close();
  }
});
