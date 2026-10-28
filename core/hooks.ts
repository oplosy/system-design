import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { EVENT_TYPES, designEvents, type DesignEvent } from './events.ts';
import { userAppDir } from './paths.ts';
import type { Design } from './schema.ts';

// Webhooks: every write of a design posts what changed to the addresses listed in hooks.json, as CloudEvents or as a
// chat message. The file sits in the user's app folder, not with the designs, so a designs folder kept in git never
// carries webhook secrets. The app, the MCP server and the CLI all read it, so each posts the writes it makes.

export const HOOKS_FILE = process.env.SYSTEM_DESIGN_HOOKS ?? path.join(userAppDir(), 'hooks.json');

/** Who made a write: the reviewer in the app, or an agent, sync or command through the store. */
export type Actor = 'app' | 'agent';

const Pattern = z.string().refine((p) => p === '*' || (EVENT_TYPES as readonly string[]).includes(p) || EVENT_TYPES.some((t) => p.endsWith('.*') && t.startsWith(p.slice(0, -1))), {
  message: `an event type (${EVENT_TYPES.slice(0, 3).join(', ')}…), a group such as "step.*", or "*"`,
});
export const HookInput = z.object({
  url: z.string().regex(/^https?:\/\/\S+$/i, 'an http(s) address'),
  /** cloudevents: a JSON array of CloudEvents per write. chat: one line of text for Slack, Teams or Discord. */
  format: z.enum(['cloudevents', 'chat']).default('cloudevents'),
  /** Event types or groups to send; all when empty. */
  events: z.array(Pattern).optional(),
  /** Design ids to send events for; all when empty. */
  designs: z.array(z.string()).optional(),
  /** Signs each body: X-System-Design-Signature: sha256=<HMAC of the body with this secret>. */
  secret: z.string().min(8).max(200).optional(),
});
const Hook = HookInput.extend({ id: z.string() });
export type Hook = z.infer<typeof Hook>;

