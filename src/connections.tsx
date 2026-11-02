import { useCallback, useEffect, useState } from 'react';
import { type Design } from '../core/schema.ts';
import { api, type Hook, type HookFormat, type McpServers, type Plugins } from './api.ts';
import { Prop } from './fields.tsx';
import { Icon, type IconName } from './icons.tsx';
import { Select } from './select.tsx';
import { DialogHead, useDismiss } from './menus.tsx';
import { errorText } from './format.ts';

const EVENT_CHOICES = [
  { label: 'Everything', events: undefined },
  { label: 'Steps', events: ['step.*'] },
  { label: 'Steps and comments', events: ['step.*', 'comment.*'] },
  { label: 'Parts and lines', events: ['part.*', 'line.*', 'boundary.*'] },
  { label: 'Decisions', events: ['decision.*'] },
] as const;

const TABS = ['Webhooks', 'Addresses', 'MCP', 'Plugins'] as const;
const TAB_ICONS: Record<(typeof TABS)[number], IconName> = { Webhooks: 'bolt', Addresses: 'link', MCP: 'connections', Plugins: 'cube' };

/**
 * Where the app meets the rest of the world, one subject at a time: webhooks that get every change, the addresses other
 * tools and agents use (a link to what is open, the versioned API, its OpenAPI document, the design schema, change
 * events, MCP), the user's MCP servers, and plugins.
 */
export function Connections({ design, selected, plugins, onClose }: { design: Design | null; selected: string | null; plugins: Plugins | null; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Webhooks');
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
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
      setAdding(false);
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
    ...(link ? ([[selected ? 'This selection' : 'This design', link]] as [string, string][]) : []),
    ['API', `${origin}/api/v1`],
    ['Plugins', `${origin}/api/v1/plugins`],
    ['OpenAPI', `${origin}/api/v1/openapi.json`],
    ['Design schema', `${origin}/api/v1/schema/design.json`],
    ['Change stream', `${origin}/api/v1/events`],
    ['MCP', 'npx -y github:oplosy/system-design mcp'],
  ];
  const what = (h: Hook) => EVENT_CHOICES.find((c) => JSON.stringify(c.events ?? null) === JSON.stringify(h.events ?? null))?.label ?? h.events?.join(', ') ?? 'Everything';
  /** One line: a name, a value to copy, and the copy button. */
  const address = (name: string, value: string) => (
    <li key={name} className="designs-row conn-row">
      <span className="conn-name">{name}</span>
      <code className="conn-url" title={value}>
        {value}
      </code>
      <span className="designs-actions">
        <button className="text-btn" onClick={() => copy(name, value)}>
          <Icon name={copied === name ? 'check' : 'copy'} />
          {copied === name ? 'Copied' : 'Copy'}
        </button>
      </span>
    </li>
  );
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <DialogHead id="connections-title" title="Connections" onClose={onClose} />
        <div className="seg" role="tablist" aria-label="Connections">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              <Icon name={TAB_ICONS[t]} />
              {t}
            </button>
          ))}
        </div>
        {err && <em className="ed-error">{err}</em>}
        <div className="conn-body" role="tabpanel" aria-label={tab}>
          {tab === 'Webhooks' &&
            (adding ? (
              <form className="conn-form" onSubmit={add}>
                <Prop label="Address">
                  <input className="ed" type="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Webhook address" required />
                </Prop>
                <Prop label="Format">
                  <Select<HookFormat>
                    label="Format"
                    value={format}
                    onChange={setFormat}
                    options={[{ value: 'cloudevents', label: 'CloudEvents' }, { value: 'chat', label: 'Chat message' }, { value: 'slack', label: 'Slack with buttons' }]}
                  />
                </Prop>
                <Prop label="Events">
                  <Select label="Events" value={String(choice)} onChange={(v) => setChoice(Number(v))} options={EVENT_CHOICES.map((c, i) => ({ value: String(i), label: c.label }))} />
                </Prop>
                <Prop label="Secret">
                  <input className="ed" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Optional, 8 characters or more" aria-label="Signing secret" autoComplete="new-password" />
                </Prop>
                {design && (
                  <label className="conn-check">
                    <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only this design
                  </label>
                )}
                <footer className="dialog-foot">
                  <button type="button" className="text-btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                  <button className="btn ink" type="submit" disabled={!url.trim() || (secret.length > 0 && secret.length < 8)}>
                    <Icon name="plus" />
                    Add webhook
                  </button>
                </footer>
              </form>
            ) : (
              <>
                <ul className="designs-list">
                  {hooks.map((h) => (
                    <li key={h.id} className="designs-row">
                      <span className="choice-main">
                        <code className="conn-url" title={h.url}>
                          {h.url}
                        </code>
                        <span>{[{ cloudevents: 'CloudEvents', chat: 'Chat message', slack: 'Slack with buttons' }[h.format], what(h), h.designs?.length ? h.designs.join(', ') : 'all designs', h.signed && 'signed', results[h.id]].filter(Boolean).join(', ')}</span>
                      </span>
                      <span className="designs-actions">
                        <button className="text-btn" onClick={() => test(h)}>
                          <Icon name="send" />
                          Test
                        </button>
                        <button className="text-btn danger" onClick={() => run(() => api.removeHook(h.id))}>
                          <Icon name="trash" />
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                  {!hooks.length && <li className="designs-empty">No webhooks</li>}
                </ul>
                <footer className="dialog-foot">
                  <button className="btn ink" onClick={() => setAdding(true)}>
                    <Icon name="plus" />
                    Add webhook
                  </button>
                </footer>
              </>
            ))}

          {tab === 'Addresses' && <ul className="designs-list">{addresses.map(([name, value]) => address(name, value))}</ul>}

          {tab === 'MCP' && (
            <>
              {mcp?.error && <em className="ed-error">{mcp.error}</em>}
              <ul className="designs-list">
                {mcp?.servers.map((s) => (
                  <li key={s.name} className="designs-row">
                    <span className="choice-main">
                      <strong>{s.name}</strong>
                      <span>{[s.queries.length ? s.queries.join(', ') : 'No queries', results[s.name]].filter(Boolean).join(', ')}</span>
                    </span>
                    <span className="designs-actions">
                      <button className="text-btn" onClick={() => testMcp(s.name)}>
                        <Icon name="send" />
                        Test
                      </button>
                    </span>
                  </li>
                ))}
                {mcp && !mcp.servers.length && !mcp.error && <li className="designs-empty">No MCP servers</li>}
                {mcp && address('Servers file', mcp.file)}
              </ul>
              {mcp && <p className="conn-note">Restart after changing this file.</p>}
            </>
          )}

          {tab === 'Plugins' && (
            <>
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
                {plugins && !plugins.plugins.length && !plugins.failed.length && <li className="designs-empty">No plugins</li>}
                {plugins && address('Plugins folder', plugins.dir)}
              </ul>
              {plugins && <p className="conn-note">Put .mjs modules here, then restart. Plugins run as code on this machine.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
