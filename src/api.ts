import type { PluginDiagram } from '../core/diagram.ts';
import type { Live } from '../core/live.ts';
import { parseDesign, type Design } from '../core/schema.ts';

export type Summary = { id: string; title: string; description?: string; steps: number; unseen: number; updated?: number };
export type LiveLoad = { lines: Record<string, Live>; unmatched: string[]; failed?: string[] };
export type HookFormat = 'cloudevents' | 'chat' | 'slack';
export type Hook = { id: string; url: string; format: HookFormat; events?: string[]; designs?: string[]; signed: boolean };
export type HookInput = { url: string; format: HookFormat; events?: string[]; designs?: string[]; secret?: string };
export type Plugins = {
  dir: string;
  plugins: { name: string; importers: string[]; exporters: { key: string; name: string; extension: string }[]; metrics: string[]; links: string[] }[];
  failed: { file: string; error: string }[];
};
export type PluginRead = { format: string; diagram: PluginDiagram } | null;
export type McpServers = { file: string; error?: string; servers: { name: string; kind: 'http' | 'stdio'; queries: string[] }[] };
export type McpTest = { ok: boolean; tools?: number; readOnly?: number; error?: string };
export type McpQuery = { server: string; title: string };
export type McpPart = { id: string; label: string; tech?: string; tags?: string[]; refs?: { kind: string; value: string }[] };
export type Me = { email: string; name: string; canEdit: boolean } | null;
export type Trashed = { entry: string; id: string; title: string; deleted: number };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let viewing = false;

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? res.statusText, res.status);
  return json as T;
}

/**
 * Designs baked into a shared HTML file (see server/share.ts). When present the app runs without a server:
 * reads come from them and saves stay in memory, so a reader can walk steps and play flows but changes nothing on disk.
 */
const baked = typeof document !== 'undefined' ? document.getElementById('shared-designs')?.textContent : undefined;
export const shared: Map<string, Design> | null = baked ? new Map((JSON.parse(baked) as unknown[]).map((x) => parseDesign(x)).map((d) => [d.id, d])) : null;

const summary = (d: Design): Summary => ({ id: d.id, title: d.title, description: d.description, steps: d.steps.length, unseen: d.steps.filter((s) => !s.seen).length });

const readOnly = (): never => {
  throw new ApiError('A shared copy changes nothing on disk.', 403);
};

function local(store: Map<string, Design>) {
  const find = (id: string) => {
    const d = store.get(id);
    if (!d) throw new ApiError(`"${id}" is not in this shared copy`, 404);
    return structuredClone(d);
  };
  return {
    designs: async () => [...store.values()].map(summary),
    templates: async () => [] as Summary[],
    get: async (id: string) => find(id),
    save: async (d: Design) => {
      const next = { ...structuredClone(d), rev: d.rev + 1 };
      store.set(d.id, next);
      return structuredClone(next);
    },
    create: async (_: { id: string; title: string; template?: string; from?: string }): Promise<Design> => {
      throw new ApiError('A shared copy can’t create designs.', 403);
    },
    importFile: async (_: unknown): Promise<Design> => readOnly(),
    trash: async (_: string): Promise<unknown> => readOnly(),
    trashed: async () => [] as Trashed[],
    restore: async (_: string): Promise<Design> => readOnly(),
    info: async () => ({ dir: '' }),
    live: async (_: string): Promise<LiveLoad> => {
      throw new ApiError('A shared copy has no live data.', 404);
    },
    plugins: async (): Promise<Plugins> => ({ dir: '', plugins: [], failed: [] }),
    readWithPlugin: async (_: string): Promise<PluginRead> => null,
    pluginLinks: async (_: { kind: string; value: string }[]): Promise<Record<string, string>> => ({}),
    mcp: async (): Promise<McpServers> => ({ file: '', servers: [] }),
    mcpQueries: async (_: McpPart) => [] as McpQuery[],
    mcpRun: async (_: McpQuery, __: McpPart): Promise<{ text: string }> => readOnly(),
    mcpTest: async (_: string): Promise<McpTest> => readOnly(),
    me: async (): Promise<Me> => null,
    comment: async (_: string, __: { step?: string; target?: string; text: string }): Promise<unknown> => readOnly(),
    hooks: async () => [] as Hook[],
    addHook: async (_: HookInput): Promise<Hook> => readOnly(),
    removeHook: async (_: string): Promise<unknown> => readOnly(),
    testHook: async (_: string): Promise<{ ok: boolean; status?: number; error?: string }> => readOnly(),
  };
}

export const api = shared ? local(shared) : {
  designs: () => call<Summary[]>('GET', '/api/designs'),
  templates: () => call<Summary[]>('GET', '/api/templates'),
  get: (id: string) => call<Design>('GET', `/api/designs/${id}`),
  // A viewer on a hub can try changes on the sheet, as in a shared copy; nothing is sent.
  save: async (d: Design) => (viewing ? { ...d, rev: d.rev + 1 } : call<Design>('PUT', `/api/designs/${d.id}`, d)),
  create: (input: { id: string; title: string; template?: string; from?: string }) => call<Design>('POST', '/api/designs', input),
  importFile: (design: unknown) => call<Design>('POST', '/api/designs', { design }),
  trash: (id: string) => call<unknown>('DELETE', `/api/designs/${id}`),
  trashed: () => call<Trashed[]>('GET', '/api/trash'),
  restore: (entry: string) => call<Design>('POST', `/api/trash/${entry}`),
  info: () => call<{ dir: string }>('GET', '/api/info'),
  live: (id: string) => call<LiveLoad>('GET', `/api/designs/${id}/live`),
  plugins: () => call<Plugins>('GET', '/api/v1/plugins'),
  // Asks only when an importer is installed, so a big file is never sent for nothing.
  readWithPlugin: async (text: string) => ((await call<Plugins>('GET', '/api/v1/plugins')).plugins.some((p) => p.importers.length) ? call<PluginRead>('POST', '/api/v1/plugins/read', { text }) : null),
  pluginLinks: (refs: { kind: string; value: string }[]) => call<Record<string, string>>('POST', '/api/v1/plugins/links', refs),
  mcp: () => call<McpServers>('GET', '/api/v1/mcp'),
  mcpQueries: (part: McpPart) => call<McpQuery[]>('POST', '/api/v1/mcp/queries', part),
  mcpRun: (q: McpQuery, part: McpPart) => call<{ text: string }>('POST', '/api/v1/mcp/run', { server: q.server, query: q.title, part }),
  mcpTest: (name: string) => call<McpTest>('POST', `/api/v1/mcp/${encodeURIComponent(name)}/test`),
  me: async () => {
    const me = await call<Me>('GET', '/api/v1/me');
    viewing = me?.canEdit === false;
    return me;
  },
  comment: (id: string, input: { step?: string; target?: string; text: string }) => call<unknown>('POST', `/api/v1/designs/${id}/comments`, input),
  hooks: () => call<Hook[]>('GET', '/api/v1/hooks'),
  addHook: (input: HookInput) => call<Hook>('POST', '/api/v1/hooks', input),
  removeHook: (id: string) => call<unknown>('DELETE', `/api/v1/hooks/${encodeURIComponent(id)}`),
  testHook: (id: string) => call<{ ok: boolean; status?: number; error?: string }>('POST', `/api/v1/hooks/${encodeURIComponent(id)}/test`),
};
