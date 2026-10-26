import { useContext, useEffect, useMemo, useState } from 'react';
import { COMPONENT_TYPES, type ComponentType, type Design } from '../core/schema.ts';
import { SketchContext } from './canvas.tsx';
import { CATEGORY_COLOR, SHAPES, drawShape } from './shapes.ts';

export type AddKind = ComponentType | 'note' | 'decision';
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

const GROUPS: { title: string; category: keyof typeof CATEGORY_COLOR }[] = [
  { title: 'Edge / security', category: 'edge' },
  { title: 'Network / compute', category: 'compute' },
  { title: 'Data', category: 'data' },
];

export function Palette({ onAdd }: { onAdd: (kind: AddKind) => void }) {
  const [query, setQuery] = useState('');
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
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
  const groups = GROUPS.map((g) => ({ ...g, types: COMPONENT_TYPES.filter((t) => SHAPES[t].category === g.category && match(SHAPES[t].name)) }));
  const explain = [
    { kind: 'note' as const, name: 'Note', preview: <span className="note-swatch" /> },
    { kind: 'decision' as const, name: 'Decision', preview: <span className="decision-swatch" /> },
  ].filter((x) => match(x.name));
  return (
    <aside className="palette">
      <input className="palette-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter parts…" aria-label="Filter parts" />
      <div className="palette-scroll">
        {groups.map(
          (g) =>
            g.types.length > 0 && (
              <section key={g.category}>
                <h3 className="rule-head">
                  <span className="swatch-sq" style={{ background: CATEGORY_COLOR[g.category] }} />
                  {g.title}
                  <span className="rule-count">{pad(g.types.length)}</span>
                </h3>
                {g.types.map((t) => row(t, SHAPES[t].name, <ShapePreview type={t} width={40} height={26} />))}
              </section>
            ),
        )}
        {explain.length > 0 && (
          <section>
            <h3 className="rule-head">
              <span className="swatch-sq" style={{ background: '#EF9F27' }} />
              Annotate
              <span className="rule-count">{pad(explain.length)}</span>
            </h3>
            {explain.map((x) => row(x.kind, x.name, x.preview))}
          </section>
        )}
        {!groups.some((g) => g.types.length) && !explain.length && <p className="quiet pad">No part matches “{query}”.</p>}
      </div>
      <p className="palette-foot">Drag a part onto the sheet, or click to drop it in the middle. Drag from one item to another to connect them.</p>
    </aside>
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
  const stepTitle = (id: string) => design.steps.find((s) => s.id === id)?.title;
  const ref = (id: string) => (
    <button key={id} className="ref" onClick={() => onSelect(id)}>
      {labelOf(id)}
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
    return (
      <aside className="inspector">
        <header className="insp-head">
          <div className="insp-tagline">
            <span className="tag">Step {pad(stepNo(step.id))}</span>
            <span className={`state${step.seen ? '' : ' new'}`}>{step.seen ? 'Reviewed' : 'Not reviewed'}</span>
          </div>
          <h2 className="insp-title">{step.title}</h2>
          {step.summary && <p className="insp-lead">{step.summary}</p>}
        </header>

        {components.length > 0 && (
          <section className="insp-sec">
            <h3 className="rule-head">
              Added
              <span className="rule-count">{pad(components.length)}</span>
            </h3>
            {components.map((c) => (
              <button key={c.id} className="list-row" onClick={() => onSelect(c.id)}>
                <ShapePreview type={c.type} width={30} height={20} />
                <span className="list-main">{c.label}</span>
                {c.tech && <span className="list-meta">{c.tech}</span>}
              </button>
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

        <p className="quiet pad">
          {!components.length && !decisions.length && !notes.length ? 'Nothing was added in this step. ' : ''}
          Select anything on the sheet to read or edit it.
        </p>
      </aside>
    );
  }

  const kind = component ? SHAPES[component.type].name : connection ? 'Connection' : note ? 'Note' : 'Decision';
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
                {COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SHAPES[t].name}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Technology">
              <Ed label="Technology" placeholder="e.g. Redis" value={component.tech} onCommit={(v) => edit((d: Design) => d.components, { tech: v })} />
            </Prop>
          </>
        )}
        {connection && (
          <>
            <Prop label="Label">
              <Ed label="Label" placeholder="e.g. HTTPS" value={connection.label} onCommit={(v) => edit((d: Design) => d.connections, { label: v })} />
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
        {connection && <p className="quiet">Async connections are drawn dashed: queues, events and other fire-and-forget flows.</p>}
      </section>

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
    <div className="titleblock" role="region" aria-label="Step review">
      <div className="tb-row">
        <span className="tb-cell tb-key">
          Step {pad(viewIndex + 1)}/{pad(design.steps.length)}
        </span>
        <span className="tb-cell tb-title" title={step.title}>
          {step.title}
        </span>
        <span className="tb-cell tb-key">
          {seen}/{design.steps.length} reviewed
        </span>
      </div>
      <div className="tb-row">
        <div className="tb-steps">
          {design.steps.map((s, i) => (
            <button
              key={s.id}
              className={`tb-step${s.seen ? ' seen' : ''}${i === viewIndex ? ' current' : ''}${i > maxIndex ? ' locked' : ''}`}
              onClick={() => i <= maxIndex && onView(i)}
              aria-disabled={i > maxIndex}
              aria-current={i === viewIndex ? 'step' : undefined}
              title={i > maxIndex ? `Step ${i + 1} is locked until the earlier steps are reviewed` : `Step ${i + 1}: ${s.title}`}
            >
              {pad(i + 1)}
            </button>
          ))}
        </div>
        <button className="tb-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} title="Previous step (←)">
          ← Back
        </button>
        {!step.seen ? (
          <button className="tb-btn ink" onClick={onSeenNext} title="Mark as seen and go to the next step (→)">
            Mark seen <kbd>→</kbd>
          </button>
        ) : viewIndex < maxIndex ? (
          <button className="tb-btn" onClick={() => onView(viewIndex + 1)} title="Next step (→)">
            Next <kbd>→</kbd>
          </button>
        ) : (
          <span className="tb-btn done">All reviewed</span>
        )}
      </div>
    </div>
  );
}
