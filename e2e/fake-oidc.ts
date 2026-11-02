import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// A minimal OpenID Connect provider for the hub tests: discovery, an authorize step that signs in whoever the test chose,
// a token endpoint that returns a signed ID token, and the public key. It trusts nobody and is never run outside tests.
const port = Number(process.argv[2]);
const issuer = `http://127.0.0.1:${port}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' };
const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url');
let who = 'ann@example.com';
const codes = new Map<string, { nonce: string; clientId: string; email: string }>();

const json = (res: import('node:http').ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const body = (req: import('node:http').IncomingMessage) => new Promise<string>((done) => {
  let s = '';
  req.on('data', (c) => (s += c)).on('end', () => done(s));
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', issuer);
  if (url.pathname === '/.well-known/openid-configuration') return json(res, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
  if (url.pathname === '/jwks') return json(res, { keys: [jwk] });
  if (url.pathname === '/__user' && req.method === 'POST') {
    who = (JSON.parse(await body(req)) as { email: string }).email;
    return json(res, { ok: true });
  }
  if (url.pathname === '/authorize') {
    const code = b64(randomBytes(16));
    codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', clientId: url.searchParams.get('client_id') ?? '', email: who });
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    res.writeHead(302, { Location: back.href });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(await body(req));
    const found = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    if (!found) return json(res, { error: 'invalid_grant' }, 400);
    const head = b64(JSON.stringify({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }));
    const claims = b64(JSON.stringify({ iss: issuer, aud: found.clientId, sub: found.email, email: found.email, email_verified: true, name: found.email.split('@')[0], nonce: found.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 }));
    const signature = b64(sign('sha256', Buffer.from(`${head}.${claims}`), privateKey));
    return json(res, { id_token: `${head}.${claims}.${signature}`, access_token: 'unused', token_type: 'Bearer' });
  }
  json(res, { error: 'not found' }, 404);
}).listen(port, '127.0.0.1');
