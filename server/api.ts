import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { liveLines, queryPrometheus } from '../core/live.ts';
import { ValidationError } from '../core/schema.ts';
import {
  ConflictError,
  DESIGNS_DIR,
  NotFoundError,
  createDesign,
  importDesign,
  listDesigns,
  listTemplates,
  listTrash,
  readDesign,
  restoreDesign,
  trashDesign,
  writeDesign,
} from '../core/store.ts';
import { shareHtml } from './share.ts';

const MAX_BODY = 5 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ValidationError('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ValidationError('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function statusOf(e: unknown) {
  if (e instanceof NotFoundError) return 404;
  if (e instanceof ConflictError) return 409;
  if (e instanceof ValidationError || (e instanceof Error && e.message.startsWith('invalid id'))) return 400;
  return 500;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Refuses what a web page elsewhere could make a browser send: a request whose Host isn't this machine (DNS rebinding:
 * evil.example resolving to 127.0.0.1) and a write whose Origin is another site (a plain form POST needs no preflight).
 * HOST set to a name or an address the server is bound to is allowed too; tools without a browser send no Origin.
 */
export function trusted(req: IncomingMessage, host = process.env.HOST): true | string {
  const name = (h: string) => new URL(`http://${h}`).hostname;
  try {
    const at = name(req.headers.host ?? '');
    if (!LOOPBACK.has(at) && at !== (host && name(host)) && host !== '0.0.0.0' && host !== '::') {
      return `This server answers only to localhost. To open it as ${at}, start it with HOST=${at} (or HOST=0.0.0.0 for any name).`;
    }
    if (req.method === 'GET' || req.method === 'HEAD' || !req.headers.origin) return true;
    return new URL(req.headers.origin).host === req.headers.host || 'Changes from other sites are refused.';
  } catch {
    return 'This request has an unreadable Host or Origin header.';
  }
}

/** The designs folder as a small JSON API plus change events over SSE. `handle` takes paths with the /api prefix already removed. */
export function createApi() {
  fs.mkdirSync(DESIGNS_DIR, { recursive: true });
  const clients = new Set<ServerResponse>();
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const watcher = fs.watch(DESIGNS_DIR, (_event, file) => {
    if (!file?.endsWith('.json')) return;
    pending.add(file.slice(0, -5));
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const id of pending) for (const c of clients) c.write(`data: ${JSON.stringify({ id })}\n\n`);
      pending.clear();
    }, 80);
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://local');
    const [, resource, id, sub] = url.pathname.split('/');
    const trust = trusted(req);
    if (trust !== true) return send(res, 403, { error: trust });
    try {
      if (resource === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (resource === 'templates' && req.method === 'GET') return send(res, 200, await listTemplates());
      if (resource === 'info' && req.method === 'GET') return send(res, 200, { dir: DESIGNS_DIR });
      if (resource === 'trash') {
        if (!id && req.method === 'GET') return send(res, 200, await listTrash());
        if (id && !sub && req.method === 'POST') return send(res, 200, await restoreDesign(id));
      }
      if (resource === 'designs') {
        if (!id && req.method === 'GET') return send(res, 200, await listDesigns());
        if (!id && req.method === 'POST') {
          const body = (await readBody(req)) as { id?: unknown; title?: unknown; template?: unknown; from?: unknown; design?: unknown };
          // A whole design (an exported file) comes in under a free id.
          if (body.design !== undefined) return send(res, 201, await importDesign(body.design));
          const optional = (x: unknown) => x === undefined || typeof x === 'string';
          if (typeof body.id !== 'string' || typeof body.title !== 'string' || !optional(body.template) || !optional(body.from)) {
            throw new ValidationError('id and title must be strings');
          }
          return send(res, 201, await createDesign({ id: body.id, title: body.title, template: body.template as string | undefined, from: body.from as string | undefined }));
        }
        // DELETE needs a CORS preflight, so another site open in the browser can't trash designs.
        if (id && !sub && req.method === 'DELETE') {
          await trashDesign(id);
          return send(res, 200, { trashed: id });
        }
        if (id && sub === 'share' && req.method === 'GET') {
          const html = await shareHtml(id);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}.html"` });
          return res.end(html);
        }
        if (id && sub === 'live' && req.method === 'GET') {
          // The address comes from the environment only, never the request, so the page can't point the server elsewhere.
          const prometheus = process.env.PROMETHEUS_URL;
          if (!prometheus) return send(res, 404, { error: 'Set PROMETHEUS_URL to show live load.' });
          const d = await readDesign(id);
          return send(res, 200, liveLines(d, await queryPrometheus(prometheus)));
        }
        if (sub) return send(res, 404, { error: 'not found' });
        if (id && req.method === 'GET') return send(res, 200, await readDesign(id));
        if (id && req.method === 'PUT') {
          const body = (await readBody(req)) as { id?: unknown };
          if (body.id !== id) throw new ValidationError('id in body must match the URL');
          return send(res, 200, await writeDesign(body as never));
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      const status = statusOf(e);
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { handle, close: () => watcher.close() };
}

/** Mounts the API inside the Vite dev server. */
export function designApi(): Plugin {
  return {
    name: 'design-api',
    configureServer(server) {
      const api = createApi();
      server.httpServer?.on('close', api.close);
      server.middlewares.use('/api', api.handle);
    },
  };
}
