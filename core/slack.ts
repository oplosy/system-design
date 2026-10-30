import { createHmac, timingSafeEqual } from 'node:crypto';
import * as m from './mutations.ts';
import type { Design } from './schema.ts';

// Review from Slack: a `slack` hook posts new steps with Approve and Send back buttons, and Slack calls back with the
// click. Slack can't sign in, so its signature on the request is what stands for the person who clicked.

const MAX_AGE = 300;
const MAX_STEPS = 10;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A message with buttons for each new step (Block Kit). */
export function slackMessage(design: Design, text: string, steps: { id: string; title: string }[]) {
  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text: escape(text) } }];
  for (const s of steps.slice(0, MAX_STEPS)) {
    const value = `${design.id}/${s.id}`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${escape(s.title)}*` } });
    blocks.push({
      type: 'actions',
      elements: [
        { type: 'button', action_id: 'approve', style: 'primary', text: { type: 'plain_text', text: 'Approve' }, value },
        { type: 'button', action_id: 'send_back', text: { type: 'plain_text', text: 'Send back' }, value },
      ],
    });
  }
  return { text, blocks };
}

/** Checks Slack's signature on a raw request body: v0=HMAC of "v0:<timestamp>:<body>", and that it is recent. */
export function verifySlack(secret: string, timestamp: string | undefined, body: string, signature: string | undefined, now = Date.now()) {
  if (!timestamp || !signature || Math.abs(now / 1000 - Number(timestamp)) > MAX_AGE) return false;
  const [a, b] = [Buffer.from(signature), Buffer.from(`v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What a click asks for, or undefined when the payload is not one of our buttons. */
export function slackClick(body: string) {
  const payload = JSON.parse(new URLSearchParams(body).get('payload') ?? '{}') as { actions?: { action_id?: string; value?: string }[]; user?: { name?: string; username?: string }; response_url?: string };
  const action = payload.actions?.[0];
  const [design, step, more] = (action?.value ?? '').split('/');
  if ((action?.action_id !== 'approve' && action?.action_id !== 'send_back') || !design || !step || more !== undefined) return undefined;
  return { action: action.action_id, design, step, user: payload.user?.name ?? payload.user?.username ?? 'someone', responseUrl: payload.response_url };
}

/** Applies a click to a design. */
export function applyClick(d: Design, click: NonNullable<ReturnType<typeof slackClick>>) {
  const step = d.steps.find((s) => s.id === click.step);
  if (!step) throw new Error(`unknown step "${click.step}"`);
  if (click.action === 'send_back') return m.requestChanges(d, click.step, `Sent back from Slack by ${click.user}`);
  step.seen = true;
  step.changesRequested = undefined;
}

/** Replaces the buttons with who decided. Only ever to Slack's own address. */
export async function answerSlack(responseUrl: string | undefined, text: string) {
  if (!responseUrl || new URL(responseUrl).origin !== 'https://hooks.slack.com') return;
  await fetch(responseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replace_original: true, text }), signal: AbortSignal.timeout(5000), redirect: 'error' });
}
