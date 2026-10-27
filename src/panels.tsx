import { useContext, useEffect, useMemo, useState } from 'react';
import { BOUNDARY_KINDS, COMPONENT_TYPES, CONNECTION_KINDS, type BoundaryKind, type ComponentType, type ConnectionKind, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { SketchContext } from './canvas.tsx';
import { GROUPS, KITS, NOTE_COLOR, SHAPES, drawShape, kitsOf, searchText, type Kit } from './shapes.ts';

export type AddKind = ComponentType | 'note' | 'decision' | `boundary:${BoundaryKind}`;
export const DRAG_MIME = 'application/x-system-design';

const pad = (n: number) => String(n).padStart(2, '0');

export function ShapePreview({ type, width = 56, height = 38 }: { type: ComponentType; width?: number; height?: number }) {
  const sketch = useContext(SketchContext);
  const spec = SHAPES[type];
  const paths = useMemo(() => drawShape(type, sketch, 7), [type, sketch]);
  return (
    <svg width={width} height={height} viewBox={`-4 -4 ${spec.w + 8} ${spec.h + 8}`} aria-hidden="true" style={{ flex: 'none' }}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} vectorEffect="non-scaling-stroke" style={{ stroke: p.stroke, strokeWidth: 1.1, fill: p.fill ?? 'none' }} />
      ))}
    </svg>
  );
}

function BoundaryPreview({ kind }: { kind: BoundaryKind }) {
  const spec = BOUNDARY_SPECS[kind];
  return (
    <svg width={40} height={26} aria-hidden="true" style={{ flex: 'none' }}>
      <rect x={2} y={3} width={36} height={20} rx={2} style={{ fill: spec.color, fillOpacity: 0.08, stroke: spec.color, strokeWidth: 1.4 }} strokeDasharray={spec.dash && '4 3'} />
    </svg>
  );
}

function savedKit(): Kit {
  try {
    const k = localStorage.getItem('sd-kit');
    return KITS.find((x) => x.key === k)?.key ?? 'system';
  } catch {
    return 'system';
  }
}

export function Palette({ onAdd }: { onAdd: (kind: AddKind) => void }) {
  const [query, setQuery] = useState('');
  const [kit, setKitState] = useState<Kit>(savedKit);
  const setKit = (k: Kit) => {
    setKitState(k);
    try {
      localStorage.setItem('sd-kit', k);
    } catch {
      // The kit choice is a convenience; ignore blocked storage.
    }
  };
  // Every word must appear somewhere in the name, id or keywords ("kafka", "redis cache", "s3").
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
  const row = (kind: AddKind, name: string, preview: React.ReactNode) => (
    <button
      key={kind}
      className="part"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(kind)}
      title={`Add ${name}: drag onto the canvas or click`}
    >
      <span className="part-shape">{preview}</span>
      <span className="part-name">{name}</span>
      <span className="part-add" aria-hidden="true">
        +
      </span>
    </button>
  );
  // A search looks through every kit; otherwise only the chosen kit, its own groups first.
  const inView = (t: ComponentType) => (terms.length ? match(searchText(t)) : kitsOf(t).includes(kit));
  const groups = [...GROUPS]
    .sort((a, b) => Number(b.kit === kit) - Number(a.kit === kit))
    .map((g) => ({ ...g, types: COMPONENT_TYPES.filter((t) => SHAPES[t].group === g.key && inView(t)) }));
  const boundaries = BOUNDARY_KINDS.filter((k) => (terms.length ? match(`${BOUNDARY_SPECS[k].name} ${k} boundary box group network segment`) : BOUNDARY_SPECS[k].kits.includes(kit)));
  const explain = [
    { kind: 'note' as const, name: 'Note', preview: <span className="note-swatch" /> },
    { kind: 'decision' as const, name: 'Decision', preview: <span className="decision-swatch" /> },
  ].filter((x) => match(x.name));
  return (
    <aside className="palette">
      <div className="palette-top">
        <input
          className="palette-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder={{ system: 'Search: kafka, redis, s3…', network: 'Search: router, printer, wifi…', software: 'Search: use case, class, state…' }[kit]}
          aria-label="Search parts"
        />
        <div className="seg" role="radiogroup" aria-label="Part kit">
          {KITS.map((k) => (
            <button key={k.key} role="radio" aria-checked={kit === k.key} onClick={() => setKit(k.key)}>
              {k.title}
            </button>
          ))}
        </div>
      </div>
      <div className="palette-scroll">
        {groups.map(
          (g) =>
            g.types.length > 0 && (
              <section key={g.key}>
                <h3 className="rule-head">
                  <span className="swatch-sq" style={{ background: g.color }} />
                  {g.title}
                  <span className="rule-count">{pad(g.types.length)}</span>
                </h3>
                {g.types.map((t) => row(t, SHAPES[t].name, <ShapePreview type={t} width={40} height={26} />))}
              </section>
            ),
        )}
        {boundaries.length > 0 && (
          <section>
            <h3 className="rule-head">
              <span className="swatch-sq hollow" />
              Boundaries
              <span className="rule-count">{pad(boundaries.length)}</span>
            </h3>
            {boundaries.map((k) => row(`boundary:${k}`, BOUNDARY_SPECS[k].name, <BoundaryPreview kind={k} />))}
          </section>
        )}
        {explain.length > 0 && (
          <section>
            <h3 className="rule-head">
              <span className="swatch-sq" style={{ background: NOTE_COLOR }} />
              Annotate
              <span className="rule-count">{pad(explain.length)}</span>
            </h3>
            {explain.map((x) => row(x.kind, x.name, x.preview))}
          </section>
        )}
        {!groups.some((g) => g.types.length) && !boundaries.length && !explain.length && <p className="quiet pad">No part matches “{query}”.</p>}
      </div>
      <p className="palette-foot">Drag onto the sheet or click to add. Drag between items to connect.</p>
    </aside>
  );
}

