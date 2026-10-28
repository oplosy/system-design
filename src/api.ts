import { parseDesign, type Design } from '../core/schema.ts';

export type Summary = { id: string; title: string; description?: string; steps: number; unseen: number };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
    create: async (_: { id: string; title: string; template?: string }): Promise<Design> => {
      throw new ApiError('A shared copy can’t create designs.', 403);
    },
  };
}

export const api = shared ? local(shared) : {
  designs: () => call<Summary[]>('GET', '/api/designs'),
  templates: () => call<Summary[]>('GET', '/api/templates'),
  get: (id: string) => call<Design>('GET', `/api/designs/${id}`),
  save: (d: Design) => call<Design>('PUT', `/api/designs/${d.id}`, d),
  create: (input: { id: string; title: string; template?: string }) => call<Design>('POST', '/api/designs', input),
};
