import { useContext, useEffect, useMemo, useState } from 'react';
import { COMPONENT_TYPES, type ComponentType, type Design } from '../core/schema.ts';
import { SketchContext } from './canvas.tsx';
import { CATEGORY_COLOR, NOTE_COLOR, SHAPES, drawShape } from './shapes.ts';

export type AddKind = ComponentType | 'note' | 'decision';
export const DRAG_MIME = 'application/x-system-design';

function Preview({ type }: { type: ComponentType }) {
  const sketch = useContext(SketchContext);
  const spec = SHAPES[type];
  const paths = useMemo(() => drawShape(type, sketch, 7), [type, sketch]);
  return (
    <svg width={44} height={30} viewBox={`0 0 ${spec.w} ${spec.h}`} aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p.d} vectorEffect="non-scaling-stroke" style={{ stroke: p.stroke, strokeWidth: 1, fill: p.fill ?? 'none' }} />
      ))}
    </svg>
  );
}

const GROUPS: { title: string; category: keyof typeof CATEGORY_COLOR }[] = [
  { title: 'Edge', category: 'edge' },
  { title: 'Network and compute', category: 'compute' },
  { title: 'Data', category: 'data' },
];

export function Palette({ onAdd }: { onAdd: (kind: AddKind) => void }) {
  const item = (kind: AddKind, name: string, icon: React.ReactNode) => (
    <button
      key={kind}
      className="palette-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(kind)}
      title={`Drag onto the canvas or click to add ${name}`}
    >
      {icon}
      <span>{name}</span>
    </button>
  );
  return (
    <aside className="palette">
      {GROUPS.map((g) => (
        <section key={g.category}>
          <h3>{g.title}</h3>
          {COMPONENT_TYPES.filter((t) => SHAPES[t].category === g.category).map((t) => item(t, SHAPES[t].name, <Preview type={t} />))}
        </section>
      ))}
      <section>
        <h3>Explain</h3>
        {item('note', 'Note', <span className="swatch" style={{ background: '#FAC775' }} />)}
        {item('decision', 'Decision', <span className="swatch" style={{ border: `1.5px dashed ${NOTE_COLOR}` }} />)}
      </section>
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
  const Tag = props.multiline ? 'textarea' : 'input';
  return (
    <label className="field">
      <span>{props.label}</span>
      <Tag value={v} placeholder={props.placeholder} rows={props.multiline ? 4 : undefined} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} />
      {invalid && <em className="field-error">Required</em>}
    </label>
  );
}

type Change = (fn: (d: Design) => void) => void;