export async function listHooks(): Promise<Hook[]> {
  let raw: string;
  try {
    raw = await fs.readFile(HOOKS_FILE, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return z.array(Hook).parse(JSON.parse(raw));
}

async function saveHooks(hooks: Hook[]) {
  await fs.mkdir(path.dirname(HOOKS_FILE), { recursive: true });
  const tmp = `${HOOKS_FILE}.${process.pid}.tmp`;
  // Owner-only: the file holds signing secrets.
  await fs.writeFile(tmp, JSON.stringify(hooks, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, HOOKS_FILE);
}

/** A hook as the API shows it: the secret never leaves the machine, only whether there is one. */
export const publicHook = ({ secret, ...h }: Hook) => ({ ...h, signed: !!secret });

export async function addHook(input: unknown) {
  const hook = { ...HookInput.parse(input), id: randomUUID() };
  await saveHooks([...(await listHooks()), hook]);
  return hook;
}

export async function removeHook(id: string) {
  const hooks = await listHooks();
  if (!hooks.some((h) => h.id === id)) return false;
  await saveHooks(hooks.filter((h) => h.id !== id));
  return true;
}

/** SYSTEM_DESIGN_WEBHOOK, the older single chat webhook: new steps from agents, as a chat message. */
function envHook(): Hook | undefined {
  const url = process.env.SYSTEM_DESIGN_WEBHOOK;
  return url ? { id: 'env', url, format: 'chat', events: ['step.added'] } : undefined;
}

const appUrl = () => (process.env.SYSTEM_DESIGN_URL ?? 'http://127.0.0.1:5180').replace(/\/$/, '');
const wanted = (h: Hook, e: DesignEvent, design: string) =>
  (!h.designs?.length || h.designs.includes(design)) && (!h.events?.length || h.events.some((p) => p === '*' || p === e.type || (p.endsWith('.*') && e.type.startsWith(p.slice(0, -1)))));

/** The chat line for new steps waiting for review, or undefined when there are none. */
export function newStepsMessage(design: Design, events: DesignEvent[], app = appUrl()) {
  const fresh = events.filter((e) => e.type === 'step.added' && !e.data.seen).map((e) => (e.data.step as { title: string }).title);
  if (!fresh.length) return undefined;
  const waiting = design.steps.filter((s) => !s.seen).length;
  const what = fresh.length === 1 ? `New step in “${design.title}”` : `${fresh.length} new steps in “${design.title}”`;
  return `${what}: ${fresh.join('; ')}. ${waiting} waiting for review: ${app}/#${encodeURIComponent(design.id)}`;
}

/** The request body for a hook, or undefined when it has nothing to say about these events. */
export function hookBody(h: Hook, design: Design, events: DesignEvent[], actor: Actor) {
  const mine = events.filter((e) => wanted(h, e, design.id));
  if (!mine.length) return undefined;
  if (h.format === 'chat') {
    // A chat is for people: the reviewer's own edits in the app post nothing there.
    const text = actor === 'app' ? undefined : newStepsMessage(design, mine);
    return text && { contentType: 'application/json', body: JSON.stringify({ text, content: text }) };
  }
  const time = new Date().toISOString();
  const batch = mine.map((e) => ({
    specversion: '1.0',
    id: randomUUID(),
    source: `system-design://${os.hostname()}/designs/${design.id}`,
    type: `system-design.${e.type}`,
    subject: e.subject,
    time,
    datacontenttype: 'application/json',
    actor,
    data: { design: { id: design.id, title: design.title, rev: design.rev }, link: `${appUrl()}/#${e.subject.split('/').map(encodeURIComponent).join('/')}`, ...e.data },
  }));
  return { contentType: 'application/cloudevents-batch+json', body: JSON.stringify(batch) };
}

/** Posts once, retrying network errors, 429 and 5xx twice. Resolves with the last status; never throws. */
async function post(h: Hook, contentType: string, body: string, waits = [1000, 4000]) {
  const headers: Record<string, string> = { 'Content-Type': contentType, 'User-Agent': 'system-design', 'X-System-Design-Delivery': randomUUID() };
  if (h.secret) headers['X-System-Design-Signature'] = `sha256=${createHmac('sha256', h.secret).update(body).digest('hex')}`;
  let last: { ok: boolean; status?: number; error?: string } = { ok: false };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(h.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000), redirect: 'error' });
      last = { ok: res.ok, status: res.status };
      if (res.ok || (res.status < 500 && res.status !== 429)) return last;
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (attempt >= waits.length) return last;
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
}

const pending = new Set<Promise<unknown>>();
/** Waits for deliveries still in flight; commands call it before exiting so a write's events aren't lost. */
export const deliveriesSettled = () => Promise.allSettled([...pending]);

/**
 * Posts what changed between `before` and `after` to every hook that wants it, in the background: a slow or broken
 * webhook must never slow down or fail a save. Failures go to stderr (the MCP server's stdout is its protocol).
 */
export function emitDesignEvents(before: Design | undefined, after: Design, actor: Actor, extra: DesignEvent[] = []) {
  const run = (async () => {
    const events = [...designEvents(before, after), ...extra];
    if (!events.length) return;
    let hooks: Hook[];
    try {
      hooks = await listHooks();
    } catch (e) {
      console.error(`system-design: ${HOOKS_FILE} can't be read, so no webhooks were sent: ${e instanceof Error ? e.message : e}`);
      hooks = [];
    }
    const env = envHook();
    await Promise.all(
      [...hooks, ...(env ? [env] : [])].map(async (h) => {
        const out = hookBody(h, after, events, actor);
        if (!out) return;
        const r = await post(h, out.contentType, out.body);
        if (!r.ok) console.error(`system-design: webhook ${h.url} failed: ${r.error ?? `answered ${r.status}`}`);
      }),
    );
  })();
  pending.add(run);
  void run.finally(() => pending.delete(run));
}

/** Sends one system-design.ping event to a hook (no retries) and reports how it answered. */
export async function testHook(id: string) {
  const h = (await listHooks()).find((x) => x.id === id);
  if (!h) return undefined;
  const body =
    h.format === 'chat'
      ? JSON.stringify({ text: 'system-design is connected.', content: 'system-design is connected.' })
      : JSON.stringify([{ specversion: '1.0', id: randomUUID(), source: `system-design://${os.hostname()}`, type: 'system-design.ping', time: new Date().toISOString(), datacontenttype: 'application/json', data: {} }]);
  return post(h, h.format === 'chat' ? 'application/json' : 'application/cloudevents-batch+json', body, []);
}
