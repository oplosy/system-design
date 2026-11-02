import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './test-env.ts';

const store = await import('./store.ts');
const m = await import('./mutations.ts');

test('plugins add formats, metrics and links, and a bad one is reported without stopping the rest', async () => {
  const plugins = await import('./plugins.ts');
  const { importAsStep } = await import('./importer.ts');
  const { liveLines } = await import('./live.ts');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-plugins-'));
  await fs.writeFile(path.join(dir, 'a-good.mjs'), `export default { name: 'good' };`);
  await fs.writeFile(path.join(dir, 'b-bad.mjs'), `export default { name: 'Not An Id' };`);
  await fs.writeFile(path.join(dir, 'c-crash.mjs'), `throw new Error('boom');`);
  await fs.writeFile(path.join(dir, 'd-twin.mjs'), `export default { name: 'good' };`);
  await fs.writeFile(path.join(dir, 'notes.txt'), 'not code');
  const { plugins: ok, failed } = await plugins.loadPlugins(dir);
  assert.deepEqual(ok.map((p) => p.name), ['good']);
  assert.deepEqual(failed.map((f) => f.file), ['b-bad.mjs', 'c-crash.mjs', 'd-twin.mjs']);
  assert.deepEqual(await plugins.loadPlugins(path.join(dir, 'missing')), { plugins: [], failed: [] });

  const listed = await plugins.pluginList();
  assert.equal(listed.plugins[0].exporters[0].key, 'service-list.csv');

  const text = '# services\nweb -> api\napi -> db\n';
  const read = await plugins.readWithPlugins(text);
  assert.equal(read?.format, 'service list');
  assert.equal(await plugins.readWithPlugins('nothing known'), undefined);
  const d = m.blankDesign('plugged', 'Plugged');
  const step = importAsStep(d, text, { plugin: read });
  assert.deepEqual(d.components.map((c) => c.id), ['web', 'api', 'db']);
  assert.equal(d.connections.length, 2);
  assert.match(d.steps.find((s) => s.id === step)!.summary!, /service list: 3 parts, 2 lines/);

  const out = await plugins.exportWithPlugin('service-list.csv', d);
  assert.equal(out?.extension, 'csv');
  assert.match(out!.text, /^id,type,label\nweb,/);
  assert.equal(await plugins.exportWithPlugin('nope.csv', d), undefined);

  const [metric] = await plugins.pluginMetrics();
  assert.deepEqual(liveLines(d, await metric.read(d)).lines[d.connections[0].id], { qps: 12, latency: 25 });

  assert.deepEqual(await plugins.pluginLinks([{ kind: 'ticket', value: 'OPS-12' }, { kind: 'ticket', value: 'not one' }, { kind: 'docs', value: 'OPS-12' }]), { 'ticket:OPS-12': 'https://tickets.example.com/browse/OPS-12' });
});

test('a plugin diagram must hang together', async () => {
  const { PluginDiagram } = await import('./diagram.ts');
  assert.equal(PluginDiagram.safeParse({ nodes: [{ key: 'a' }], edges: [{ from: 'a', to: 'ghost' }] }).success, false);
  assert.equal(PluginDiagram.safeParse({ nodes: [{ key: 'a', group: 'g' }] }).success, false);
  assert.equal(PluginDiagram.safeParse({ nodes: [{ key: 'a' }], groups: [{ key: 'c', label: 'C', parent: 'p' }, { key: 'p', label: 'P' }] }).success, false);
  assert.equal(PluginDiagram.safeParse({ nodes: [] }).success, false);
  assert.equal(PluginDiagram.safeParse({ nodes: [{ key: 'a', group: 'g' }], groups: [{ key: 'g', label: 'G' }] }).success, true);
});

