import type { Design } from '../core/schema.ts';

export type Summary = { id: string; title: string; description?: string; unseen: number };

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

export const api = {
  designs: () => call<Summary[]>('GET', '/api/designs'),
  templates: () => call<Summary[]>('GET', '/api/templates'),
  get: (id: string) => call<Design>('GET', `/api/designs/${id}`),
  save: (d: Design) => call<Design>('PUT', `/api/designs/${d.id}`, d),
  create: (input: { id: string; title: string; template?: string }) => call<Design>('POST', '/api/designs', input),
};
