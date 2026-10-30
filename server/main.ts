// Serves the built app (dist/) and the design API without Vite: `npm run build`, then `npm start`.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createApi } from './api.ts';
import { createHub, hubConfig } from './auth.ts';
import { DIST } from './share.ts';

const PORT = Number(process.env.PORT ?? 5180);
const HOST = process.env.HOST ?? '127.0.0.1';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

try {
  await fs.access(path.join(DIST, 'index.html'));
} catch {
  console.error('dist/index.html is missing: run `npm run build` first.');
  process.exit(1);
}

let gate: ReturnType<typeof createHub> | undefined;
try {
  const hub = hubConfig();
  gate = hub && createHub(hub);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
if (!gate && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) console.warn(`Warning: anyone who can reach ${HOST} can read and change these designs. Set up sign-in (see the README) to share them.`);

const api = createApi();

async function serveFile(pathname: string, res: http.ServerResponse) {
  // Resolve inside dist/ only; anything that climbs out, or isn't a file, gets the app shell.
  let file = path.join(DIST, decodeURIComponent(pathname));
  if (!file.startsWith(DIST) || !(await fs.stat(file).catch(() => null))?.isFile()) file = path.join(DIST, 'index.html');
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    // Vite puts a content hash in asset names, so they never change; the shell must always be fresh.
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(await fs.readFile(file));
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://local');
  try {
    if (await gate?.(req, res)) return;
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(502).end('Sign-in is not available right now.');
    return;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    req.url = req.url!.slice(4) || '/';
    return api.handle(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  try {
    await serveFile(pathname, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.on('close', api.close);
server.listen(PORT, HOST, () => console.log(`System design on http://${HOST}:${PORT}`));