/** A floating side panel; its inner edge drags (or arrow-keys) to resize, double-click resets. */
export function Dock({ side, width, onResize, onReset, children }: { side: 'left' | 'right'; width: number; onResize: (w: number) => void; onReset: () => void; children: React.ReactNode }) {
  const dir = side === 'left' ? 1 : -1;
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget, x0 = e.clientX;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onResize(width + dir * (ev.clientX - x0));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div className={`dock dock-${side}`} style={{ width }}>
      {children}
      <div
        className="dock-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={drag}
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          onResize(width + (e.key === 'ArrowRight' ? 16 : -16) * dir);
        }}
      />
    </div>
  );
}

/** A borderless text input that reads like the value it holds; edits commit as you type. */
function Ed(props: {
  value: string | undefined;
  onCommit: (v: string | undefined) => void;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  const [v, setV] = useState(props.value ?? '');
  useEffect(() => setV(props.value ?? ''), [props.value]);
  const invalid = props.required && !v.trim();
  const onChange = (next: string) => {
    setV(next);
    // Required values keep their last valid version until the text is valid again.
    if (!(props.required && !next.trim())) props.onCommit(next.trim() ? next : undefined);
  };
  const common = { value: v, placeholder: props.placeholder ?? 'Empty', 'aria-label': props.label, 'aria-invalid': invalid || undefined, className: `ed ${props.className ?? ''}` };
  return (
    <>
      {props.multiline ? <textarea {...common} rows={1} onChange={(e) => onChange(e.target.value)} /> : <input {...common} onChange={(e) => onChange(e.target.value)} />}
      {invalid && <em className="ed-error">{props.label} can’t be empty</em>}
    </>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <div className="prop-value">{children}</div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="block-label">{label}</span>
      {children}
    </div>
  );
}

type Change = (fn: (d: Design) => void) => void;

/** Picks the boundary something sits in; `exclude` keeps a boundary out of its own subtree. */
/** UML relations, named by how they are drawn; the diamond sits at the line's start (the whole). */
const RELATION_NAMES: Record<ConnectionKind, string> = {
  inheritance: 'Inheritance ▷',
  implementation: 'Implementation ┄▷',
  composition: 'Composition ◆',
  aggregation: 'Aggregation ◇',
  include: '«include» ┄>',
  extend: '«extend» ┄>',
};

function InsideSelect({ design, value, exclude, onPick }: { design: Design; value?: string; exclude?: Set<string>; onPick: (id: string | undefined) => void }) {
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

/** The flow being played and which hop (0-based) is lit. */
export type FlowAt = { id: string; at: number };

function Flows({ design, upTo, flow, onFlow, change }: { design: Design; upTo: number; flow: FlowAt | null; onFlow: (f: FlowAt | null) => void; change: Change }) {
  const idx = m.stepIndex(design);
  const flows = design.flows.filter((f) => idx.get(f.step)! <= upTo);
  if (!flows.length) return null;
  const labelOf = (id: string) => design.components.find((c) => c.id === id)?.label ?? id;
  return (
    <section className="insp-sec">
      <h3 className="rule-head">
        Flows
        <span className="rule-count">{pad(flows.length)}</span>
      </h3>
      {flows.map((f) => {
        const at = flow?.id === f.id ? flow.at : null;
        const hops = f.path.length - 1;
        return (
          <div key={f.id} className={`flow-entry${at !== null ? ' on' : ''}`}>
            <button className="list-row" aria-pressed={at !== null} onClick={() => onFlow(at !== null ? null : { id: f.id, at: 0 })} title={at !== null ? 'Stop' : 'Play hop by hop'}>
              <span className="flow-play" aria-hidden="true">
                {at !== null ? '■' : '▶'}
              </span>
              <span className="list-main">{f.title}</span>
              <span className="list-meta">{hops} hops</span>
            </button>
            {at !== null && (
              <div className="flow-steps">
                <button className="btn" disabled={at === 0} onClick={() => onFlow({ id: f.id, at: at - 1 })} aria-label="Previous hop">
                  ←
                </button>
                <span className="flow-hop">
                  <span className="mono">
                    {at + 1}/{hops}
                  </span>{' '}
                  {labelOf(f.path[at])} → {labelOf(f.path[at + 1])}
                </span>
                <button className="btn" disabled={at === hops - 1} onClick={() => onFlow({ id: f.id, at: at + 1 })} aria-label="Next hop">
                  →
                </button>
                <button
                  className="text-btn danger"
                  onClick={() => {
                    onFlow(null);
                    change((d) => m.removeItem(d, f.id));
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function Inspector({
  design,
  selected,
  stepId,
  flow,
  onFlow,
  change,
  onSelect,
  onDelete,
}: {
  design: Design;
  selected: string | null;
  stepId: string;
  flow: FlowAt | null;
  onFlow: (f: FlowAt | null) => void;
  change: Change;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const component = design.components.find((c) => c.id === selected);
  const connection = design.connections.find((c) => c.id === selected);
  const note = design.notes.find((n) => n.id === selected);
  const decision = design.decisions.find((x) => x.id === selected);
  const boundary = design.boundaries.find((b) => b.id === selected);
  const item = component ?? connection ?? note ?? decision ?? boundary;
  const labelOf = (id: string) => [...design.components, ...design.boundaries].find((c) => c.id === id)?.label;
  const fieldText = (field: string, v: string | undefined) => (v === undefined ? '—' : field === 'boundary' || field === 'parent' ? (labelOf(v) ?? v) : v);
  const placeIn = (to: string | undefined) => change((d) => selected && m.placeIn(d, selected, to));
  const stepNo = (id: string) => design.steps.findIndex((s) => s.id === id) + 1;
  const stepTitle = (id: string) => design.steps.find((s) => s.id === id)?.title;
  const ref = (id: string) => (
    <button key={id} className="ref" onClick={() => onSelect(id)}>
      {labelOf(id) ?? id}
    </button>
  );
  const edit = <T extends { id: string }>(list: (d: Design) => T[], patch: Partial<NoInfer<T>>) =>
    change((d) => {
      const x = list(d).find((i) => i.id === selected);
      if (x) Object.assign(x, patch);
    });

  if (!item) {
    const step = design.steps.find((s) => s.id === stepId)!;
    const decisions = design.decisions.filter((x) => x.step === stepId);
    const notes = design.notes.filter((n) => n.step === stepId);
    const components = design.components.filter((c) => c.step === stepId);
    const boundaries = design.boundaries.filter((b) => b.step === stepId);
    return (
      <aside className="inspector">
        <header className="insp-head">
          <div className="insp-tagline">
            <span className="tag">Step {pad(stepNo(step.id))}</span>
            {step.changesRequested ? (
              <span className="state new">Changes requested</span>
            ) : (
              <span className={`state${step.seen ? '' : ' new'}`}>{step.seen ? 'Reviewed' : 'Not reviewed'}</span>
            )}
          </div>
          <h2 className="insp-title">{step.title}</h2>
          {step.summary && <p className="insp-lead">{step.summary}</p>}
        </header>

        {components.length + boundaries.length > 0 && (
          <section className="insp-sec">
            <h3 className="rule-head">
              Added
              <span className="rule-count">{pad(components.length + boundaries.length)}</span>
            </h3>
            {boundaries.map((b) => (
              <button key={b.id} className="list-row" onClick={() => onSelect(b.id)}>
                <BoundaryPreview kind={b.kind} />
                <span className="list-main">{b.label}</span>
                <span className="list-meta">{b.detail ?? BOUNDARY_SPECS[b.kind].name}</span>
              </button>
            ))}
            {components.map((c) => (
              <button key={c.id} className="list-row" onClick={() => onSelect(c.id)}>
                <ShapePreview type={c.type} width={30} height={20} />
                <span className="list-main">{c.label}</span>
                {c.tech && <span className="list-meta">{c.tech}</span>}
              </button>
            ))}
          </section>
        )}

        {!!step.changed?.length && (
          <section className="insp-sec">
            <h3 className="rule-head">
              Changed
              <span className="rule-count">{pad(step.changed.length)}</span>
            </h3>
            {step.changed.map((c) => (
              <button key={`${c.id}:${c.field}`} className="list-row change-row" onClick={() => onSelect(c.id)} disabled={!labelOf(c.id)}>
                <span className="list-main">
                  {labelOf(c.id) ?? c.id} <span className="quiet">{c.field}</span>
                </span>
                <span className="list-meta">
                  <s>{fieldText(c.field, c.from)}</s> → {fieldText(c.field, c.to)}
                </span>
              </button>
            ))}
          </section>
        )}

        {!!step.removed?.length && (
          <section className="insp-sec">
            <h3 className="rule-head">
              Removed
              <span className="rule-count">{pad(step.removed.length)}</span>
            </h3>
            {step.removed.map((r) => (
              <div key={r.id} className="list-row removed-row">
                {r.type && <ShapePreview type={r.type} width={30} height={20} />}
                <s className="list-main">{r.label}</s>
              </div>
            ))}
          </section>
        )}

        {decisions.length > 0 && (
          <section className="insp-sec">
            <h3 className="rule-head">
              Decisions
              <span className="rule-count">{pad(decisions.length)}</span>
            </h3>
            {decisions.map((x, i) => (
              <button key={x.id} className="decision-entry" onClick={() => onSelect(x.id)}>
                <span className="decision-no">D{i + 1}</span>
                <span className="decision-body">
                  <strong>{x.title}</strong>
                  <span className="decision-why">{x.why}</span>
                  {x.alternatives?.length ? (
                    <span className="decision-line">
                      <em>instead of</em> {x.alternatives.join(' · ')}
                    </span>
                  ) : null}
                  {x.tradeoffs && (
                    <span className="decision-line">
                      <em>cost</em> {x.tradeoffs}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </section>
        )}

        {notes.length > 0 && (
          <section className="insp-sec">
            <h3 className="rule-head">
              Notes
              <span className="rule-count">{pad(notes.length)}</span>
            </h3>
            {notes.map((n) => (
              <button key={n.id} className="note-entry" onClick={() => onSelect(n.id)}>
                {n.text}
              </button>
            ))}
          </section>
        )}

        <Flows design={design} upTo={stepNo(stepId) - 1} flow={flow} onFlow={onFlow} change={change} />

        <Comments design={design} step={stepId} change={change} onSelect={onSelect} />

        <p className="quiet pad">
          {!components.length && !boundaries.length && !decisions.length && !notes.length ? 'Nothing was added in this step. ' : ''}
          Select anything on the sheet to read or edit it. Double-click to rename.
        </p>
        <footer className="insp-foot">
          <button
            className="text-btn danger"
            title="Remove everything this step added (Ctrl+Z brings it back)"
            onClick={() =>
              confirm(`Revert step ${pad(stepNo(step.id))} “${step.title}”? Everything it added is removed.${design.steps.length > 1 ? ' The step goes too.' : ''}`) &&
              change((d) => m.revertStep(d, stepId))
            }
          >
            Revert step
          </button>
        </footer>
      </aside>
    );
  }

  const kind = component ? SHAPES[component.type].name : boundary ? BOUNDARY_SPECS[boundary.kind].name : connection ? 'Connection' : note ? 'Note' : 'Decision';
  return (
    <aside className="inspector" key={item.id}>
      <header className="insp-head">
        <div className="insp-tagline">
          <span className="tag">{kind}</span>
          <span className="mono quiet">{item.id}</span>
          <button className="text-btn close" onClick={() => onSelect(null)} title="Back to the step overview">
            Close <kbd>Esc</kbd>
          </button>
        </div>
        {component && <Ed label="Label" required className="ed-title" value={component.label} onCommit={(v) => edit((d: Design) => d.components, { label: v })} />}
        {decision && <Ed label="Title" required multiline className="ed-title" value={decision.title} onCommit={(v) => edit((d: Design) => d.decisions, { title: v })} />}
        {boundary && <Ed label="Label" required className="ed-title" value={boundary.label} onCommit={(v) => edit((d: Design) => d.boundaries, { label: v })} />}
        {connection && (
          <h2 className="insp-title route">
            {ref(connection.from)}
            <span className="route-arrow">→</span>
            {ref(connection.to)}
          </h2>
        )}
        {note && <h2 className="insp-title">Note</h2>}
      </header>

      <section className="insp-sec props">
        {component && (
          <>
            <Prop label="Type">
              <select className="ed" value={component.type} onChange={(e) => edit((d: Design) => d.components, { type: e.target.value as ComponentType })} aria-label="Type">
                {GROUPS.map((g) => (
                  <optgroup key={g.key} label={g.title}>
                    {COMPONENT_TYPES.filter((t) => SHAPES[t].group === g.key).map((t) => (
                      <option key={t} value={t}>
                        {SHAPES[t].name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Prop>
            <Prop label="Technology">
              <Ed label="Technology" placeholder="e.g. Redis" value={component.tech} onCommit={(v) => edit((d: Design) => d.components, { tech: v })} />
            </Prop>
            {design.boundaries.length > 0 && (
              <Prop label="Inside">
                <InsideSelect design={design} value={component.boundary} onPick={placeIn} />
              </Prop>
            )}
          </>
        )}
        {boundary && (
          <>
            <Prop label="Kind">
              <select className="ed" value={boundary.kind} onChange={(e) => edit((d: Design) => d.boundaries, { kind: e.target.value as BoundaryKind })} aria-label="Kind">
                {BOUNDARY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {BOUNDARY_SPECS[k].name}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Detail">
              <Ed label="Detail" placeholder="e.g. 10.0.1.0/24, VLAN 20, us-east-1" value={boundary.detail} onCommit={(v) => edit((d: Design) => d.boundaries, { detail: v })} />
            </Prop>
            <Prop label="Inside">
              <InsideSelect design={design} value={boundary.parent} exclude={m.boundaryTree(design, boundary.id)} onPick={placeIn} />
            </Prop>
            <Prop label="Holds">
              {design.components.some((c) => c.boundary === boundary.id) ? (
                design.components.filter((c) => c.boundary === boundary.id).map((c) => ref(c.id))
              ) : (
                <span className="quiet">Drag parts into the box</span>
              )}
            </Prop>
          </>
        )}
        {connection && (
          <>
            <Prop label="Label">
              <Ed label="Label" placeholder="e.g. HTTPS" value={connection.label} onCommit={(v) => edit((d: Design) => d.connections, { label: v })} />
            </Prop>
            <Prop label="Relation">
              <select
                className="ed"
                value={connection.kind ?? ''}
                onChange={(e) => edit((d: Design) => d.connections, { kind: (e.target.value || undefined) as ConnectionKind | undefined })}
                aria-label="Relation"
              >
                <option value="">Arrow</option>
                {CONNECTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RELATION_NAMES[k]}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Mode">
              <div className="toggle" role="radiogroup" aria-label="Mode">
                <button role="radio" aria-checked={!connection.async} onClick={() => edit((d: Design) => d.connections, { async: undefined })}>
                  Sync
                </button>
                <button role="radio" aria-checked={!!connection.async} onClick={() => edit((d: Design) => d.connections, { async: true })}>
                  Async
                </button>
              </div>
            </Prop>
            <Prop label="Line">
              <div className="toggle" role="radiogroup" aria-label="Line">
                {(['curve', 'straight', 'elbow'] as const).map((r) => (
                  <button key={r} role="radio" aria-checked={(connection.route ?? 'curve') === r} onClick={() => edit((d: Design) => d.connections, { route: r === 'curve' ? undefined : r, bend: undefined })}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
              {connection.bend !== undefined && (
                <button className="text-btn" onClick={() => edit((d: Design) => d.connections, { bend: undefined })}>
                  Reset bend
                </button>
              )}
            </Prop>
          </>
        )}
        {decision && <Prop label="Affects">{decision.links.length ? decision.links.map(ref) : <span className="quiet">Drag from the decision to a component</span>}</Prop>}
        {note && <Prop label="Attached to">{note.attachTo ? ref(note.attachTo) : <span className="quiet">Drag from the note to a component</span>}</Prop>}
        <Prop label="Step">
          <span className="mono">{pad(stepNo(item.step))}</span>
          <span className="prop-text">{stepTitle(item.step)}</span>
        </Prop>
      </section>

      <section className="insp-sec">
        {component && (
          <Block label="Description">
            <Ed label="Description" multiline placeholder="What it does and why it is here" value={component.description} onCommit={(v) => edit((d: Design) => d.components, { description: v })} />
          </Block>
        )}
        {boundary && (
          <>
            <Block label="Description">
              <Ed label="Description" multiline placeholder="What this boundary separates and why" value={boundary.description} onCommit={(v) => edit((d: Design) => d.boundaries, { description: v })} />
            </Block>
            <p className="quiet">Drag the label tab to move the box with everything in it. Deleting it keeps its parts.</p>
          </>
        )}
        {note && (
          <Block label="Text">
            <Ed label="Text" required multiline value={note.text} onCommit={(v) => edit((d: Design) => d.notes, { text: v })} />
          </Block>
        )}
        {decision && (
          <>
            <Block label="Why">
              <Ed label="Why" required multiline value={decision.why} onCommit={(v) => edit((d: Design) => d.decisions, { why: v })} />
            </Block>
            <Block label="Instead of">
              <Ed
                label="Alternatives"
                multiline
                placeholder="One alternative per line"
                value={decision.alternatives?.join('\n')}
                onCommit={(v) => edit((d: Design) => d.decisions, { alternatives: v?.split('\n').map((s) => s.trim()).filter(Boolean) })}
              />
            </Block>
            <Block label="Cost">
              <Ed label="Trade-offs" multiline placeholder="What this choice gives up" value={decision.tradeoffs} onCommit={(v) => edit((d: Design) => d.decisions, { tradeoffs: v })} />
            </Block>
          </>
        )}
        {connection && (
          <p className="quiet">
            Async connections are drawn dashed: queues, events and other fire-and-forget flows. Drag the middle of a selected line (or its label) to bend it; double-click it to edit the label.
          </p>
        )}
      </section>

      <Comments design={design} step={item.step} target={item.id} change={change} onSelect={onSelect} />

      <footer className="insp-foot">
        <button className="text-btn danger" onClick={() => onDelete(item.id)}>
          Delete {kind.toLowerCase()}
        </button>
      </footer>
    </aside>
  );
}

export function ReviewBar({
  design,
  viewIndex,
  maxIndex,
  onView,
  onSeenNext,
  onRequestChanges,
  diff,
  onDiff,
}: {
  design: Design;
  viewIndex: number;
  maxIndex: number;
  onView: (i: number) => void;
  onSeenNext: () => void;
  onRequestChanges: (text: string) => void;
  diff: boolean;
  onDiff: () => void;
}) {
  const step = design.steps[viewIndex];
  const seen = design.steps.filter((s) => s.seen).length;
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  const send = () => {
    onRequestChanges(why);
    setWhy('');
    setAsking(false);
  };
  return (
    <div className="review" role="region" aria-label="Step review">
      {asking && (
        <form
          className="pop"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className="field-label" htmlFor="changes-why">
            Send step {pad(viewIndex + 1)} back to the agent
          </label>
          <textarea
            id="changes-why"
            className="ed"
            autoFocus
            rows={3}
            value={why}
            placeholder="What should change? The agent reads this through get_feedback."
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAsking(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
          />
          <div className="pop-foot">
            <button type="button" className="text-btn" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="submit" className="btn ink">
              Request changes
            </button>
          </div>
        </form>
      )}
      <div className="review-main">
        <div className="review-meta">
          <span>
            Step {viewIndex + 1} of {design.steps.length}
          </span>
          <span className="dots">
            {design.steps.map((s, i) => (
              <button
                key={s.id}
                className={`dot${s.seen ? ' seen' : ''}${s.changesRequested ? ' changes' : ''}${i === viewIndex ? ' current' : ''}${i > maxIndex ? ' locked' : ''}`}
                onClick={() => i <= maxIndex && onView(i)}
                aria-disabled={i > maxIndex}
                aria-current={i === viewIndex ? 'step' : undefined}
                aria-label={`Step ${i + 1}`}
                title={
                  i > maxIndex
                    ? `Step ${i + 1} is locked until the earlier steps are reviewed`
                    : `Step ${i + 1}: ${s.title}${s.seen ? ' (reviewed)' : ''}${s.changesRequested ? ' (changes requested)' : ''}`
                }
              />
            ))}
          </span>
          <span>{seen} reviewed</span>
        </div>
        <div className="review-title" title={step.title}>
          {step.title}
        </div>
      </div>
      <div className="review-actions">
        <button className="chip" aria-pressed={diff} onClick={onDiff} title="Outline what this step added or changed, show what it removed, and dim the rest">
          Diff
        </button>
        <button className="text-btn" aria-expanded={asking} onClick={() => setAsking((a) => !a)} title="Send this step back to the agent with a comment">
          Request changes
        </button>
        <span className="vrule" />
        <button className="btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} title="Previous step (←)">
          <kbd className="lead">←</kbd> Back
        </button>
        {!step.seen ? (
          <button className="btn ink" onClick={onSeenNext} title="Mark as seen and go to the next step (→)">
            Mark seen <kbd>→</kbd>
          </button>
        ) : viewIndex < maxIndex ? (
          <button className="btn" onClick={() => onView(viewIndex + 1)} title="Next step (→)">
            Next <kbd>→</kbd>
          </button>
        ) : (
          <span className="review-done">All reviewed ✓</span>
        )}
      </div>
    </div>
  );
}

export function PresentBar({ design, viewIndex, maxIndex, onView, onExit }: { design: Design; viewIndex: number; maxIndex: number; onView: (i: number) => void; onExit: () => void }) {
  const step = design.steps[viewIndex];
  return (
    <div className="present-bar" role="region" aria-label="Presentation">
      <span className="present-no">
        {pad(viewIndex + 1)}
        <span>/{pad(design.steps.length)}</span>
      </span>
      <div className="present-text">
        <strong>{step.title}</strong>
        {step.summary && <span>{step.summary}</span>}
      </div>
      <button className="icon-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} aria-label="Previous step">
        ‹
      </button>
      <button className="icon-btn" onClick={() => onView(viewIndex + 1)} disabled={viewIndex >= maxIndex} aria-label="Next step">
        ›
      </button>
      <button className="text-btn" onClick={onExit}>
        Exit <kbd>Esc</kbd>
      </button>
    </div>
  );
}

/** Finds a visible item by name, technology, text or kind, and flies to it. */
export function FindBox({ design, visible, onPick, inputRef }: { design: Design; visible: string[]; onPick: (id: string) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = new Set(visible);
  const all = [
    ...design.components.map((c) => ({ id: c.id, kind: SHAPES[c.type].name, text: c.label, extra: c.tech })),
    ...design.boundaries.map((b) => ({ id: b.id, kind: BOUNDARY_SPECS[b.kind].name, text: b.label, extra: b.detail })),
    ...design.decisions.map((x) => ({ id: x.id, kind: 'Decision', text: x.title, extra: x.why })),
    ...design.notes.map((n) => ({ id: n.id, kind: 'Note', text: n.text, extra: '' })),
    ...design.connections.filter((c) => c.label).map((c) => ({ id: c.id, kind: 'Connection', text: c.label!, extra: '' })),
  ];
  const hits = terms.length ? all.filter((x) => shown.has(x.id) && terms.every((t) => `${x.text} ${x.extra ?? ''} ${x.kind} ${x.id}`.toLowerCase().includes(t))).slice(0, 8) : [];
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
  };
  return (
    <div className="find">
      <input
        ref={inputRef}
        type="search"
        className="find-input"
        value={q}
        placeholder="Find on sheet"
        aria-label="Find on sheet"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) pick(hits[0].id);
          if (e.key === 'Escape') {
            setQ('');
            e.currentTarget.blur();
          }
        }}
      />
      {open && terms.length > 0 && (
        <div className="menu menu-right find-menu" role="listbox" aria-label="Matches">
          {hits.length ? (
            hits.map((h) => (
              <button key={h.id} role="option" aria-selected={false} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h.id)}>
                <span className="menu-main">
                  <span className="menu-title">{h.text}</span>
                </span>
                <span className="menu-meta">{h.kind}</span>
              </button>
            ))
          ) : (
            <p className="quiet pad">Nothing on this step matches “{q}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Review comments on a step (`target` unset) or on one item, plus a box to add one for the agent. */
function Comments({ design, step, target, change, onSelect }: { design: Design; step: string; target?: string; change: Change; onSelect: (id: string) => void }) {
  const [text, setText] = useState('');
  const list = design.comments.filter((c) => (target ? c.target === target : c.step === step));
  const label = (id: string) => [...design.components, ...design.boundaries].find((x) => x.id === id)?.label ?? design.decisions.find((x) => x.id === id)?.title ?? id;
  const send = () => {
    if (!text.trim()) return;
    change((d) => m.addComment(d, { step: target ? undefined : step, target, text, by: 'reviewer' }));
    setText('');
  };
  const toggle = (id: string) =>
    change((d) => {
      const c = d.comments.find((x) => x.id === id);
      if (c) c.resolved = c.resolved ? undefined : true;
    });
  return (
    <section className="insp-sec">
      <h3 className="rule-head">
        Comments
        <span className="rule-count">{pad(list.filter((c) => !c.resolved && c.by === 'reviewer').length)}</span>
      </h3>
      {list.map((c) => (
        <div key={c.id} className={`comment${c.resolved ? ' resolved' : ''}${c.by === 'agent' ? ' agent' : ''}`}>
          <div className="comment-meta">
            <span className="comment-by">{c.by === 'agent' ? 'Agent' : 'You'}</span>
            {!target && c.target && (
              <button className="ref" onClick={() => onSelect(c.target!)}>
                {label(c.target)}
              </button>
            )}
            <span className="comment-at">{when(c.at)}</span>
            {c.by === 'reviewer' && (
              <button className="text-btn" onClick={() => toggle(c.id)}>
                {c.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
          </div>
          <p className="comment-text">{c.text}</p>
        </div>
      ))}
      <div className="comment-new">
        <textarea
          className="ed"
          rows={2}
          value={text}
          placeholder={target ? 'Comment on this for the agent' : 'Comment on this step for the agent'}
          aria-label="New comment"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()}
        />
        <button className="btn" disabled={!text.trim()} onClick={send} title="Ctrl+Enter">
          Comment
        </button>
      </div>
    </section>
  );
}
