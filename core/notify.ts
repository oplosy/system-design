import type { Design } from './schema.ts';

// Tells a chat when an agent or a sync adds steps for review: SYSTEM_DESIGN_WEBHOOK is a Slack, Discord or Teams
// incoming webhook (or anything that takes a JSON POST); SYSTEM_DESIGN_URL is where the app runs, for the link.

/** The message for steps `after` has that `before` lacked and that are waiting for review, or undefined when none. */
export function newStepsMessage(before: Design | undefined, after: Design, app = process.env.SYSTEM_DESIGN_URL ?? 'http://127.0.0.1:5180') {
  const fresh = after.steps.filter((s) => !s.seen && !before?.steps.some((b) => b.id === s.id));
  if (!fresh.length) return undefined;
  const waiting = after.steps.filter((s) => !s.seen).length;
  const what = fresh.length === 1 ? `New step in “${after.title}”` : `${fresh.length} new steps in “${after.title}”`;
  return `${what}: ${fresh.map((s) => s.title).join('; ')}. ${waiting} waiting for review: ${app.replace(/\/$/, '')}/#${encodeURIComponent(after.id)}`;
}

/** Posts the message, if there is one and a webhook is set. Never throws: a chat being down must not fail a write. */
export async function notifyNewSteps(before: Design | undefined, after: Design, url = process.env.SYSTEM_DESIGN_WEBHOOK) {
  const text = url && newStepsMessage(before, after);
  if (!text) return;
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error('SYSTEM_DESIGN_WEBHOOK must be an http(s) address');
    // Slack and Teams read text, Discord reads content.
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`the webhook answered ${res.status}`);
  } catch (e) {
    // stderr: the MCP server's stdout is its protocol.
    console.error(`system-design: could not notify: ${e instanceof Error ? e.message : e}`);
  }
}
