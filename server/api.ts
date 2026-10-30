import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { addHook, listHooks, publicHook, removeHook, testHook } from '../core/hooks.ts';
import { queryPrometheus, readLoad } from '../core/live.ts';
import { PartContext, closeMcp, mcpList, mcpQueries, runMcp, testMcp } from '../core/mcp-client.ts';
import { exportWithPlugin, pluginLinks, pluginList, pluginMetrics, readWithPlugins } from '../core/plugins.ts';
import * as m from '../core/mutations.ts';
import { RefSchema, ValidationError, type Comment } from '../core/schema.ts';
import { answerSlack, applyClick, slackClick, verifySlack } from '../core/slack.ts';
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
  updateDesign,
  writeDesign,
} from '../core/store.ts';
import { signedIn } from './auth.ts';
import { designJsonSchema, openApi } from './openapi.ts';
import { shareHtml } from './share.ts';

const MAX_BODY = 5 * 1024 * 1024;

function readText(req: IncomingMessage): Promise<string> {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const text = await readText(req);
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('invalid JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function statusOf(e: unknown) {
  if (e instanceof NotFoundError) return 404;
  if (e instanceof ConflictError) return 409;
  if (e instanceof ValidationError || e instanceof z.ZodError || (e instanceof Error && e.message.startsWith('invalid id'))) return 400;
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
    // /api/v1/… is the published, versioned path; /api/… stays the same API for the app and older scripts.
    const pathname = /^\/v1(\/|$)/.test(url.pathname) ? url.pathname.slice(3) || '/' : url.pathname;
    const [, resource, id, sub] = pathname.split('/');
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
      if (resource === 'openapi.json' && req.method === 'GET') return send(res, 200, openApi(pkg.version));
      if (resource === 'schema' && id === 'design.json' && req.method === 'GET') return send(res, 200, designJsonSchema());
      if (resource === 'hooks') {
        if (!id && req.method === 'GET') return send(res, 200, (await listHooks()).map(publicHook));
        if (!id && req.method === 'POST') return send(res, 201, publicHook(await addHook(await readBody(req))));
        if (id && !sub && req.method === 'DELETE') return (await removeHook(id)) ? send(res, 200, { removed: id }) : send(res, 404, { error: 'no such webhook' });
        if (id && sub === 'test' && req.method === 'POST') {
          const result = await testHook(id);
          return result ? send(res, 200, result) : send(res, 404, { error: 'no such webhook' });
        }
      }
      if (resource === 'slack' && id === 'actions' && req.method === 'POST') {
        const secret = process.env.SYSTEM_DESIGN_SLACK_SECRET;
        if (!secret) return send(res, 404, { error: 'Set SYSTEM_DESIGN_SLACK_SECRET to take reviews from Slack.' });
        const raw = await readText(req);
        const header = (name: string) => [req.headers[name]].flat()[0];
        if (!verifySlack(secret, header('x-slack-request-timestamp'), raw, header('x-slack-signature'))) return send(res, 401, { error: 'bad signature' });
        const click = slackClick(raw);
        if (!click) throw new ValidationError('not a review button');
        await updateDesign(click.design, (d) => applyClick(d, click), 'app');
        await answerSlack(click.responseUrl, `${click.action === 'approve' ? 'Approved' : 'Sent back'} by ${click.user}`).catch((e) => console.error(e));
        return send(res, 200, {});
      }
      if (resource === 'mcp') {
        if (!id && req.method === 'GET') return send(res, 200, await mcpList());
        if (id === 'queries' && !sub && req.method === 'POST') return send(res, 200, await mcpQueries(PartContext.parse(await readBody(req))));
        if (id === 'run' && !sub && req.method === 'POST') {
          const { server, query, part } = z.object({ server: z.string(), query: z.string(), part: PartContext }).parse(await readBody(req));
          return send(res, 200, await runMcp(server, query, part));
        }
        if (id && sub === 'test' && req.method === 'POST') return send(res, 200, await testMcp(decodeURIComponent(id)));
      }
      if (resource === 'plugins') {
        if (!id && req.method === 'GET') return send(res, 200, await pluginList());
        if (id === 'read' && !sub && req.method === 'POST') {
          const { text } = (await readBody(req)) as { text?: unknown };
          if (typeof text !== 'string') throw new ValidationError('text must be a string');
          return send(res, 200, (await readWithPlugins(text)) ?? null);
        }
        if (id === 'links' && !sub && req.method === 'POST') return send(res, 200, await pluginLinks(z.array(RefSchema).max(500).parse(await readBody(req))));
      }
      // The hub answers this for a signed-in person; on one's own machine nobody signs in.
      if (resource === 'me' && req.method === 'GET') return send(res, 200, null);
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
          if (body.design !== undefined) return send(res, 201, await importDesign(body.design, 'app'));
          const optional = (x: unknown) => x === undefined || typeof x === 'string';
          if (typeof body.id !== 'string' || typeof body.title !== 'string' || !optional(body.template) || !optional(body.from)) {
            throw new ValidationError('id and title must be strings');
          }
          return send(res, 201, await createDesign({ id: body.id, title: body.title, template: body.template as string | undefined, from: body.from as string | undefined }, 'app'));
        }
        // DELETE needs a CORS preflight, so another site open in the browser can't trash designs.
        if (id && !sub && req.method === 'DELETE') {
          await trashDesign(id, 'app');
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
          const plugged = await pluginMetrics();
          if (!prometheus && !plugged.length) return send(res, 404, { error: 'Set PROMETHEUS_URL or add a metrics plugin to show live load.' });
          const d = await readDesign(id);
          return send(res, 200, await readLoad(d, [...(prometheus ? [{ name: 'Prometheus', read: () => queryPrometheus(prometheus) }] : []), ...plugged]));
        }
        if (id && sub === 'export' && req.method === 'GET') {
          const key = pathname.split('/')[4] ?? '';
          const out = await exportWithPlugin(key, await readDesign(id));
          if (!out) return send(res, 404, { error: 'no such exporter' });
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}.${out.extension}"` });
          return res.end(out.text);
        }
        if (id && sub === 'comments' && req.method === 'POST') {
          const input = z.object({ step: z.string().optional(), target: z.string().optional(), text: z.string().min(1).max(5000) }).parse(await readBody(req));
          let comment = '';
          await updateDesign(id, (d) => void (comment = m.addComment(d, { ...input, by: 'reviewer', author: signedIn(req)?.name })), 'app');
          return send(res, 201, { id: comment });
        }
        if (sub) return send(res, 404, { error: 'not found' });
        if (id && req.method === 'GET') return send(res, 200, await readDesign(id));
        if (id && req.method === 'PUT') {
          const body = (await readBody(req)) as { id?: unknown; comments?: unknown };
          if (body.id !== id) throw new ValidationError('id in body must match the URL');
          const person = signedIn(req);
          if (person && Array.isArray(body.comments)) m.keepAuthors(body.comments as Comment[], (await readDesign(id)).comments, person.name);
          return send(res, 200, await writeDesign(body as never, { actor: 'app' }));
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      const status = statusOf(e);
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    handle,
    close: () => {
      watcher.close();
      void closeMcp();
    },
  };
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
