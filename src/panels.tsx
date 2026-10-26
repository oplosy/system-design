import { useContext, useEffect, useMemo, useState } from 'react';
import { COMPONENT_TYPES, type ComponentType, type Design } from '../core/schema.ts';
import { SketchContext } from './canvas.tsx';
import { Icon } from './icons.tsx';
import { CATEGORY_COLOR, SHAPES, drawShape } from './shapes.ts';

export type AddKind = ComponentType | 'note' | 'decision';
export const DRAG_MIME = 'application/x-system-design';

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

const GROUPS: { title: string; category: keyof typeof CATEGORY_COLOR }[] = [
  { title: 'Edge and security', category: 'edge' },
  { title: 'Network and compute', category: 'compute' },
  { title: 'Data', category: 'data' },
];

export function Palette({ onAdd }: { onAdd: (kind: AddKind) => void }) {
  const [query, setQuery] = useState('');
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const tile = (kind: AddKind, name: string, preview: React.ReactNode) => (
    <button
      key={kind}
      className="tile"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(kind)}
      title={`Add ${name}: drag onto the canvas or click`}
    >
      <span className="tile-preview">{preview}</span>
      <span className="tile-name">{name}</span>
    </button>
  );
  const explain = [
    { kind: 'note' as const, name: 'Note', preview: <span className="note-swatch" /> },
    { kind: 'decision' as const, name: 'Decision', preview: <span className="decision-swatch" /> },
  ].filter((x) => match(x.name));
  return (
    <aside className="palette">
      <div className="search">
        <Icon name="search" size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search components" aria-label="Search components" />
      </div>
      <div className="palette-scroll">
        {GROUPS.map((g) => {
          const types = COMPONENT_TYPES.filter((t) => SHAPES[t].category === g.category && match(SHAPES[t].name));
          if (!types.length) return null;
          return (
            <section key={g.category}>
              <h3>
                <span className="cat-dot" style={{ background: CATEGORY_COLOR[g.category] }} />
                {g.title}
              </h3>
              <div className="tiles">{types.map((t) => tile(t, SHAPES[t].name, <ShapePreview type={t} />))}</div>
            </section>
          );
        })}
        {explain.length > 0 && (
          <section>
            <h3>
              <span className="cat-dot" style={{ background: '#EF9F27' }} />
              Explain
            </h3>
            <div className="tiles">{explain.map((x) => tile(x.kind, x.name, x.preview))}</div>
          </section>
        )}
      </div>
      <p className="palette-hint">Drag onto the canvas or click to add. Drag between items to connect them.</p>
    </aside>
  );
}

function Field(props: { label: string; value: string | undefined; onCommit: (v: string | undefined) => void; required?: boolean; multiline?: boolean; placeholder?: string }) {
  const [v, setV] = useState(props.value ?? '');
  useEffect(() => setV(props.value ?? ''), [props.value]);
  const invalid = props.required && !v.trim();
  const onChange = (next: string) => {
    setV(next);
    // Required fields keep their last valid value until the input is valid again.
    if (!(props.required && !next.trim())) props.onCommit(next.trim() ? next : undefined);
  };
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.multiline ? (
        <textarea value={v} placeholder={props.placeholder} rows={3} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} />
      ) : (
        <input value={v} placeholder={props.placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} />
      )}
      {invalid && <em className="field-error">Required</em>}
    </label>
  );
}

type Change = (fn: (d: Design) => void) => void;

