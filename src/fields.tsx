import { useEffect, useState } from 'react';
import { api, type McpPart, type McpQuery } from './api.ts';
import { REF_KINDS, RefSchema, type ConnectionKind, type Design, type Ref, type RefKind } from '../core/schema.ts';
import { flowLatency } from '../core/export.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';

/** A borderless text input that reads like the value it holds; edits commit as you type. */
export function Ed(props: {
  value: string | undefined;
  onCommit: (v: string | undefined) => void;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
  /** Says what is wrong with a non-empty value, if anything. */
  check?: (v: string) => string | undefined;
}) {
  const [v, setV] = useState(props.value ?? '');
  useEffect(() => setV(props.value ?? ''), [props.value]);
  const problem = (x: string) => (props.required && !x.trim() ? `${props.label} can’t be empty` : x.trim() ? props.check?.(x.trim()) : undefined);
  const error = problem(v);
  const onChange = (next: string) => {
    setV(next);
    // An invalid value keeps the last valid one until the text is valid again.
    if (!problem(next)) props.onCommit(next.trim() ? next : undefined);
  };
  const common = { value: v, placeholder: props.placeholder ?? 'Empty', 'aria-label': props.label, 'aria-invalid': !!error || undefined, className: `ed ${props.className ?? ''}` };
  return (
    <>
      {props.multiline ? <textarea {...common} rows={1} onChange={(e) => onChange(e.target.value)} /> : <input {...common} onChange={(e) => onChange(e.target.value)} />}
      {error && <em className="ed-error">{error}</em>}
    </>
  );
}

// Every currency the browser knows, for the design's currency picker.
export const CURRENCIES = Intl.supportedValuesOf('currency');

/** A non-negative number field; empty means unknown. */
export function Num({ label, unit, value, onCommit }: { label: string; unit: string; value?: number; onCommit: (v: number | undefined) => void }) {
  const [v, setV] = useState(value === undefined ? '' : String(value));
  useEffect(() => setV(value === undefined ? '' : String(value)), [value]);
  const n = Number(v);
  const invalid = v.trim() !== '' && (!Number.isFinite(n) || n < 0);
  return (
    <label className="num">
      <input
        className="ed"
        type="number"
        min={0}
        inputMode="decimal"
        value={v}
        placeholder="—"
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setV(e.target.value);
          const x = Number(e.target.value);
          if (e.target.value.trim() === '') onCommit(undefined);
          else if (Number.isFinite(x) && x >= 0) onCommit(x);
        }}
      />
      <span className="quiet">{unit}</span>
    </label>
  );
}

export function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <div className="prop-value">{children}</div>
    </div>
  );
}

export function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="block-label">{label}</span>
      {children}
    </div>
  );
}

export type Change = (fn: (d: Design) => void) => void;

const REF_NAMES: Record<RefKind, string> = {
  repo: 'Repository',
  docs: 'Docs',
  runbook: 'Runbook',
  dashboard: 'Dashboard',
  ticket: 'Ticket',
  owner: 'Owner',
  oncall: 'On call',
  slo: 'SLO',
  otel: 'OTel service',
  k8s: 'Kubernetes',
  cloud: 'Cloud resource',
  backstage: 'Backstage',
  link: 'Link',
};
// Only web addresses open; identifiers (otel, k8s, an ARN) and anything else stay text.
const webLink = (v: string) => (/^https?:\/\/\S+$/i.test(v) ? v : undefined);

/** What the user's MCP servers can say about a part. Each query runs when asked, since it sends part data to that server. */
export function Connected({ part }: { part: McpPart }) {
  const [queries, setQueries] = useState<McpQuery[]>([]);
  const [open, setOpen] = useState<Record<string, { text?: string; error?: string }>>({});
  const asked = JSON.stringify({ id: part.id, label: part.label, tech: part.tech, tags: part.tags, refs: part.refs?.map((r) => ({ kind: r.kind, value: r.value })) });
  useEffect(() => {
    let stop = false;
    setOpen({});
    api.mcpQueries(JSON.parse(asked)).then(
      (q) => !stop && setQueries(q),
      () => !stop && setQueries([]),
    );
    return () => {
      stop = true;
    };
  }, [asked]);
  if (!queries.length) return null;
  const key = (q: McpQuery) => `${q.server}/${q.title}`;
  const show = (q: McpQuery) => {
    setOpen((o) => ({ ...o, [key(q)]: { text: 'Asking…' } }));
    api.mcpRun(q, JSON.parse(asked)).then(
      ({ text }) => setOpen((o) => ({ ...o, [key(q)]: { text: text || 'Nothing.' } })),
      (e) => setOpen((o) => ({ ...o, [key(q)]: { error: e instanceof Error ? e.message : String(e) } })),
    );
  };
  return (
    <div className="refs">
      {queries.map((q) => {
        const r = open[key(q)];
        return (
          <div key={key(q)}>
            <div className="ref-row">
              <span className="ref-kind">{q.server}</span>
              <button type="button" className="text-btn" onClick={() => show(q)}>
                {q.title}
              </button>
            </div>
            {r?.error && <em className="ed-error">{r.error}</em>}
            {r?.text && <pre className="mcp-result">{r.text}</pre>}
          </div>
        );
      })}
    </div>
  );
}