test('the API serves plugins but can never add one', async () => {
  const http = await import('node:http');
  const { createApi } = await import('../server/api.ts');
  const api = createApi();
  const server = http.createServer((req, res) => {
    req.url = req.url!.replace(/^\/api/, '');
    void api.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  try {
    await store.createDesign({ id: 'plug-api', title: 'Plug' });
    const info = await (await fetch(`${base}/plugins`)).json();
    assert.equal(info.plugins[0].name, 'service-list');
    assert.equal((await fetch(`${base}/plugins`, { method: 'POST', body: '{}' })).status, 404);
    const read = await fetch(`${base}/plugins/read`, { method: 'POST', body: JSON.stringify({ text: '# services\na -> b' }) });
    assert.equal((await read.json()).format, 'service list');
    assert.equal((await fetch(`${base}/plugins/read`, { method: 'POST', body: JSON.stringify({ text: 1 }) })).status, 400);
    const file = await fetch(`${base}/designs/plug-api/export/service-list.csv`);
    assert.match(file.headers.get('content-disposition')!, /plug-api\.csv/);
    assert.equal((await fetch(`${base}/designs/plug-api/export/nope.csv`)).status, 404);
    const links = await fetch(`${base}/plugins/links`, { method: 'POST', body: JSON.stringify([{ kind: 'ticket', value: 'OPS-1' }]) });
    assert.deepEqual(await links.json(), { 'ticket:OPS-1': 'https://tickets.example.com/browse/OPS-1' });
    assert.equal((await fetch(`${base}/plugins/links`, { method: 'POST', body: JSON.stringify([{ kind: 'nope', value: 'x' }]) })).status, 400);
    assert.deepEqual((await (await fetch(`${base}/designs/plug-api/live`)).json()).unmatched, ['web → api']);
  } finally {
    server.close();
    api.close();
  }
});

test('MCP query args are filled from the part, and a part without what they need gets no query', async () => {
  const { fillArgs, expand, readConfig } = await import('./mcp-client.ts');
  const part = { id: 'api', label: 'API', tags: ['payments'], refs: [{ kind: 'repo' as const, value: 'org/api' }] };
  assert.deepEqual(fillArgs({ q: 'repo:{repo} {tag}', deep: [{ n: '{label}' }], plain: 3, other: '{nope}' }, part), { q: 'repo:org/api payments', deep: [{ n: 'API' }], plain: 3, other: '{nope}' });
  assert.equal(fillArgs({ q: '{otel}' }, part), undefined);
  process.env.SD_TEST_TOKEN = 'abc';
  assert.equal(expand('Bearer ${SD_TEST_TOKEN}'), 'Bearer abc');
  assert.throws(() => expand('${SD_TEST_MISSING}'), /SD_TEST_MISSING is not set/);

  const bad = path.join(process.env.SYSTEM_DESIGN_DIR!, '..', `sd-mcp-bad-${process.pid}.json`);
  await fs.writeFile(bad, JSON.stringify({ mcpServers: { x: { command: 'a', url: 'https://b' } } }));
  assert.match((await readConfig(bad)).error!, /either command or url/);
  assert.deepEqual(await readConfig(`${bad}.missing`), { servers: {} });
});

test('the MCP client calls read-only tools over stdio and HTTP, refuses others and hides its config', async () => {
  const http = await import('node:http');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { ticketsServer } = await import(new URL('../examples/mcp/tickets-server.mjs', import.meta.url).href);
  const script = path.join(import.meta.dirname, '..', 'examples', 'mcp', 'tickets-server.mjs');

  let auth: string | undefined;
  const remote = http.createServer(async (req, res) => {
    auth = req.headers.authorization;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await ticketsServer().connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => remote.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(remote.address() as { port: number }).port}/mcp`;
  process.env.SD_TEST_TOKEN = 'abc';
  const queries = [
    { title: 'Tickets', tool: 'list_tickets', args: { service: '{label}' } },
    { title: 'Close', tool: 'close_ticket', args: { id: '{label}' } },
    { title: 'By trace', tool: 'list_tickets', args: { service: '{otel}' } },
  ];
  await fs.writeFile(
    process.env.SYSTEM_DESIGN_MCP!,
    JSON.stringify({
      mcpServers: {
        local: { command: process.execPath, args: [script, 'stdio'], queries },
        remote: { url, headers: { Authorization: 'Bearer ${SD_TEST_TOKEN}' }, queries: queries.slice(0, 1) },
        allowed: { command: process.execPath, args: [script, 'stdio'], allow: ['close_ticket'], queries: queries.slice(1, 2) },
      },
    }),
  );
  const mcp = await import('./mcp-client.ts');
  const part = { id: 'api', label: 'API' };
  try {
    const list = await mcp.mcpList();
    assert.deepEqual(list.servers.map((s) => s.kind), ['stdio', 'http', 'stdio']);
    assert.ok(!JSON.stringify(list).includes(script) && !JSON.stringify(list).includes('Bearer'));
    assert.deepEqual((await mcp.mcpQueries(part)).map((q) => q.title), ['Tickets', 'Close', 'Tickets', 'Close']);

    assert.deepEqual(await mcp.testMcp('local'), { ok: true, tools: 2, readOnly: 1 });
    assert.equal((await mcp.runMcp('local', 'Tickets', part)).text, 'OPS-1: API is slow');
    await assert.rejects(mcp.runMcp('local', 'Close', part), /doesn't declare itself read-only/);
    await assert.rejects(mcp.runMcp('local', 'By trace', part), /lacks what/);
    await assert.rejects(mcp.runMcp('ghost', 'Tickets', part), /no MCP server/);
    assert.equal((await mcp.runMcp('allowed', 'Close', part)).text, 'closed API');

    assert.equal((await mcp.runMcp('remote', 'Tickets', part)).text, 'OPS-1: API is slow');
    assert.equal(auth, 'Bearer abc');
  } finally {
    await mcp.closeMcp();
    remote.close();
  }
});

test('a plugin that hangs is given up on, and a failing load source leaves the others', async () => {
  const { within } = await import('./plugins.ts');
  const { readLoad } = await import('./live.ts');
  assert.equal(await within(Promise.resolve(1), 50), 1);
  await assert.rejects(within(new Promise(() => undefined), 20), /no answer/);

  const d = m.blankDesign('load', 'Load');
  const a = m.addComponent(d, { type: 'service', label: 'A' }), b = m.addComponent(d, { type: 'service', label: 'B' });
  const line = m.connect(d, { from: a, to: b });
  const good = { name: 'good', read: async () => ({ qps: [{ client: 'a', server: 'b', value: 2 }], failed: [], latency: [] }) };
  const bad = { name: 'bad', read: async () => Promise.reject(new Error('down')) };
  const out = await readLoad(d, [bad, good]);
  assert.deepEqual(out.lines[line], { qps: 2 });
  assert.deepEqual(out.failed, ['bad: down']);
  await assert.rejects(readLoad(d, [bad]), /bad: down/);
});

test('a plugin logging to stdout does not corrupt the MCP protocol', async () => {
  const { spawn } = await import('node:child_process');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-noisy-'));
  await fs.writeFile(path.join(dir, 'noisy.mjs'), `console.log('noise'); export default { name: 'noisy', importers: [{ id: 'n', name: 'n', matches: () => { console.log('more'); return false; }, read: () => ({}) }] };`);
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'mcp', 'server.ts')], { env: { ...process.env, SYSTEM_DESIGN_PLUGINS: dir } });
  const first = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes('\n')) resolve(out.split('\n')[0]);
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`);
  });
  child.kill();
  assert.equal(JSON.parse(first).id, 1);
});