export function Inspector({ design, selected, stepId, change, onSelect, onDelete }: { design: Design; selected: string | null; stepId: string; change: Change; onSelect: (id: string | null) => void; onDelete: (id: string) => void }) {
  const component = design.components.find((c) => c.id === selected);
  const connection = design.connections.find((c) => c.id === selected);
  const note = design.notes.find((n) => n.id === selected);
  const decision = design.decisions.find((x) => x.id === selected);
  const item = component ?? connection ?? note ?? decision;
  const stepTitle = (id: string) => design.steps.find((s) => s.id === id)?.title;
  const edit = <T extends { id: string }>(list: (d: Design) => T[], patch: Partial<NoInfer<T>>) =>
    change((d) => {
      const x = list(d).find((i) => i.id === selected);
      if (x) Object.assign(x, patch);
    });

  if (!item) {
    const step = design.steps.find((s) => s.id === stepId)!;
    const decisions = design.decisions.filter((x) => x.step === stepId);
    const notes = design.notes.filter((n) => n.step === stepId);
    return (
      <aside className="inspector">
        <div className="kicker">Step {design.steps.indexOf(step) + 1}</div>
        <h2>{step.title}</h2>
        {step.summary && <p className="muted">{step.summary}</p>}
        {decisions.map((x) => (
          <button key={x.id} className="decision-card" onClick={() => onSelect(x.id)}>
            <div className="kicker">Decision</div>
            <strong>{x.title}</strong>
            <p>{x.why}</p>
            {x.alternatives?.length ? <p className="muted">Alternatives: {x.alternatives.join(', ')}</p> : null}
            {x.tradeoffs && <p className="muted">Trade-off: {x.tradeoffs}</p>}
          </button>
        ))}
        {notes.map((n) => (
          <button key={n.id} className="note-card" onClick={() => onSelect(n.id)}>
            {n.text}
          </button>
        ))}
        {!decisions.length && !notes.length && <p className="muted">No decisions or notes in this step. Select an item to edit it.</p>}
      </aside>
    );
  }

  return (
    <aside className="inspector" key={item.id}>
      <div className="kicker">
        {component ? SHAPES[component.type].name : connection ? 'Connection' : note ? 'Note' : 'Decision'} · step “{stepTitle(item.step)}”
      </div>
      {component && (
        <>
          <label className="field">
            <span>Type</span>
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
          <Field label="Description" multiline value={component.description} onCommit={(v) => edit((d: Design) => d.components, { description: v })} />
        </>
      )}
      {connection && (
        <>
          <p className="muted">
            {connection.from} → {connection.to}
          </p>
          <Field label="Label" placeholder="HTTPS" value={connection.label} onCommit={(v) => edit((d: Design) => d.connections, { label: v })} />
          <label className="check">
            <input type="checkbox" checked={!!connection.async} onChange={(e) => edit((d: Design) => d.connections, { async: e.target.checked || undefined })} />
            Async (queue, events)
          </label>
        </>
      )}
      {note && <Field label="Text" required multiline value={note.text} onCommit={(v) => edit((d: Design) => d.notes, { text: v })} />}
      {decision && (
        <>
          <Field label="Title" required value={decision.title} onCommit={(v) => edit((d: Design) => d.decisions, { title: v })} />
          <Field label="Why" required multiline value={decision.why} onCommit={(v) => edit((d: Design) => d.decisions, { why: v })} />
          <Field
            label="Alternatives (one per line)"
            multiline
            value={decision.alternatives?.join('\n')}
            onCommit={(v) => edit((d: Design) => d.decisions, { alternatives: v?.split('\n').map((s) => s.trim()).filter(Boolean) })}
          />
          <Field label="Trade-offs" multiline value={decision.tradeoffs} onCommit={(v) => edit((d: Design) => d.decisions, { tradeoffs: v })} />
          <p className="muted">Linked to: {decision.links.length ? decision.links.join(', ') : 'nothing — drag from the decision to a component to link it'}</p>
        </>
      )}
      <div className="row">
        <button onClick={() => onSelect(null)}>Back to step</button>
        <button className="danger" onClick={() => onDelete(item.id)}>
          Delete
        </button>
      </div>
    </aside>
  );
}

export function ReviewBar({ design, viewIndex, maxIndex, onView, onSeenNext }: { design: Design; viewIndex: number; maxIndex: number; onView: (i: number) => void; onSeenNext: () => void }) {
  const step = design.steps[viewIndex];
  const unseen = design.steps.filter((s) => !s.seen).length;
  return (
    <footer className="review-bar">
      <span className="muted nowrap">
        Step {viewIndex + 1} / {design.steps.length}
      </span>
      <div className="dots">
        {design.steps.map((s, i) => (
          <button
            key={s.id}
            className={`dot${s.seen ? ' seen' : ''}${i === viewIndex ? ' current' : ''}`}
            onClick={() => i <= maxIndex && onView(i)}
            aria-disabled={i > maxIndex}
            title={i > maxIndex ? 'Review the earlier steps first' : s.title}
            aria-label={`Step ${i + 1}: ${s.title}`}
          />
        ))}
      </div>
      <span className="step-title">{step.title}</span>
      {unseen > 0 && <span className="badge">{unseen} unseen</span>}
      <button onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0}>
        Back
      </button>
      {!step.seen ? (
        <button className="primary" onClick={onSeenNext}>
          Seen, next
        </button>
      ) : viewIndex < maxIndex ? (
        <button onClick={() => onView(viewIndex + 1)}>Next</button>
      ) : (
        <span className="muted nowrap">All reviewed</span>
      )}
    </footer>
  );
}
