import { useCallback, useEffect, useState } from 'react';
import { type Design } from '../core/schema.ts';
import { api, type Hook, type HookFormat, type McpServers, type Plugins } from './api.ts';
import { DialogHead, useDismiss } from './menus.tsx';
import { errorText } from './format.ts';

const EVENT_CHOICES = [
  { label: 'Everything', events: undefined },
  { label: 'Steps', events: ['step.*'] },
  { label: 'Steps and comments', events: ['step.*', 'comment.*'] },
  { label: 'Parts and lines', events: ['part.*', 'line.*', 'boundary.*'] },
  { label: 'Decisions', events: ['decision.*'] },
] as const;

/**
 * Where the app meets the rest of the world: webhooks that get every change, and the addresses other tools and
 * agents use (a link to what is open, the versioned API, its OpenAPI document, the design schema, change events, MCP).
 */
export function Connections({ design, selected, plugins, onClose }: { design: Design | null; selected: string | null; plugins: Plugins | null; onClose: () => void }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<HookFormat>('cloudevents');
  const [choice, setChoice] = useState(0);
  const [onlyThis, setOnlyThis] = useState(false);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [mcp, setMcp] = useState<McpServers | null>(null);
  useDismiss(true, onClose);
  useEffect(() => void api.mcp().then(setMcp, (e) => setErr(errorText(e))), []);
  const testMcp = (name: string) =>
    run(async () => {
      setResults((r) => ({ ...r, [name]: 'Connecting…' }));
      const r = await api.mcpTest(name);
      setResults((x) => ({ ...x, [name]: r.ok ? `Connected: ${r.tools} tools, ${r.readOnly} read-only` : `Failed: ${r.error}` }));
    });
  const load = useCallback(() => api.hooks().then(setHooks).catch((e) => setErr(errorText(e))), []);
  useEffect(() => void load(), [load]);
  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      await load();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const events = EVENT_CHOICES[choice].events;
      await api.addHook({ url: url.trim(), format, events: events && [...events], designs: onlyThis && design ? [design.id] : undefined, secret: secret || undefined });
      setUrl('');
      setSecret('');
    });
  };
  const test = (h: Hook) =>
    run(async () => {
      setResults((r) => ({ ...r, [h.id]: 'Sending…' }));
      const r = await api.testHook(h.id);
      setResults((x) => ({ ...x, [h.id]: r.ok ? `Answered ${r.status}` : `Failed: ${r.error ?? `answered ${r.status}`}` }));
    });
  const origin = location.origin;
  const link = design ? `${origin}/#${[design.id, ...(selected ? [selected] : [])].map(encodeURIComponent).join('/')}` : null;
  const copy = (what: string, text: string) => navigator.clipboard?.writeText(text).then(() => setCopied(what));
  const addresses: [string, string][] = [
    ['API', `${origin}/api/v1`],
    ['Plugins', `${origin}/api/v1/plugins`],
    ['OpenAPI', `${origin}/api/v1/openapi.json`],
    ['Design schema', `${origin}/api/v1/schema/design.json`],
    ['Change stream', `${origin}/api/v1/events`],
    ['MCP', 'npx -y github:oplosy/system-design mcp'],
  ];
  const what = (h: Hook) => EVENT_CHOICES.find((c) => JSON.stringify(c.events ?? null) === JSON.stringify(h.events ?? null))?.label ?? h.events?.join(', ') ?? 'Everything';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <DialogHead id="connections-title" title="Connections" onClose={onClose} />
        {err && <em className="ed-error">{err}</em>}
        <h3 className="conn-head">Webhooks</h3>
        <ul className="designs-list">
          {hooks.map((h) => (
            <li key={h.id} className="designs-row">
              <span className="choice-main">
                <code className="conn-url" title={h.url}>
                  {h.url}
                </code>
                <span>
                  {[{ cloudevents: 'CloudEvents', chat: 'Chat message', slack: 'Slack with buttons' }[h.format], what(h), h.designs?.length ? h.designs.join(', ') : 'all designs', h.signed && 'signed', results[h.id]].filter(Boolean).join(', ')}
                </span>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => test(h)}>
                  Test
                </button>
                <button className="text-btn danger" onClick={() => run(() => api.removeHook(h.id))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
          {!hooks.length && <li className="designs-empty">No webhooks yet.</li>}
        </ul>
        <form className="conn-form" onSubmit={add}>
          <input className="find-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Webhook address" required />
          <select className="find-input" value={format} onChange={(e) => setFormat(e.target.value as HookFormat)} aria-label="Format">
            <option value="cloudevents">CloudEvents</option>
            <option value="chat">Chat message</option>
            <option value="slack">Slack with buttons</option>
          </select>
          <select className="find-input" value={choice} onChange={(e) => setChoice(Number(e.target.value))} aria-label="Events">
            {EVENT_CHOICES.map((c, i) => (
              <option key={c.label} value={i}>
                {c.label}
              </option>
            ))}
          </select>
          <input className="find-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret, at least 8 characters" aria-label="Signing secret" autoComplete="new-password" />
          {design && (
            <label className="conn-check">
              <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only “{design.title}”
            </label>
          )}
          <button className="btn" type="submit" disabled={!url.trim() || (secret.length > 0 && secret.length < 8)}>
            Add webhook
          </button>
        </form>
        <h3 className="conn-head">MCP servers</h3>
        <p className="quiet conn-note">
          List servers in <code>{mcp?.file}</code>, then restart.
        </p>
        {mcp?.error && <em className="ed-error">{mcp.error}</em>}
        <ul className="designs-list">
          {mcp?.servers.map((s) => (
            <li key={s.name} className="designs-row">
              <span className="choice-main">
                <strong>{s.name}</strong>
                <span>{[s.queries.length ? s.queries.join(', ') : 'No queries yet', results[s.name]].filter(Boolean).join(', ')}</span>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => testMcp(s.name)}>
                  Test
                </button>
              </span>
            </li>
          ))}
          {!mcp?.servers.length && !mcp?.error && <li className="designs-empty">No MCP servers yet.</li>}
        </ul>
        <h3 className="conn-head">Plugins</h3>
        <p className="quiet conn-note">
          Put <code>.mjs</code> modules in <code>{plugins?.dir}</code>, then restart. Plugins run as code on this machine.
        </p>
        <ul className="designs-list">
          {plugins?.plugins.map((p) => (
            <li key={p.name} className="designs-row">
              <span className="choice-main">
                <strong>{p.name}</strong>
                <span>
                  {[
                    p.importers.length && `Reads ${p.importers.join(', ')}`,
                    p.exporters.length && `Exports ${p.exporters.map((x) => x.name).join(', ')}`,
                    p.metrics.length && `Live load from ${p.metrics.join(', ')}`,
                    p.links.length && `Opens ${p.links.join(', ')} links`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </span>
            </li>
          ))}
          {plugins?.failed.map((f) => (
            <li key={f.file} className="designs-row">
              <span className="choice-main">
                <strong>{f.file}</strong>
                <em className="ed-error">{f.error}</em>
              </span>
            </li>
          ))}
          {!plugins?.plugins.length && !plugins?.failed.length && <li className="designs-empty">No plugins yet.</li>}
        </ul>
        <h3 className="conn-head">Addresses</h3>
        <ul className="designs-list">
          {link && (
            <li className="designs-row">
              <span className="choice-main">
                <strong>Link to {selected ? 'the selection' : 'this design'}</strong>
                <code className="conn-url">{link}</code>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => copy('link', link)}>
                  {copied === 'link' ? 'Copied' : 'Copy'}
                </button>
              </span>
            </li>
          )}
          {addresses.map(([name, value]) => (
            <li key={name} className="designs-row">
              <span className="choice-main">
                <strong>{name}</strong>
                <code className="conn-url">{value}</code>
              </span>
              <span className="designs-actions">
                <button className="text-btn" onClick={() => copy(name, value)}>
                  {copied === name ? 'Copied' : 'Copy'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
