import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Hub mode: the same server for a team, behind single sign-on. Sign-in is OpenID Connect's code flow with PKCE against
// the team's provider, so there are no passwords here, and a signed cookie carries the session with no state on the
// server. Everyone on the allow list can read and edit; hooks and MCP servers hold the host's secrets, so they stay
// out of reach over the network.

export type HubConfig = { issuer: string; clientId: string; clientSecret: string; url: string; allowed: string[] };
export type User = { email: string; name: string };

const SESSION_HOURS = 12;
const LOGIN_MINUTES = 10;
const SESSION = 'sd_session';
const LOGIN = 'sd_login';
/** First path segment after /api or /api/v1 that only the machine's owner may reach. */
const OWNER_ONLY = new Set(['hooks', 'mcp']);

const safeUrl = (name: string, value: string) => {
  const u = new URL(value);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error(`${name} must be https`);
  return value.replace(/\/$/, '');
};

/** The hub's settings from the environment, undefined when it is off. Half a configuration refuses to start. */
export function hubConfig(env: Record<string, string | undefined> = process.env): HubConfig | undefined {
  const issuer = env.SYSTEM_DESIGN_OIDC_ISSUER;
  if (!issuer) return undefined;
  const need = ['SYSTEM_DESIGN_OIDC_CLIENT_ID', 'SYSTEM_DESIGN_OIDC_CLIENT_SECRET', 'SYSTEM_DESIGN_ALLOWED', 'SYSTEM_DESIGN_URL'].filter((k) => !env[k]);
  if (need.length) throw new Error(`Sign-in needs ${need.join(', ')}`);
  return {
    issuer: safeUrl('SYSTEM_DESIGN_OIDC_ISSUER', issuer),
    clientId: env.SYSTEM_DESIGN_OIDC_CLIENT_ID!,
    clientSecret: env.SYSTEM_DESIGN_OIDC_CLIENT_SECRET!,
    url: safeUrl('SYSTEM_DESIGN_URL', env.SYSTEM_DESIGN_URL!),
    allowed: env.SYSTEM_DESIGN_ALLOWED!.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
  };
}

const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url');
const isAllowed = (email: string, allowed: string[]) => allowed.some((a) => email === a || (a.startsWith('@') && email.endsWith(a)));

function cookies(req: IncomingMessage) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').flatMap((c) => {
    const at = c.indexOf('=');
    return at < 0 ? [] : [[c.slice(0, at).trim(), c.slice(at + 1).trim()]];
  }));
}

/** Returns `gate`: called before anything else, it answers the request itself (true) or lets it through (false). */
export function createHub(config: HubConfig) {
  // shortcut: a new key per start signs everyone out on restart and can't span servers; read it from the environment when a hub runs more than one.
  const key = randomBytes(32);
  const hmac = (body: string) => createHmac('sha256', key).update(body).digest('base64url');
  const seal = (data: object, seconds: number) => {
    const body = b64(JSON.stringify({ ...data, exp: Date.now() + seconds * 1000 }));
    return `${body}.${hmac(body)}`;
  };
  const open = <T>(cookie: string | undefined): T | undefined => {
    const [body, mac] = (cookie ?? '').split('.');
    if (!body || !mac) return undefined;
    const [a, b] = [Buffer.from(mac), Buffer.from(hmac(body))];
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    return data.exp > Date.now() ? data : undefined;
  };
  const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.url.startsWith('https:') ? '; Secure' : ''}`;
  const redirect = (res: ServerResponse, to: string, set: string[] = []) => {
    res.writeHead(302, { Location: to, 'Set-Cookie': set, 'Cache-Control': 'no-store' });
    res.end();
  };
  const text = (res: ServerResponse, status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(message);
  };

  let provider: Promise<{ authorization_endpoint: string; token_endpoint: string }> | undefined;
  const discover = () =>
    (provider ??= (async () => {
      const res = await fetch(`${config.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!res.ok) throw new Error(`The sign-in provider answered ${res.status}`);
      const meta = (await res.json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string };
      if (meta.issuer.replace(/\/$/, '') !== config.issuer) throw new Error('The sign-in provider names another issuer');
      safeUrl('authorization_endpoint', meta.authorization_endpoint);
      safeUrl('token_endpoint', meta.token_endpoint);
      return meta;
    })().catch((e) => {
      provider = undefined;
      throw e;
    }));

  const redirectUri = `${config.url}/auth/callback`;

  async function login(res: ServerResponse) {
    const { authorization_endpoint } = await discover();
    const [state, nonce, verifier] = [b64(randomBytes(32)), b64(randomBytes(32)), b64(randomBytes(32))];
    const to = new URL(authorization_endpoint);
    const params = { response_type: 'code', client_id: config.clientId, redirect_uri: redirectUri, scope: 'openid email profile', state, nonce, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' };
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    redirect(res, to.href, [cookie(LOGIN, seal({ state, nonce, verifier }, LOGIN_MINUTES * 60), LOGIN_MINUTES * 60)]);
  }

  async function callback(req: IncomingMessage, res: ServerResponse, params: URLSearchParams) {
    const pending = open<{ state: string; nonce: string; verifier: string }>(cookies(req)[LOGIN]);
    const code = params.get('code');
    if (!pending || !code || params.get('state') !== pending.state) return text(res, 400, 'This sign-in expired. Open the app and try again.');
    const { token_endpoint } = await discover();
    const answer = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: pending.verifier }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    const { id_token } = (await answer.json().catch(() => ({}))) as { id_token?: string };
    if (!answer.ok || !id_token) return text(res, 502, 'The sign-in provider refused the sign-in.');
    // The token comes straight from the provider over TLS, so OpenID Connect Core 3.1.3.7 lets the checks below stand in for its signature.
    const claims = JSON.parse(Buffer.from(id_token.split('.')[1] ?? '', 'base64url').toString() || '{}') as { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; email?: string; email_verified?: boolean; name?: string };
    const audience = [claims.aud].flat();
    if (claims.iss?.replace(/\/$/, '') !== config.issuer || !audience.includes(config.clientId) || (claims.exp ?? 0) * 1000 < Date.now() || claims.nonce !== pending.nonce) {
      return text(res, 400, 'The sign-in could not be verified.');
    }
    const email = claims.email?.toLowerCase();
    if (!email || claims.email_verified === false || !isAllowed(email, config.allowed)) return text(res, 403, `${email ?? 'This account'} has no access here.`);
    const user: User = { email, name: claims.name || email };
    redirect(res, '/', [cookie(SESSION, seal(user, SESSION_HOURS * 3600), SESSION_HOURS * 3600), cookie(LOGIN, '', 0)]);
  }

  return async function gate(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://local');
    const { pathname } = url;
    if (pathname === '/auth/login') return login(res).then(() => true);
    if (pathname === '/auth/callback') return callback(req, res, url.searchParams).then(() => true);
    if (pathname === '/auth/logout') return (redirect(res, '/', [cookie(SESSION, '', 0)]), true);
    const api = /^\/api(\/v1)?(\/|$)/.exec(pathname);
    const user = open<User>(cookies(req)[SESSION]);
    if (!user) {
      if (api) text(res, 401, 'Sign in first.');
      else redirect(res, '/auth/login');
      return true;
    }
    if (!api) return false;
    const resource = pathname.slice(api[0].length).split('/')[0];
    if (resource === 'me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ email: user.email, name: user.name }));
      return true;
    }
    if (OWNER_ONLY.has(resource)) return (text(res, 403, 'Only the machine this runs on can change this.'), true);
    return false;
  };
}
