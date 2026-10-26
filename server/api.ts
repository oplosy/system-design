import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { ValidationError } from '../core/schema.ts';
import { ConflictError, DESIGNS_DIR, NotFoundError, createDesign, listDesigns, listTemplates, readDesign, writeDesign } from '../core/store.ts';

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

/** Serves the designs folder as a small JSON API inside the Vite dev server, plus change events over SSE. */
export function designApi(): Plugin {
  return {
    name: 'design-api',
    configureServer(server) {
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
      server.httpServer?.on('close', () => watcher.close());

      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        const [, resource, id] = url.pathname.split('/');
        try {
          if (resource === 'events' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            res.write(': connected\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
          }
          if (resource === 'templates' && req.method === 'GET') return send(res, 200, await listTemplates());
          if (resource === 'designs') {
            if (!id && req.method === 'GET') return send(res, 200, await listDesigns());
            if (!id && req.method === 'POST') {
              const body = (await readBody(req)) as { id?: unknown; title?: unknown; template?: unknown };
              if (typeof body.id !== 'string' || typeof body.title !== 'string' || (body.template !== undefined && typeof body.template !== 'string')) {
                throw new ValidationError('id and title must be strings');
              }
              return send(res, 201, await createDesign({ id: body.id, title: body.title, template: body.template as string | undefined }));
            }
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
      });
    },
  };
}
