import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { userAppDir } from './paths.ts';
import { REF_KINDS, RefSchema, ValidationError } from './schema.ts';

// The app as an MCP client: the servers the user already runs (GitHub, Jira, Datadog...) answer questions about a part
// in its panel. mcp-servers.json uses the usual `mcpServers` shape plus `queries`. A server entry can run a command, so
// the file sits in the user's own folder and nothing a design or the API holds can change it. Tools are called only
// when they declare themselves read-only, or the user names them in `allow`.

export const MCP_FILE = process.env.SYSTEM_DESIGN_MCP ?? path.join(userAppDir(), 'mcp-servers.json');

const TIMEOUT = 15000;
const MAX_RESULT = 20000;

const Query = z.object({
  title: z.string().min(1),
  tool: z.string().min(1),
  /** Strings may hold {label}, {id}, {tech}, {tag} or a ref kind ({repo}, {otel}...), filled from the part. */
  args: z.record(z.string(), z.unknown()).default({}),
});
const Server = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().regex(/^https?:\/\/\S+$/i, 'an http(s) address').optional(),
    headers: z.record(z.string(), z.string()).optional(),
    /** Tools to call although they don't declare themselves read-only. */
    allow: z.array(z.string()).optional(),
    queries: z.array(Query).default([]),
  })
  .refine((s) => !s.command !== !s.url, 'give either command or url');
type Server = z.infer<typeof Server>;
const Config = z.object({ mcpServers: z.record(z.string(), Server) });

export const PartContext = z.object({ id: z.string(), label: z.string(), tech: z.string().optional(), tags: z.array(z.string()).optional(), refs: z.array(RefSchema).optional() });
export type PartContext = z.infer<typeof PartContext>;

/** The configured servers. A broken file is an error to show, not a reason for the app to fail. */
export async function readConfig(file = MCP_FILE): Promise<{ servers: Record<string, Server>; error?: string }> {
  try {
    return { servers: Config.parse(JSON.parse(await fs.readFile(file, 'utf8'))).mcpServers };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { servers: {} };
    return { servers: {}, error: e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e) };
  }
}

let config: ReturnType<typeof readConfig> | undefined;
const configured = () => (config ??= readConfig());

/** Takes ${NAME} from the environment, so tokens need not sit in the file. */
export function expand(text: string) {
  return text.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined) throw new Error(`${name} is not set`);
    return value;
  });
}
const expandAll = (o: Record<string, string> = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]));

const WORDS = ['id', 'label', 'tech', 'tag', ...REF_KINDS];
const HOLE = new RegExp(`\\{(${WORDS.join('|')})\\}`, 'g');

const valueOf = (part: PartContext, word: string) => {
  if (word === 'id' || word === 'label' || word === 'tech') return part[word];
  if (word === 'tag') return part.tags?.[0];
  return part.refs?.find((r) => r.kind === word)?.value;
};

/** Fills a query's args from a part, or returns undefined when the part lacks something they ask for. */
export function fillArgs(args: Record<string, unknown>, part: PartContext) {
  let complete = true;
  const fill = (x: unknown): unknown => {
    if (typeof x === 'string') {
      return x.replace(HOLE, (_, word: string) => {
        const value = valueOf(part, word);
        if (value === undefined) complete = false;
        return value ?? '';
      });
    }
    if (Array.isArray(x)) return x.map(fill);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)]));
    return x;
  };
  const filled = fill(args) as Record<string, unknown>;
  return complete ? filled : undefined;
}

const connections = new Map<string, Promise<Client>>();

function connect(name: string, s: Server) {
  let open = connections.get(name);
  if (!open) {
    open = (async () => {
      const transport = s.url
        ? new StreamableHTTPClientTransport(new URL(expand(s.url)), { requestInit: { headers: expandAll(s.headers) } })
        : new StdioClientTransport({ command: s.command!, args: s.args?.map(expand), env: { ...(process.env as Record<string, string>), ...expandAll(s.env) }, stderr: 'ignore' });
      // No capabilities: a server can't ask this app for sampling or for input.
      const client = new Client({ name: 'system-design', version: '1' });
      client.onclose = () => connections.delete(name);
      await client.connect(transport, { timeout: TIMEOUT });
      return client;
    })();
    connections.set(name, open);
    open.catch(() => connections.delete(name));
  }
  return open;
}

export async function closeMcp() {
  const open = [...connections.values()];
  connections.clear();
  await Promise.allSettled(open.map(async (c) => (await c).close()));
}

async function toolsOf(client: Client) {
  const tools = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({ cursor }, { timeout: TIMEOUT });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/** What the app shows: never commands, addresses or headers. */
export async function mcpList() {
  const { servers, error } = await configured();
  return { file: MCP_FILE, error, servers: Object.entries(servers).map(([name, s]) => ({ name, kind: s.url ? ('http' as const) : ('stdio' as const), queries: s.queries.map((q) => q.title) })) };
}

/** The queries that can run for this part. */
export async function mcpQueries(part: PartContext) {
  const { servers } = await configured();
  return Object.entries(servers).flatMap(([server, s]) => s.queries.filter((q) => fillArgs(q.args, part)).map((q) => ({ server, title: q.title })));
}

const serverNamed = async (name: string) => {
  const s = (await configured()).servers[name];
  if (!s) throw new ValidationError(`no MCP server named ${name}`);
  return s;
};

/** Connects to a server and counts the tools the app may call. */
export async function testMcp(name: string) {
  const s = await serverNamed(name);
  try {
    const tools = await toolsOf(await connect(name, s));
    return { ok: true, tools: tools.length, readOnly: tools.filter((t) => t.annotations?.readOnlyHint === true || s.allow?.includes(t.name)).length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs one query for a part and returns the server's text. It stays data: the app only ever displays it. */
export async function runMcp(name: string, title: string, part: PartContext) {
  const s = await serverNamed(name);
  const query = s.queries.find((q) => q.title === title);
  if (!query) throw new ValidationError(`${name} has no query named ${title}`);
  const args = fillArgs(query.args, part);
  if (!args) throw new ValidationError(`${part.label} lacks what "${title}" needs`);
  const client = await connect(name, s);
  const tool = (await toolsOf(client)).find((t) => t.name === query.tool);
  if (!tool) throw new ValidationError(`${name} has no tool ${query.tool}`);
  if (tool.annotations?.readOnlyHint !== true && !s.allow?.includes(tool.name)) {
    throw new ValidationError(`${query.tool} doesn't declare itself read-only. Add it to "allow" for ${name} if it is safe.`);
  }
  const result = await client.callTool({ name: query.tool, arguments: args }, undefined, { timeout: TIMEOUT });
  const items = (result.content ?? []) as { type: string; text?: string }[];
  const text = items.flatMap((c) => (c.type === 'text' && c.text ? [c.text] : [])).join('\n');
  if (result.isError) throw new Error(`${name}: ${text || 'the tool failed'}`);
  return { text: text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n… cut at ${MAX_RESULT} characters` : text };
}