function DecisionBody({ x }: { x: Design['decisions'][number] }) {
  return (
    <>
      <p className="decision-why-text">{x.why}</p>
      {x.alternatives?.length ? (
        <div className="kv">
          <span>Alternatives</span>
          <div className="chips">
            {x.alternatives.map((a) => (
              <span key={a} className="chip">
                {a}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {x.tradeoffs && (
        <div className="kv">
          <span>Trade-off</span>
          <p>{x.tradeoffs}</p>
        </div>
      )}
    </>
  );
}

export function Inspector({
  design,
  selected,
  stepId,
  change,
  onSelect,
  onDelete,
}: {
  design: Design;
  selected: string | null;
  stepId: string;
  change: Change;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const component = design.components.find((c) => c.id === selected);
  const connection = design.connections.find((c) => c.id === selected);
  const note = design.notes.find((n) => n.id === selected);
  const decision = design.decisions.find((x) => x.id === selected);
  const item = component ?? connection ?? note ?? decision;
  const labelOf = (id: string) => design.components.find((c) => c.id === id)?.label ?? id;
  const stepNo = (id: string) => design.steps.findIndex((s) => s.id === id) + 1;
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
    return (
      <aside className="inspector">
        <header className="insp-head">
          <div className="insp-meta">
            <span className="step-no">Step {stepNo(step.id)}</span>
            <span className={`status ${step.seen ? 'ok' : 'new'}`}>{step.seen ? 'Reviewed' : 'Not reviewed'}</span>
          </div>
          <h2>{step.title}</h2>
          {step.summary && <p className="lead">{step.summary}</p>}
        </header>
        {components.length > 0 && (
          <section className="insp-section">
            <h3>Added in this step</h3>
            <div className="added">
              {components.map((c) => (
                <button key={c.id} className="added-item" onClick={() => onSelect(c.id)}>
                  <ShapePreview type={c.type} width={30} height={22} />
                  <span>{c.label}</span>
                  {c.tech && <span className="muted small">{c.tech}</span>}
                </button>
              ))}
            </div>
          </section>
        )}
        {decisions.length > 0 && (
          <section className="insp-section">
            <h3>
              Decisions <span className="count">{decisions.length}</span>
            </h3>
            {decisions.map((x) => (
              <button key={x.id} className="decision-card" onClick={() => onSelect(x.id)}>
                <span className="decision-card-title">
                  <Icon name="bulb" size={15} />
                  {x.title}
                </span>
                <DecisionBody x={x} />
              </button>
            ))}
          </section>
        )}
        {notes.length > 0 && (
          <section className="insp-section">
            <h3>Notes</h3>
            {notes.map((n) => (
              <button key={n.id} className="note-card" onClick={() => onSelect(n.id)}>
                {n.text}
              </button>
            ))}
          </section>
        )}
        {!components.length && !decisions.length && !notes.length && <p className="empty-hint">Nothing was added in this step yet.</p>}
        <p className="empty-hint">Select anything on the canvas to see and edit its details.</p>
      </aside>
    );
  }

  const kind = component ? SHAPES[component.type].name : connection ? 'Connection' : note ? 'Note' : 'Decision';
  const title = component?.label ?? decision?.title ?? (connection ? `${labelOf(connection.from)} → ${labelOf(connection.to)}` : 'Note');
  return (
    <aside className="inspector" key={item.id}>
      <header className="insp-head">
        <div className="insp-top">
          {component ? (
            <span className="insp-icon">
              <ShapePreview type={component.type} width={40} height={28} />
            </span>
          ) : (
            <span className="insp-icon">
              <Icon name={decision ? 'bulb' : note ? 'note' : 'link'} size={18} />
            </span>
          )}
          <div className="insp-title">
            <span className="kicker">{kind}</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={() => onSelect(null)} aria-label="Close details" title="Back to step overview">
            <Icon name="x" />
          </button>
        </div>
        <span className="step-chip">
          Step {stepNo(item.step)} · {design.steps.find((s) => s.id === item.step)?.title}
        </span>
      </header>

      <section className="insp-section">
        {component && (
          <>
            <label className="field">
              <span className="field-label">Type</span>
              <select value={component.type} onChange={(e) => edit((d: Design) => d.components, { type: e.target.value as ComponentType })}>
                {COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SHAPES[t].name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Label" required value={component.label} onCommit={(v) => edit((d: Design) => d.components, { label: v })} />
            <Field label="Technology" placeholder="Redis" value={component.tech} onCommit={(v) => edit((d: Design) => d.components, { tech: v })} />
            <Field label="Description" multiline placeholder="What it does and why it is here" value={component.description} onCommit={(v) => edit((d: Design) => d.components, { description: v })} />
          </>
        )}
        {connection && (
          <>
            <div className="route">
              <button className="chip chip-btn" onClick={() => onSelect(connection.from)}>
                {labelOf(connection.from)}
              </button>
              <Icon name="arrowRight" size={14} />
              <button className="chip chip-btn" onClick={() => onSelect(connection.to)}>
                {labelOf(connection.to)}
              </button>
            </div>
            <Field label="Label" placeholder="HTTPS" value={connection.label} onCommit={(v) => edit((d: Design) => d.connections, { label: v })} />
            <label className="switch">
              <input type="checkbox" checked={!!connection.async} onChange={(e) => edit((d: Design) => d.connections, { async: e.target.checked || undefined })} />
              <span>
                Async
                <small>Queues, events and other fire-and-forget flows. Drawn dashed.</small>
              </span>
            </label>
          </>
        )}
        {note && <Field label="Text" required multiline value={note.text} onCommit={(v) => edit((d: Design) => d.notes, { text: v })} />}
        {decision && (
          <>
            <Field label="Title" required value={decision.title} onCommit={(v) => edit((d: Design) => d.decisions, { title: v })} />
            <Field label="Why" required multiline value={decision.why} onCommit={(v) => edit((d: Design) => d.decisions, { why: v })} />
            <Field
              label="Alternatives"
              multiline
              placeholder="One per line"
              value={decision.alternatives?.join('\n')}
              onCommit={(v) => edit((d: Design) => d.decisions, { alternatives: v?.split('\n').map((s) => s.trim()).filter(Boolean) })}
            />
            <Field label="Trade-offs" multiline value={decision.tradeoffs} onCommit={(v) => edit((d: Design) => d.decisions, { tradeoffs: v })} />
          </>
        )}
        {(decision || note) && (
          <div className="kv">
            <span>{decision ? 'Affects' : 'Attached to'}</span>
            <div className="chips">
              {(decision ? decision.links : note?.attachTo ? [note.attachTo] : []).map((l) => (
                <button key={l} className="chip chip-btn" onClick={() => onSelect(l)}>
                  {labelOf(l)}
                </button>
              ))}
              {!(decision ? decision.links.length : note?.attachTo) && <span className="muted small">Drag from it to a component on the canvas to link it.</span>}
            </div>
          </div>
        )}
      </section>

      <footer className="insp-foot">
        <button className="btn danger-ghost" onClick={() => onDelete(item.id)}>
          <Icon name="trash" size={14} />
          Delete
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
}: {
  design: Design;
  viewIndex: number;
  maxIndex: number;
  onView: (i: number) => void;
  onSeenNext: () => void;
}) {
  const step = design.steps[viewIndex];
  const seen = design.steps.filter((s) => s.seen).length;
  return (
    <div className="review" role="region" aria-label="Step review">
      <button className="icon-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} aria-label="Previous step" title="Previous step (←)">
        <Icon name="arrowLeft" />
      </button>
      <div className="review-main">
        <div className="review-top">
          <span className="review-count">
            Step {viewIndex + 1} of {design.steps.length}
          </span>
          <span className="review-title" title={step.title}>
            {step.title}
          </span>
        </div>
        <div className="stepper">
          {design.steps.map((s, i) => (
            <button
              key={s.id}
              className={`seg${s.seen ? ' seen' : ''}${i === viewIndex ? ' current' : ''}${i > maxIndex ? ' locked' : ''}`}
              onClick={() => i <= maxIndex && onView(i)}
              aria-disabled={i > maxIndex}
              aria-current={i === viewIndex ? 'step' : undefined}
              title={i > maxIndex ? `Step ${i + 1}: review the earlier steps first` : `Step ${i + 1}: ${s.title}`}
              aria-label={`Step ${i + 1}: ${s.title}`}
            />
          ))}
        </div>
      </div>
      <span className="review-progress">
        {seen}/{design.steps.length} reviewed
      </span>
      {!step.seen ? (
        <button className="btn primary" onClick={onSeenNext} title="Mark as seen and go to the next step (→)">
          <Icon name="check" size={15} />
          Seen, next
        </button>
      ) : viewIndex < maxIndex ? (
        <button className="btn" onClick={() => onView(viewIndex + 1)} title="Next step (→)">
          Next
          <Icon name="arrowRight" size={15} />
        </button>
      ) : (
        <span className="all-done">
          <Icon name="check" size={15} />
          All reviewed
        </span>
      )}
    </div>
  );
}