/** A part's links and identifiers in other tools: one row each, plus a row to add one. */
export function RefsEditor({ refs = [], onChange }: { refs?: Ref[]; onChange: (refs: Ref[] | undefined) => void }) {
  // Plugins can turn plain values (a ticket number) into addresses.
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const plain = JSON.stringify(refs.filter((r) => !webLink(r.value)));
  useEffect(() => {
    if (plain !== '[]') void api.pluginLinks(JSON.parse(plain)).then(setResolved, () => undefined);
  }, [plain]);
  const address = (r: Ref) => webLink(r.value) ?? webLink(resolved[`${r.kind}:${r.value}`] ?? '');
  const [kind, setKind] = useState<RefKind>('link');
  const [value, setValue] = useState('');
  const set = (next: Ref[]) => onChange(next.length ? next : undefined);
  const fresh = RefSchema.safeParse({ kind, value });
  const add = () => {
    if (!fresh.success) return;
    set([...refs, fresh.data]);
    setValue('');
  };
  return (
    <div className="refs">
      {refs.map((r, i) => (
        <div className="ref-row" key={`${r.kind}-${i}`}>
          <span className="ref-kind">{REF_NAMES[r.kind]}</span>
          {address(r) ? (
            <a className="ref ref-value" href={address(r)} target="_blank" rel="noreferrer noopener" title={r.value}>
              {r.label ?? r.value.replace(/^https?:\/\//i, '')}
            </a>
          ) : (
            <code className="ref-value" title={r.value}>
              {r.value}
            </code>
          )}
          <button className="icon-btn ref-remove" onClick={() => set(refs.filter((_, j) => j !== i))} aria-label={`Remove ${REF_NAMES[r.kind]} ${r.value}`} title="Remove">
            ×
          </button>
        </div>
      ))}
      <form
        className="ref-row ref-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <select className="ed ref-kind" value={kind} onChange={(e) => setKind(e.target.value as RefKind)} aria-label="Kind of link">
          {REF_KINDS.map((k) => (
            <option key={k} value={k}>
              {REF_NAMES[k]}
            </option>
          ))}
        </select>
        <input
          className="ed ref-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={kind === 'otel' ? 'service.name' : kind === 'k8s' ? 'namespace/kind/name' : kind === 'cloud' ? 'ARN or resource id' : kind === 'backstage' ? 'component:default/name' : 'https://…'}
          aria-label="Link or identifier"
        />
        <button className="text-btn" type="submit" disabled={!fresh.success}>
          Add
        </button>
      </form>
    </div>
  );
}

/** Picks the boundary something sits in; `exclude` keeps a boundary out of its own subtree. */
/** UML relations, named by how they are drawn; the diamond sits at the line's start (the whole). */
export const RELATION_NAMES: Record<ConnectionKind, string> = {
  inheritance: 'Inheritance ▷',
  implementation: 'Implementation ┄▷',
  composition: 'Composition ◆',
  aggregation: 'Aggregation ◇',
  include: '«include» ┄>',
  extend: '«extend» ┄>',
};

export function InsideSelect({ design, value, exclude, onPick }: { design: Design; value?: string; exclude?: Set<string>; onPick: (id: string | undefined) => void }) {
  return (
    <select className="ed" value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)} aria-label="Inside">
      <option value="">Nothing</option>
      {design.boundaries
        .filter((b) => !exclude?.has(b.id))
        .map((b) => (
          <option key={b.id} value={b.id}>
            {BOUNDARY_SPECS[b.kind].name}: {b.label}
          </option>
        ))}
    </select>
  );
}

/** A flow's total time, " · ≥ 40 ms" when some hops have no latency yet; empty when none have. */
export function timeText(design: Design, flow: Design['flows'][number]) {
  const { total, unknown } = flowLatency(design, flow);
  return unknown === flow.path.length - 1 ? '' : ` · ${unknown ? '≥ ' : ''}${total} ms`;
}

/** The flow being played and which hop (0-based) is lit. */
export type FlowAt = { id: string; at: number };
