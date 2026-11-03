import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import '../core/test-env.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// The server runs as agents run it: its own process, spoken to over stdio, with this test's data folder.
const client = new Client({ name: 'test', version: '0' });
before(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, 'server.ts')], env, stderr: 'ignore' }));
});
after(() => client.close());

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  assert.ok(!r.isError, `${name} failed: ${r.content[0]?.text}`);
  return r.content[0].text;
};
const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await call(name, args));
/** A call the server must refuse, whether the SDK rejects it or the tool reports the error. */
const refused = async (name: string, args: Record<string, unknown>, message: RegExp) => {
  let text: string;
  try {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    assert.ok(r.isError, `${name} should have failed`);
    text = r.content[0].text;
  } catch (e) {
    text = (e as Error).message;
  }
  assert.match(text, message);
};

test('every tool is described and takes an object, and the instructions tell agents to work in steps', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ['list_designs', 'create_design', 'add_step', 'pick_option', 'lint', 'export_design', 'simulate_failure', 'get_feedback', 'resolve_feedback', 'sync_infra', 'import_diagram'])
    assert.ok(names.includes(name), `missing ${name}`);
  for (const t of tools) {
    assert.ok(t.description, `${t.name} has no description`);
    assert.equal(t.inputSchema.type, 'object');
  }
  assert.match(client.getInstructions() ?? '', /add_step is one reviewable change/);
});

test('one add_step stores its parts, lines, decision and flow, and maps the call ids to stored ones', async () => {
  await json('create_design', { id: 'shop', title: 'Shop' });
  const r = await json('add_step', {
    design: 'shop',
    title: 'Add the order path',
    components: [
      { id: 'u', type: 'user', label: 'Shopper' },
      { id: 'api', type: 'service', label: 'Orders API', capacity: 100 },
      { id: 'db', type: 'sql-db', label: 'Orders DB', tech: 'PostgreSQL' },
    ],
    connections: [
      { from: 'u', to: 'api', qps: 150, latency: 20 },
      { from: 'api', to: 'db', latency: 5 },
    ],
    decisions: [{ title: 'Use PostgreSQL', why: 'orders are relational', links: ['db'] }],
    flows: [{ title: 'Shopper places an order', path: ['u', 'api', 'db'] }],
  });
  assert.equal(r.unseenSteps, 1, 'the new step waits for review');
  const d = await json('get_design', { id: 'shop' });
  const step = d.steps.find((s: { id: string }) => s.id === r.result.step);
  assert.equal(step.title, 'Add the order path');
  assert.deepEqual(d.components.map((c: { label: string }) => c.label), ['Shopper', 'Orders API', 'Orders DB']);
  assert.ok(d.components.every((c: { step: string }) => c.step === step.id));
  assert.deepEqual(d.flows[0].path, [r.result.ids.u, r.result.ids.api, r.result.ids.db]);
  assert.deepEqual(d.decisions[0].links, [r.result.ids.db]);

  const listed = await json('list_designs');
  assert.ok(listed.some((x: { id: string }) => x.id === 'shop'));
});

test('lint, failure simulation and export read the stored design', async () => {
  const d = await json('get_design', { id: 'shop' });
  const id = (label: string) => d.components.find((c: { label: string }) => c.label === label).id;
  const findings = await json('lint', { id: 'shop' });
  assert.ok(findings.some((f: { id: string; rule: string }) => f.id === id('Orders API') && f.rule === 'over-capacity'), 'qps over capacity is flagged');
  const impact = JSON.stringify(await json('simulate_failure', { design: 'shop', id: id('Orders DB') }));
  assert.match(impact, /Shopper places an order/);
  assert.match(await call('export_design', { id: 'shop', format: 'mermaid' }), /Orders API/);
  assert.match(await call('export_design', { id: 'shop', format: 'decisions' }), /Use PostgreSQL/);
});

test('updates and removals are recorded on the step for review', async () => {
  const d = await json('get_design', { id: 'shop' });
  const api = d.components.find((c: { label: string }) => c.label === 'Orders API').id;
  const { result: step } = await json('add_step', { design: 'shop', title: 'Rename and trim' });
  await json('update_component', { design: 'shop', id: api, label: 'Checkout API' });
  const note = (await json('add_note', { design: 'shop', text: 'temporary', attach_to: api })).result;
  await json('remove_item', { design: 'shop', id: note });
  const after = await json('get_design', { id: 'shop' });
  assert.equal(after.components.find((c: { id: string }) => c.id === api).label, 'Checkout API');
  assert.ok(!after.notes.some((n: { id: string }) => n.id === note));
  const latest = after.steps.find((s: { id: string }) => s.id === step.step);
  assert.ok(JSON.stringify(latest).includes('Orders API'), 'the old label is kept on the step');
});

test('options let the reviewer choose; pick_option keeps one and records why', async () => {
  const r = await json('add_step', {
    design: 'shop',
    title: 'Cache reads',
    options: [
      { title: 'Redis', summary: 'shared across instances', components: [{ id: 'c', type: 'cache', label: 'Redis' }] },
      { title: 'In-process', summary: 'no new part to run', components: [{ id: 'c', type: 'cache', label: 'Local cache' }] },
    ],
  });
  assert.equal(r.result.options.length, 2);
  await json('pick_option', { design: 'shop', step: r.result.step, option: r.result.options[0].option });
  const d = await json('get_design', { id: 'shop' });
  const labels = d.components.map((c: { label: string }) => c.label);
  assert.ok(labels.includes('Redis') && !labels.includes('Local cache'));
  assert.ok(d.decisions.some((x: { why: string }) => x.why === 'shared across instances'));
});

test('bad input is refused with a message the agent can act on, and nothing is written', async () => {
  const rev = (await json('get_design', { id: 'shop' })).rev;
  await refused('add_component', { design: 'shop', type: 'not-a-type', label: 'X' }, /type|enum|invalid/i);
  await refused('add_component', { design: 'shop', type: 'service', label: '' }, /label|too_small|least/i);
  await refused('update_component', { design: 'shop', id: 'nope', label: 'X' }, /unknown component "nope"/);
  await refused('simulate_failure', { design: 'shop', id: 'nope' }, /unknown component "nope"/);
  await refused('resolve_feedback', { design: 'shop' }, /Pass comments or step/);
  await refused('add_step', { design: 'shop', title: 'Bad flow', components: [{ id: 'a', type: 'service', label: 'A' }, { id: 'b', type: 'service', label: 'B' }], flows: [{ title: 'Nowhere', path: ['a', 'b'] }] }, /connection|follow/i);
  await refused('get_design', { id: 'missing' }, /missing|not found|ENOENT/i);
  assert.equal((await json('get_design', { id: 'shop' })).rev, rev, 'a refused call leaves the design as it was');
});
